import { AppError, safeError } from './errors.mjs';
import { BrowserAuth } from './auth/browser.mjs';
import { createApp } from './app.mjs';
import { handleMcp } from './mcp.mjs';
import { readJson } from './google.mjs';
import { webResource } from './web-resource.mjs';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
const json = (value, status = 200) => Response.json(value, { status, headers });
function redirect(location, cookies = []) {
  const result = new Headers({ ...headers, Location: location });
  for (const cookie of cookies) result.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers: result });
}

/** Browser sessions are scoped to web routes; the external MCP bearer contract stays separate. */
export function createWebApp({ service, config, loginJwks, fetchImpl = globalThis.fetch, now = () => Date.now(), synthetic = false }) {
  const auth = new BrowserAuth({ config, loginJwks, fetchImpl, now });
  const api = createApp({ service, publicOrigin: config.publicOrigin, issuer: 'https://accounts.google.com', authenticate: async request => auth.session(request).principal });
  return async request => {
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== config.publicOrigin) throw new AppError('INVALID_HOST', 'Unknown service origin.', 403);
      if ((origin && origin !== config.publicOrigin) || request.headers.get('sec-fetch-site') === 'cross-site' && request.method !== 'GET') throw new AppError('INVALID_ORIGIN', 'Cross-origin requests are not allowed.', 403);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
        const asset = webResource(url.pathname, synthetic);
        if (asset) return new Response(asset.body, { headers: { ...headers, ...(url.pathname === '/' ? {'Referrer-Policy':'same-origin'} : {}), 'Content-Type': asset.type, ...(asset.policy ? { 'Content-Security-Policy': asset.policy } : {}) } });
      }
      if (request.method === 'POST' && url.pathname === '/auth/login') {
        if (origin !== config.publicOrigin) throw new AppError('CSRF_REJECTED', 'Start login from this website.', 403);
        const start = auth.begin(request); return redirect(start.location, [start.cookie]);
      }
      if (request.method === 'GET' && url.pathname === '/auth/google/callback') {
        try { const result = await auth.complete(request); return redirect('/?notice=SIGNED_IN', result.cookies); }
        catch { return redirect('/?notice=LOGIN_FAILED'); }
      }
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const session = auth.session(request, false);
        return session ? json({ authenticated: true, accountLabel: 'Google · ' + session.principal.id.slice(0, 12), csrfToken: session.csrf }) : json({ authenticated: false }, 401);
      }
      if (request.method === 'GET' && url.pathname === '/oauth/google/callback') {
        try {
          const session = auth.session(request), grant = auth.consumeGoogle(request, session);
          await service.completeGoogle({ callbackUrl: url.href, browserNonce: grant.browserNonce });
          if (!session.active) throw new AppError('LOGIN_REQUIRED', 'Sign in again.', 401);
          return redirect('/?notice=YOUTUBE_CONNECTED');
        } catch { return redirect('/?notice=YOUTUBE_AUTH_FAILED'); }
      }
      if (url.pathname === '/mcp' || url.pathname.startsWith('/.well-known/')) return json({ error: { code: 'MCP_NOT_CONFIGURED', message: 'Use a separately configured MCP authorization server.' } }, 404);
      const session = auth.session(request);
      if (request.method !== 'GET') auth.requireCsrf(request, session);
      if (request.method === 'GET' && url.pathname === '/panel') {
        const asset = webResource('/panel');
        return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type, 'Content-Security-Policy': asset.policy } });
      }
      if (request.method === 'POST' && url.pathname === '/auth/logout') return new Response('{"signedOut":true}', { headers: { ...headers, 'Content-Type': 'application/json', 'Set-Cookie': auth.logout(request) } });
      if (request.method === 'POST' && url.pathname === '/oauth/google/start') {
        const start = await service.beginGoogle(session.principal); auth.bindGoogle(session, start);
        return json({ connectionId: start.connectionId, authorizationUrl: start.authorizationUrl, expiresInSeconds: start.expiresInSeconds });
      }
      if (request.method === 'POST' && url.pathname === '/browser/rpc') {
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new AppError('INVALID_BODY', 'Use application/json.', 415);
        let message;
        try { message = await readJson(request, 65536); } catch { throw new AppError('INVALID_BODY', 'Invalid or oversized JSON body.'); }
        const result = await handleMcp(service, session.principal, message);
        return result === null ? new Response(null, { status: 202, headers }) : json(result);
      }
      if (url.pathname.startsWith('/api/')) return api(request);
      return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404);
    } catch (error) { return json(safeError(error), error instanceof AppError ? error.status : 500); }
  };
}
