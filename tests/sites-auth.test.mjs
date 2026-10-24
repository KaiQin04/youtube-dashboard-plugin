import test from 'node:test';
import assert from 'node:assert/strict';
import { createSitesApp } from '../src/sites-app.mjs';
import { createSitesPrincipal, requirePrincipal } from '../src/auth/identity.mjs';
import { AppError } from '../src/errors.mjs';

const ORIGIN = 'https://synthetic-sites.example';
const A = { userId: 'synthetic-sites-user-a' };
const B = { userId: 'synthetic-sites-user-b' };
const TOKEN = 'S'.repeat(43);
const NONCE = 'N'.repeat(43);
const CONNECTION = 'C'.repeat(43);
const config = { publicOrigin: ORIGIN, encryptionKey: Buffer.alloc(32, 7).toString('base64url'), googleClientId: 'synthetic-client', googleClientSecret: 'synthetic-secret' };

function fixture(overrides = {}) {
  let constructions = 0;
  const calls = [], pending = new Map();
  const owner = requirePrincipal(createSitesPrincipal(A.userId, ORIGIN), 'dashboard:read');
  const service = {
    async listConnections(principal) {
      const id = requirePrincipal(principal, 'dashboard:read'); calls.push(['list', id]);
      return id === owner ? [{ id: CONNECTION, status: 'connected' }] : [];
    },
    async getConnection(principal, id) {
      if (requirePrincipal(principal, 'dashboard:read') !== owner || id !== CONNECTION) throw new AppError('NOT_FOUND', 'Connection not found.', 404);
      return { id };
    },
    async getDashboard(principal, id) { return this.getConnection(principal, id); },
    async beginGoogle(principal) {
      pending.set(TOKEN, { owner: requirePrincipal(principal, 'dashboard:manage'), nonce: NONCE });
      return { connectionId: CONNECTION, authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?state=${TOKEN}`, browserNonce: NONCE, expiresInSeconds: 600 };
    },
    async completeGoogle({ callbackUrl, browserNonce, principal }) {
      const state = new URL(callbackUrl).searchParams.get('state'), record = pending.get(state);
      if (!record || record.nonce !== browserNonce || record.owner !== requirePrincipal(principal, 'dashboard:manage')) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
      pending.delete(state); calls.push(['completed', record.owner]);
      return { connectionId: CONNECTION };
    },
    async selectChannel(principal, id) { return this.getConnection(principal, id); },
  };
  const app = createSitesApp({ config, createService: () => { constructions++; return service; }, webResource: path => ['/','/panel'].includes(path) ? { body: '<html lang="zh-Hant"></html>', type: 'text/html', policy: "default-src 'none'" } : null, ...overrides });
  const call = (path, user = A, { data, method = data === undefined ? 'GET' : 'POST', headers = {} } = {}) => app(new Request(ORIGIN + path, { method, headers: { ...(data === undefined ? {} : { 'content-type': 'application/json', origin: ORIGIN }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), user);
  const rpc = (name, user = A, arguments_ = {}) => call('/mcp', user, { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: arguments_ } } });
  return { app, call, rpc, calls, pending, service, constructions: () => constructions };
}

test('Sites principal is scoped to this site and opaque to untrusted callers', () => {
  const a = createSitesPrincipal(A.userId, ORIGIN), again = createSitesPrincipal(A.userId, ORIGIN);
  assert.equal(requirePrincipal(a, 'dashboard:read'), requirePrincipal(again, 'dashboard:manage'));
  assert.notEqual(a.id, createSitesPrincipal(A.userId, 'https://other-sites.example').id);
  assert.throws(() => requirePrincipal({ ...a }, 'dashboard:read'), { code: 'UNAUTHORIZED' });
  for (const id of [null, '', ' space ', 'x'.repeat(257)]) assert.throws(() => createSitesPrincipal(id, ORIGIN));
});

test('untrusted request identity headers never establish a Sites principal', async () => {
  const f = fixture();
  for (const user of [undefined, {}, { userId: '' }]) {
    const response = await f.app(new Request(ORIGIN + '/api/connections', { headers: { 'oai-authenticated-user-id': A.userId, 'x-user-id': A.userId, authorization: 'Bearer synthetic-token' } }), user);
    assert.equal(response.status, 401);
  }
  assert.equal(f.constructions(), 0);
});

test('website and MCP map the same verified Sites ID to one tenant', async () => {
  const f = fixture();
  const browser = await (await f.call('/api/connections')).json();
  const mcp = (await (await f.rpc('list_youtube_connections')).json()).result.structuredContent;
  assert.deepEqual(browser.connections, mcp.connections);
  assert.equal(f.calls[0][1], f.calls[1][1]);
  assert.deepEqual((await (await f.call('/api/connections', B)).json()).connections, []);
  assert.equal((await f.call(`/api/connections/${CONNECTION}`, B)).status, 404);
  assert.equal((await (await f.rpc('get_youtube_dashboard', B, { connectionId: CONNECTION })).json()).result.structuredContent.error.code, 'NOT_FOUND');
});

test('session exposes a generic label and user-bound CSRF, never the opaque identity', async () => {
  const f = fixture();
  const a = await (await f.call('/api/session')).json(), b = await (await f.call('/api/session', B)).json();
  assert.equal(a.accountLabel, 'ChatGPT 帳號'); assert.equal(a.authMode, 'sites');
  assert.match(a.csrfToken, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(a.csrfToken, b.csrfToken);
  assert.equal(a.csrfToken, (await (await fixture().call('/api/session')).json()).csrfToken);
  assert.equal(JSON.stringify(a).includes(A.userId), false);
  assert.equal(f.constructions(), 0);
});

test('browser writes require exact origin and this user CSRF after account switching', async () => {
  const f = fixture(), a = await (await f.call('/api/session')).json();
  const data = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
  for (const options of [{ headers: {} }, { headers: { 'x-csrf-token': a.csrfToken, origin: 'https://attacker.example' } }, { user: B, headers: { 'x-csrf-token': a.csrfToken } }, { headers: { 'x-csrf-token': a.csrfToken, origin: '' } }]) {
    assert.equal((await f.call('/browser/rpc', options.user ?? A, { data, headers: options.headers })).status, 403);
  }
  assert.equal((await f.call('/browser/rpc', A, { data, headers: { 'x-csrf-token': a.csrfToken } })).status, 200);
});

test('OAuth uses per-state secure cookies, owner binding, and one-use state across replicas', async () => {
  const f = fixture(), session = await (await f.call('/api/session')).json();
  assert.equal((await f.call('/oauth/google/start', A, { data: {}, headers: { 'x-csrf-token': session.csrfToken } })).status, 400);
  const started = await f.call('/oauth/google/start', A, { data: { acceptedPrivacy: true }, headers: { 'x-csrf-token': session.csrfToken } });
  assert.equal(started.status, 200);
  const cookie = started.headers.get('set-cookie'), data = await started.json();
  assert.match(cookie, /^__Host-ytd-sites-oauth-/); assert.match(cookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
  assert.equal(JSON.stringify(data).includes(NONCE), false); assert.equal(Object.hasOwn(data, 'browserNonce'), false);
  const callback = `/oauth/google/callback?state=${TOKEN}&code=synthetic-code`;
  const failed = await f.call(callback, B, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(failed.headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED'); assert.equal(f.pending.size, 1);
  const missingCookie = await f.call(callback); assert.equal(missingCookie.headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED'); assert.equal(f.pending.size, 1);
  const replica = fixture({ createService: () => f.service });
  const completed = await replica.call(callback, A, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(completed.headers.get('location'), '/?notice=YOUTUBE_CONNECTED'); assert.equal(f.pending.size, 0);
  const replay = await f.call(callback, A, { headers: { cookie: cookie.split(';')[0] } });
  assert.equal(replay.headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED');
  assert.equal(f.calls.filter(([type]) => type === 'completed').length, 1);
});

test('OAuth cookies reject duplicates and callback parameters cannot select another owner', async () => {
  const f = fixture(), session = await (await f.call('/api/session')).json();
  const start = await f.call('/oauth/google/start', A, { data: { acceptedPrivacy: true }, headers: { 'x-csrf-token': session.csrfToken } });
  const cookie = start.headers.get('set-cookie').split(';')[0];
  for (const [query, cookies] of [[`state=${TOKEN}&code=synthetic`, `${cookie}; ${cookie}`], [`state=${TOKEN}&state=${TOKEN}&code=synthetic`, cookie]]) {
    const response = await f.call('/oauth/google/callback?' + query, A, { headers: { cookie: cookies } });
    assert.equal(response.headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED'); assert.equal(f.pending.size, 1);
  }
  assert.equal((await f.call('/oauth/google/start', A, { data: { acceptedPrivacy: true, userId: B.userId }, headers: { 'x-csrf-token': session.csrfToken } })).status, 400);
});

test('anonymous MCP metadata is discoverable, but tool calls require verified Sites identity', async () => {
  const f = fixture();
  for (const method of ['initialize', 'tools/list', 'server/discover']) {
    const result = await f.call('/mcp', {}, { data: { jsonrpc: '2.0', id: 1, method, params: { protocolVersion: '2026-07-28' } } });
    assert.equal(result.status, 200);
    const text = await result.text(); assert.equal(text.includes('dashboard:read'), false); assert.equal(text.includes('dashboard:manage'), false);
    if (method === 'tools/list') assert.match(text, /open_youtube_dashboard/);
    if (method === 'server/discover') assert.deepEqual(JSON.parse(text).result.supportedVersions, ['2026-07-28']);
  }
  assert.equal((await f.rpc('list_youtube_connections', {})).status, 401);
  assert.equal(f.constructions(), 0);
});

test('unconfigured deployment gives setup status without constructing a service or exposing secrets', async () => {
  const f = fixture({ config: { publicOrigin: ORIGIN }, readiness: { ready: false, missing: ['googleClientId', 'googleClientSecret', 'encryptionKey'] } });
  const session = await (await f.call('/api/session')).json();
  assert.equal(session.authenticated, true); assert.equal(session.csrfToken, null); assert.equal(session.configurationReady, false);
  const list = await (await f.call('/api/connections')).json(); assert.deepEqual(list.connections, []); assert.equal(list.configurationReady, false);
  const tools = await (await f.rpc('list_youtube_connections')).json(); assert.deepEqual(tools.result.structuredContent.connections, []);
  const open = await (await f.rpc('open_youtube_dashboard')).json();
  assert.equal(open.result.structuredContent.url, ORIGIN + '/'); assert.equal(open.result.structuredContent.configurationReady, false);
  assert.equal((await f.call('/oauth/google/start', A, { data: {} })).status, 503);
  assert.equal(f.constructions(), 0);
});

test('Sites host uses platform links and reserved authentication paths stay outside this adapter', async () => {
  const f = fixture();
  const page = await (await f.call('/', {})).text(); assert.match(page, /data-auth-mode="sites"/);
  const session = await (await f.call('/api/session', {})).json();
  assert.equal(session.signInUrl, '/signin-with-chatgpt?return_to=%2F');
  for (const path of ['/auth/login', '/auth/logout', '/auth/google/callback', '/callback', '/signin-with-chatgpt', '/signout-with-chatgpt', '/.well-known/oauth-authorization-server']) assert.equal((await f.call(path)).status, 404);
});
