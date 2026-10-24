import { createHash } from 'node:crypto';
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from '../errors.mjs';

const principals = new WeakSet();
const unauthorized = () => new AppError('UNAUTHORIZED', 'A valid service access token is required.', 401);

function principalFor(issuer, subject, scopes) {
  const principal = Object.freeze({
    id: createHash('sha256').update(JSON.stringify([issuer, subject])).digest('hex'),
    scopes: Object.freeze(scopes),
  });
  principals.add(principal);
  return principal;
}

/** Single-owner desktop boundary. The owner is read from the user's local profile, never tool input. */
export function createLocalPrincipal(owner) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(owner)) throw unauthorized();
  return principalFor('urn:youtube-dashboard:local-profile', owner, ['dashboard:read', 'dashboard:manage']);
}

/** Server-only Sites adapter entry. Never pass an ID read from a public Request. */
export function createSitesPrincipal(verifiedUserId, publicOrigin) {
  if (typeof verifiedUserId !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(verifiedUserId)) throw unauthorized();
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new AppError('AUTH_CONFIGURATION', 'Configure the exact Sites origin.', 503); }
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password) throw new AppError('AUTH_CONFIGURATION', 'Configure the exact Sites origin.', 503);
  return principalFor('urn:openai:sites:' + publicOrigin, verifiedUserId, ['dashboard:read', 'dashboard:manage']);
}

/** Verify service tokens, never Google tokens or client-supplied identity headers. */
export function createIdentityVerifier({ issuer, audience, jwks, jwksUri }) {
  for (const value of [issuer, audience, ...(jwksUri ? [jwksUri] : [])]) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new AppError('AUTH_CONFIGURATION', 'Authentication requires fixed HTTPS endpoints.', 503);
    }
  }
  if (Boolean(jwks) === Boolean(jwksUri)) throw new AppError('AUTH_CONFIGURATION', 'Configure one trusted signing-key source.', 503);
  const keySet = jwks ? createLocalJWKSet(jwks) : createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async function authenticate(request) {
    const value = request.headers.get('authorization');
    if (!value || value.length > 16384 || !/^Bearer [A-Za-z0-9_.-]+$/i.test(value)) throw unauthorized();
    try {
      const { payload } = await jwtVerify(value.slice(7), keySet, {
        issuer, audience, algorithms: ['RS256', 'ES256'],
        requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 0,
      });
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256 ||
          typeof payload.scope !== 'string' || payload.scope.length > 2048 ||
          payload.iat > Date.now() / 1000 + 30) throw unauthorized();
      return principalFor(issuer, payload.sub, payload.scope.split(/\s+/).filter(Boolean));
    } catch { throw unauthorized(); }
  };
}

/** Google ID tokens establish browser identities only; they are never MCP bearer tokens. */
export function createGoogleIdentityVerifier({ clientId, jwks, now = () => Date.now() }) {
  const keys = jwks ? createLocalJWKSet(jwks) : createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 5000, cooldownDuration: 30000 });
  return async (token, nonce) => {
    try {
      if (typeof token !== 'string' || token.length > 16384) throw new Error();
      const { payload } = await jwtVerify(token, keys, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId,
        algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat', 'nonce'], currentDate: new Date(now()), maxTokenAge: '10m' });
      if (typeof payload.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(payload.sub) || payload.nonce !== nonce ||
          payload.iat > now() / 1000 + 30 || (payload.azp !== undefined && payload.azp !== clientId) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) throw new Error();
      return principalFor('https://accounts.google.com', payload.sub, ['dashboard:read', 'dashboard:manage']);
    } catch { throw new AppError('LOGIN_VERIFICATION_FAILED', 'Google login could not be verified.', 401); }
  };
}

/** An opaque principal originates only from a verified token or trusted Sites boundary. */
export function requirePrincipal(principal, scope) {
  if (!principal || !principals.has(principal)) throw unauthorized();
  if (!principal.scopes.includes(scope)) throw new AppError('FORBIDDEN', 'The connection lacks the required service scope.', 403);
  return principal.id;
}
