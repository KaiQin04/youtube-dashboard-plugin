import { readFileSync, chmodSync } from 'node:fs';
import { LocalProfile } from './local-profile.mjs';
import { SqliteStore } from './store.mjs';
import { DashboardService } from './service.mjs';
import { createLocalPrincipal } from './auth/identity.mjs';
import { startLoopback } from './local-server.mjs';
import { handleMcp, TOOLS, PANEL_URI } from './mcp.mjs';
import { AppError, safeError } from './errors.mjs';
import { randomString } from './crypto.mjs';
import { readJson } from './google.mjs';
import { webResource, hostPolicy } from './web-resource.mjs';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'" };
const json = (value, status = 200) => Response.json(value, { status, headers });
const cookieName = (state, port) => 'ytd-local-oauth-' + port + '-' + state.slice(0, 16);
function cookie(request, name) {
  const values = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}
function redirect(path, value) { return new Response(null, { status: 303, headers: { ...headers, Location: path, ...(value ? { 'Set-Cookie': value } : {}) } }); }
async function body(request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError('INVALID_BODY', 'Use application/json.', 415);
  try { return await readJson(request, 65536); } catch { throw new AppError('INVALID_BODY', 'Invalid or oversized JSON.'); }
}
const localTools = TOOLS.map(original => { const tool = { ...original }; delete tool.securitySchemes; return tool; });
for (const [name, description] of [
  ['open_youtube_dashboard', 'Open the shared dashboard panel and return the local setup URL. No connection ID is needed. The user enters first-time Google settings in their own browser. Never request secrets in chat.'],
  ['get_local_setup_status', 'Report setting names, configured status and version only. Never return credential values.'],
]) {
  const definition = { name, description, inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
  if (name === 'open_youtube_dashboard') {
    definition.title = 'YouTube Dashboard';
    definition._meta = {
      ui: { resourceUri: PANEL_URI },
      'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }] },
      'openai/outputTemplate': PANEL_URI,
      'openai/widgetAccessible': true,
    };
  }
  localTools.push(definition);
}

/** Local HTTP and stdio share the existing service, store and panel; no second dashboard core. */
export async function startLocalWorkspace({ directory, port = Number(process.env.YTDASH_PORT || 4318), fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AppError('LOCAL_PORT', 'Choose an unused local port.');
  const profile = new LocalProfile(directory), principal = createLocalPrincipal(profile.owner());
  for (const suffix of ['', '-wal', '-shm']) profile.check('dashboard.sqlite' + suffix);
  const store = new SqliteStore(profile.path('dashboard.sqlite'));
  chmodSync(profile.path('dashboard.sqlite'), 0o600);
  const sessionId = randomString(), csrf = randomString(), launches = new Map();
  let runtime, service;
  const launchUrl = () => {
    for (const [key, expires] of launches) if (expires <= now()) launches.delete(key);
    while (launches.size >= 32) launches.delete(launches.keys().next().value);
    const token = randomString();
    launches.set(token, now() + 300000);
    return runtime.url + '/#access=' + token;
  };
  const configured = () => {
    const config = profile.configuration(runtime?.url || 'http://127.0.0.1:4318');
    return Boolean(config.googleClientId && config.googleClientSecret);
  };
  const status = () => ({ configurationReady: configured(), settings: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].map(name => ({ name, configured: configured(), version: configured() ? 1 : null })), storage: 'local-user-profile' });
  const getService = () => {
    if (!configured()) throw new AppError('CONFIGURATION', 'Open the local dashboard to finish Google setup.', 503);
    service ??= new DashboardService({ store, config: profile.configuration(runtime.url), fetchImpl, now });
    return service;
  };
  const rpc = async (message, trusted = true) => {
    if (message?.method === 'tools/list') return { jsonrpc: '2.0', id: message.id, result: { tools: localTools } };
    if (message?.method === 'tools/call') {
      try {
        const name = message.params?.name, args = message.params?.arguments ?? {};
        if (['open_youtube_dashboard', 'get_local_setup_status', 'list_youtube_connections'].includes(name)) {
          if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new AppError('INVALID_ARGUMENTS', 'No arguments are accepted.');
          const ready = configured();
          const result = name === 'open_youtube_dashboard' ? { url: trusted ? launchUrl() : runtime.url, configurationReady: ready }
            : name === 'list_youtube_connections' ? { connections: ready ? await getService().listConnections(principal) : [], configurationReady: ready, setupUrl: trusted ? launchUrl() : runtime.url }
            : status();
          return { jsonrpc: '2.0', id: message.id, result: { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } };
        }
        return await handleMcp(getService(), principal, message);
      } catch (error) {
        const result = safeError(error);
        return { jsonrpc: '2.0', id: message.id, result: { isError: true, structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] } };
      }
    }
    return handleMcp(null, principal, message);
  };
  try {
    runtime = await startLoopback({ port, createHandler: origin => async request => {
      try {
        const url = new URL(request.url);
        const sessionName = 'ytd-local-session-' + new URL(origin).port;
        const session = cookie(request, sessionName) === sessionId;
        if (request.method === 'GET' && ['/', '/setup'].includes(url.pathname)) {
          return new Response(readFileSync(new URL('./ui/local.html', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': hostPolicy } });
        }
        if (request.method === 'GET' && url.pathname === '/assets/local.js') {
          const branding = readFileSync(new URL('./dashboard/branding.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
          return new Response(branding + '\n' + readFileSync(new URL('./ui/local.js', import.meta.url), 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
        }
        if (request.method === 'GET' && url.pathname === '/assets/web.css') { const asset = webResource(url.pathname); return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type } }); }
        if (request.method === 'POST' && url.pathname === '/api/local/unlock') {
          if (request.headers.get('origin') !== origin) throw new AppError('CSRF_REJECTED', 'Open the dashboard link from your local launcher.', 403);
          const args = await body(request);
          const valid = args && Object.keys(args).length === 1 && typeof args.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(args.token) && launches.get(args.token) > now();
          if (!valid) throw new AppError('LOCAL_SESSION', 'Open a fresh dashboard link from Setup or the Plugin.', 401);
          launches.delete(args.token);
          return new Response('{}', { headers: { ...headers, 'Content-Type': 'application/json', 'Set-Cookie': sessionName + '=' + sessionId + '; Path=/; HttpOnly; SameSite=Lax' } });
        }
        if (!session) throw new AppError('LOCAL_SESSION', 'Open a fresh dashboard link from Setup or the Plugin.', 401);
        if (request.method !== 'GET' && (request.headers.get('origin') !== origin || request.headers.get('x-csrf-token') !== csrf)) throw new AppError('CSRF_REJECTED', 'Reload the local dashboard.', 403);
        if (request.method === 'GET' && url.pathname === '/api/session') return json({ authenticated: true, authMode: 'local', accountLabel: 'Local workspace', csrfToken: csrf, ...status() });
        if (request.method === 'POST' && url.pathname === '/api/local/config') { const result = profile.saveGoogle(await body(request)); service = undefined; return json(result); }
        if (request.method === 'GET' && url.pathname === '/panel') { const asset = webResource('/panel'); return new Response(asset.body, { headers: { ...headers, 'Content-Type': asset.type, 'Content-Security-Policy': asset.policy } }); }
        if (request.method === 'GET' && url.pathname === '/api/connections') return json({ connections: configured() ? await getService().listConnections(principal) : [] });
        if (request.method === 'POST' && url.pathname === '/browser/rpc') return json(await rpc(await body(request), false));
        if (request.method === 'POST' && url.pathname === '/oauth/google/start') {
          const args = await body(request);
          if (!args || args.acceptedPrivacy !== true || Object.keys(args).some(k => k !== 'acceptedPrivacy')) throw new AppError('PRIVACY_ACKNOWLEDGEMENT_REQUIRED', 'Read the local data notice before authorizing.');
          const start = await getService().beginGoogle(principal), state = new URL(start.authorizationUrl).searchParams.get('state');
          return new Response(JSON.stringify({ authorizationUrl: start.authorizationUrl, expiresInSeconds: start.expiresInSeconds }), { headers: { ...headers, 'Content-Type': 'application/json', 'Set-Cookie': cookieName(state, new URL(origin).port) + '=' + start.browserNonce + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=600' } });
        }
        if (request.method === 'GET' && url.pathname === '/oauth/google/callback') {
          const state = url.searchParams.get('state');
          if (!/^[A-Za-z0-9_-]{43}$/.test(state ?? '')) return redirect('/?notice=YOUTUBE_AUTH_FAILED');
          let completed = false;
          try { await getService().completeGoogle({ callbackUrl: url.href, browserNonce: cookie(request, cookieName(state, new URL(origin).port)), principal }); completed = true; } catch { /* Provider responses and codes never enter diagnostics. */ }
          return redirect('/?notice=' + (completed ? 'YOUTUBE_CONNECTED' : 'YOUTUBE_AUTH_FAILED'), cookieName(state, new URL(origin).port) + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }, 404);
      } catch (error) { return json(safeError(error), error instanceof AppError ? error.status : 500); }
    } });
  } catch (error) { store.close(); throw error; }
  return { url: runtime.url, launchUrl, status, rpc, close: async () => { launches.clear(); await runtime.close(); store.close(); } };
}
