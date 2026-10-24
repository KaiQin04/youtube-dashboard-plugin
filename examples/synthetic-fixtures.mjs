import { randomBytes } from 'node:crypto';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createIdentityVerifier } from '../src/auth/identity.mjs';

export const CHANNEL_A = 'UCaaaaaaaaaaaaaaaaaaaaaa';
export const CHANNEL_B = 'UCbbbbbbbbbbbbbbbbbbbbbb';
export const ORIGIN = 'https://dashboard.example';
export const NOW = Date.parse('2026-10-23T08:00:00Z');

export async function identities() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const authenticate = createIdentityVerifier({ issuer: 'https://identity.example', audience: `${ORIGIN}/mcp`, jwks: { keys: [{ ...jwk, kid: 'test' }] } });
  async function token(subject = 'user-a', scope = 'dashboard:read dashboard:manage', changes = {}) {
    return new SignJWT({ scope }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setIssuer(changes.issuer ?? 'https://identity.example').setAudience(changes.audience ?? `${ORIGIN}/mcp`).setSubject(subject).setIssuedAt().setExpirationTime(changes.exp ?? '1h').sign(privateKey);
  }
  async function principal(subject = 'user-a', scope) {
    return authenticate(new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${await token(subject, scope)}` } }));
  }
  return { authenticate, token, principal, a: await principal(), b: await principal('user-b') };
}

export function configuration() {
  return { publicOrigin: ORIGIN, googleClientId: 'synthetic-client', googleClientSecret: randomBytes(24).toString('base64url'), encryptionKey: randomBytes(32).toString('base64url') };
}

/** The only HTTP double: Google responses are synthetic and all other destinations fail. */
export function googleFixture() {
  const access = new Map();
  const refresh = new Map();
  const control = { channels: [CHANNEL_A], failRefresh: false, failRevoke: false, calls: 0, tokens: [], onReports: null };
  const channelItems = ids => ({ items: ids.map(id => ({ id, snippet: { title: id === CHANNEL_A ? 'Synthetic A' : 'Synthetic B' }, contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } } })) });
  const fetch = async (input, options = {}) => {
    control.calls++;
    const url = new URL(input);
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token') {
      if (options.body.get('grant_type') === 'refresh_token' && control.failRefresh) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const ids = options.body.get('grant_type') === 'refresh_token' ? refresh.get(options.body.get('refresh_token')) : [...control.channels];
      if (!ids) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const accessToken = randomBytes(24).toString('base64url');
      const refreshToken = randomBytes(24).toString('base64url');
      access.set(accessToken, ids); refresh.set(refreshToken, ids); control.tokens.push(accessToken, refreshToken);
      return Response.json({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly' });
    }
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/revoke') return new Response('', { status: control.failRevoke ? 503 : 200 });
    const ids = access.get(new Headers(options.headers).get('Authorization')?.slice(7));
    if (!ids) return Response.json({ error: 'unauthorized' }, { status: 401 });
    if (url.origin === 'https://www.googleapis.com' && url.pathname === '/youtube/v3/channels') return Response.json(channelItems(ids));
    if (url.origin === 'https://www.googleapis.com' && url.pathname === '/youtube/v3/playlistItems') return Response.json({ items: [] });
    if (url.origin === 'https://youtubeanalytics.googleapis.com' && url.pathname === '/v2/reports') {
      if (control.onReports) await control.onReports();
      if (!ids.includes(url.searchParams.get('ids').replace('channel==', ''))) return new Response('', { status: 403 });
      const metrics = url.searchParams.get('metrics').split(',');
      if (url.searchParams.get('dimensions') === 'day') return Response.json({ columnHeaders: ['day', ...metrics].map(name => ({ name })), rows: [['2026-10-20', ids[0] === CHANNEL_A ? 10 : 20, 30, 2, 1]] });
      return Response.json({ columnHeaders: metrics.map(name => ({ name })), rows: [[ids[0] === CHANNEL_A ? 10 : 20, 30, 2, 1, 180, 10]] });
    }
    throw new Error('Unexpected fixture endpoint');
  };
  return { fetch, control };
}

export async function authorize(service, principal, channelId = CHANNEL_A) {
  const start = await service.beginGoogle(principal);
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const result = await service.completeGoogle({ browserNonce: start.browserNonce, callbackUrl: `${ORIGIN}/oauth/google/callback?state=${state}&code=synthetic-code` });
  await service.selectChannel(principal, result.connectionId, channelId);
  return result.connectionId;
}
