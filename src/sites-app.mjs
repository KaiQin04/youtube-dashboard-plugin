import { AppError, safeError } from './errors.mjs';
import { SitesAuth, SITES_SIGN_IN, SITES_SIGN_OUT } from './auth/sites.mjs';
import { requirePrincipal } from './auth/identity.mjs';
import { handleMcp } from './mcp.mjs';
import { readJson } from './google.mjs';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
const json = (value, status = 200, extra = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
const configurationError = () => new AppError('CONFIGURATION', 'YouTube connection setup is not complete.', 503);
const metadataMethods = new Set(['initialize', 'ping', 'server/discover', 'tools/list', 'resources/list', 'resources/templates/list', 'resources/read', 'notifications/initialized']);
export const PRIVACY_VERSION = '2026-10-24';

function redirect(location, cookie) {
  return new Response(null, { status: 303, headers: { ...headers, Location: location, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}

async function body(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('INVALID_BODY', 'Use application/json.', 415);
  try { return await readJson(request, 65536); } catch { throw new AppError('INVALID_BODY', 'Invalid or oversized JSON body.'); }
}

function objectBody(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new AppError('INVALID_ARGUMENTS', 'Unexpected request fields.');
  return value;
}

/** Fetch boundary only for a hosted Sites route that supplies a verified server-side userId. */
export function createSitesApp({ config, createService, readiness, webResource = () => null }) {
  const origin = new URL(config.publicOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin || origin.username || origin.password) throw new AppError('CONFIGURATION', 'Configure the exact Sites HTTPS origin.', 503);
  const missing = ['googleClientId', 'googleClientSecret', 'encryptionKey'].filter(key => !config[key]);
  const ready = (readiness?.ready ?? missing.length === 0) && /^[A-Za-z0-9_-]{43}$/.test(config.encryptionKey ?? '');
  const status = Object.freeze({ ready: Boolean(ready), missing: (readiness?.missing ?? missing).filter(key => ['googleClientId', 'googleClientSecret', 'encryptionKey', 'database'].includes(key)) });
  const auth = new SitesAuth(config);
  let servicePromise;
  const service = () => {
    if (!status.ready) throw configurationError();
    servicePromise ??= Promise.resolve().then(() => createService());
    return servicePromise;
  };
  const mcpOptions = { sites: true, publicOrigin: config.publicOrigin, readiness: status };
  return async (request, verifiedIdentity = {}) => {
    try {
      const url = new URL(request.url), originHeader = request.headers.get('origin');
      if (url.origin !== config.publicOrigin) throw new AppError('INVALID_HOST', 'Unknown service origin.', 403);
      if (originHeader && originHeader !== config.publicOrigin) throw new AppError('INVALID_ORIGIN', 'Cross-origin requests are not allowed.', 403);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
        const asset = webResource(url.pathname);
        if (asset) return new Response(url.pathname === '/' ? asset.body.replace('<html lang="zh-Hant">', '<html lang="zh-Hant" data-auth-mode="sites">') : asset.body, { headers: { ...headers, 'Content-Type': asset.type, ...(asset.policy ? { 'Content-Security-Policy': asset.policy } : {}) } });
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        let principal;
        try { principal = auth.principal(verifiedIdentity); } catch (error) { if (!(error instanceof AppError) || error.status !== 401) throw error; }
        const base = { authMode: 'sites', readiness: status, configurationReady: status.ready, signInUrl: SITES_SIGN_IN, signOutUrl: SITES_SIGN_OUT, privacyVersion: PRIVACY_VERSION };
        return principal ? json({ ...base, authenticated: true, accountLabel: 'ChatGPT 帳號', csrfToken: auth.csrf(principal) }) : json({ ...base, authenticated: false }, 401);
      }
      if (url.pathname === '/mcp') {
        if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST for this stateless MCP endpoint.' } }, 405, { Allow: 'POST' });
        const message = await body(request);
        const principal = metadataMethods.has(message?.method) ? null : auth.principal(verifiedIdentity);
        const instance = !metadataMethods.has(message?.method) && status.ready && message?.method === 'tools/call' && message?.params?.name !== 'open_youtube_dashboard' ? await service() : null;
        const result = await handleMcp(instance, principal, message, mcpOptions);
        return result === null ? new Response(null, { status: 202, headers }) : json(result);
      }
      if (request.method === 'GET' && url.pathname === '/oauth/google/callback') {
        const state = url.searchParams.get('state');
        let clearCookie;
        try {
          const principal = auth.principal(verifiedIdentity);
          if (url.searchParams.getAll('state').length !== 1) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
          const browserNonce = auth.callbackNonce(request, state);
          clearCookie = auth.oauthCookie(state, '', 0);
          await (await service()).completeGoogle({ callbackUrl: url.href, browserNonce, principal });
          return redirect('/?notice=YOUTUBE_CONNECTED', clearCookie);
        } catch { return redirect('/?notice=YOUTUBE_AUTH_FAILED', clearCookie); }
      }
      if (!['/panel', '/browser/rpc', '/oauth/google/start', '/api/connections'].includes(url.pathname) && !/^\/api\/connections\//.test(url.pathname)) return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404);
      const principal = auth.principal(verifiedIdentity);
      requirePrincipal(principal, 'dashboard:read');
      if (request.method !== 'GET') {
        if (!status.ready) throw configurationError();
        auth.requireCsrf(request, principal);
      }
      if (request.method === 'GET' && url.pathname === '/panel') {
        const asset = webResource('/panel');
        if (!asset) throw new AppError('NOT_FOUND', 'Route not found.', 404);
        return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type, 'Content-Security-Policy': asset.policy } });
      }
      if (request.method === 'GET' && url.pathname === '/api/connections') return json({ connections: status.ready ? await (await service()).listConnections(principal) : [], configurationReady: status.ready, readiness: status });
      if (request.method === 'POST' && url.pathname === '/oauth/google/start') {
        const args = objectBody(await body(request), ['acceptedPrivacy']);
        if (args.acceptedPrivacy !== true) throw new AppError('PRIVACY_ACKNOWLEDGEMENT_REQUIRED', 'Read the privacy notice before connecting YouTube.', 400);
        const start = await (await service()).beginGoogle(principal);
        const state = new URL(start.authorizationUrl).searchParams.get('state');
        return json({ connectionId: start.connectionId, authorizationUrl: start.authorizationUrl, expiresInSeconds: start.expiresInSeconds, privacyVersion: PRIVACY_VERSION }, 200, { 'Set-Cookie': auth.oauthCookie(state, start.browserNonce) });
      }
      if (request.method === 'POST' && url.pathname === '/browser/rpc') {
        const result = await handleMcp(await service(), principal, await body(request), mcpOptions);
        return result === null ? new Response(null, { status: 202, headers }) : json(result);
      }
      const match = /^\/api\/connections\/([A-Za-z0-9_-]{43})(?:\/(data|channel|sync|disconnect))?$/.exec(url.pathname);
      if (match) {
        const [, id, action] = match, instance = await service();
        if (request.method === 'GET' && !action) return json(await instance.getConnection(principal, id));
        if (request.method === 'GET' && action === 'data') return json(await instance.getDashboard(principal, id));
        if (request.method === 'POST') {
          if (action === 'channel') { const args = objectBody(await body(request), ['channelId']); return json(await instance.selectChannel(principal, id, args.channelId)); }
          if (action === 'sync') { const args = objectBody(await body(request), ['startDate', 'endDate']); return json(await instance.refresh(principal, id, Object.keys(args).length ? args : undefined)); }
          if (action === 'disconnect') { const args = objectBody(await body(request), ['confirmed']); if (args.confirmed !== true) throw new AppError('CONFIRMATION_REQUIRED', 'Confirm removal first.'); return json(await instance.disconnect(principal, id)); }
        }
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404);
    } catch (error) { return json(safeError(error), error instanceof AppError ? error.status : 500); }
  };
}
