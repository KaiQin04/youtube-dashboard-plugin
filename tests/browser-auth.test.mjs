import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebApp } from '../src/web-app.mjs';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { browserFixture } from '../examples/browser-fixtures.mjs';
import { configuration, ORIGIN } from './helpers.mjs';

async function harness(t) {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const provider = await browserFixture();
  const config = { ...configuration(), googleLoginClientId: 'synthetic-login-client', googleLoginClientSecret: 'synthetic-login-secret' };
  const service = new DashboardService({ store, config, fetchImpl: provider.fetch, now: () => provider.control.now });
  const app = createWebApp({ service, config, loginJwks: provider.jwks, fetchImpl: provider.fetch, now: () => provider.control.now });
  return { app, provider, config, service };
}
const cookiePair = response => response.headers.get('set-cookie')?.split(';')[0];
function request(path, { cookie, csrf, body, origin = ORIGIN, method = body ? 'POST' : 'GET' } = {}) {
  return new Request(ORIGIN + path, { method, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {} ) }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
async function login(h, account = 'a') {
  const start = await h.app(request('/auth/login', { method: 'POST' }));
  const url = start.headers.get('location');
  const callback = h.provider.authorize(url, { account });
  const result = await h.app(new Request(callback, { headers: { cookie: cookiePair(start) } }));
  assert.equal(result.status, 303);
  const cookie = cookiePair(result);
  const session = await (await h.app(request('/api/session', { cookie }))).json();
  return { cookie, csrf: session.csrfToken, label: session.accountLabel, result };
}

test('Google browser login establishes a server session and logout invalidates it', async t => {
  const h = await harness(t);
  assert.equal((await h.app(request('/api/connections'))).status, 401);
  const user = await login(h);
  assert.match(user.result.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(user.result.headers.get('location'), '/?notice=SIGNED_IN');
  assert.ok(user.label); assert.ok(user.csrf);
  assert.deepEqual(await (await h.app(request('/api/connections', user))).json(), { connections: [] });
  assert.equal((await h.app(request('/auth/logout', { ...user, body: {} }))).status, 200);
  assert.equal((await h.app(request('/api/connections', user))).status, 401);
});

async function connect(h, user, account) {
  const response = await h.app(request('/oauth/google/start', { ...user, body: {} }));
  assert.equal(response.status, 200);
  const start = await response.json();
  const callback = h.provider.authorize(start.authorizationUrl, { account });
  const done = await h.app(new Request(callback, { headers: { cookie: user.cookie } }));
  assert.equal(done.headers.get('location'), '/?notice=YOUTUBE_CONNECTED');
  const connections = (await (await h.app(request('/api/connections', user))).json()).connections;
  const connection = connections.find(item => item.id === start.connectionId);
  assert.equal(connection.status, 'select_channel');
  const selected = await h.app(request(`/api/connections/${connection.id}/channel`, { ...user, body: { channelId: connection.channels[0].id } }));
  assert.equal(selected.status, 200);
  return connection.id;
}
async function rpc(h, user, name, args = {}) {
  const response = await h.app(request('/browser/rpc', { ...user, body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } }));
  assert.equal(response.status, 200);
  return (await response.json()).result;
}

test('two Google logins select their own channels, sync data and retain isolated layouts after signing in again', async t => {
  const h = await harness(t), a = await login(h, 'a'), b = await login(h, 'b');
  const aid = await connect(h, a, 'a'), bid = await connect(h, b, 'b');
  const before = await rpc(h, a, 'get_youtube_dashboard', { connectionId: aid });
  assert.equal(before.structuredContent.hasData, false);
  for (const [user, id] of [[a, aid], [b, bid]]) await rpc(h, user, 'refresh_youtube_data', { connectionId: id, startDate: '2026-09-23', endDate: '2026-10-20' });
  const adata = (await rpc(h, a, 'get_youtube_dashboard', { connectionId: aid })).structuredContent;
  const bdata = (await rpc(h, b, 'get_youtube_dashboard', { connectionId: bid })).structuredContent;
  assert.equal(adata.metrics.views, 141064); assert.equal(bdata.metrics.views, 282128);
  assert.equal(adata.channel.id, 'UCaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(bdata.channel.id, 'UCbbbbbbbbbbbbbbbbbbbbbb');
  const layout = { ...adata.layout, theme: 'nord', mode: 'dark' };
  assert.equal((await rpc(h, a, 'update_dashboard_layout', { connectionId: aid, layout })).isError, undefined);
  assert.equal((await rpc(h, b, 'get_youtube_dashboard', { connectionId: aid })).structuredContent.error.code, 'NOT_FOUND');
  assert.equal((await rpc(h, b, 'update_dashboard_layout', { connectionId: aid, layout })).structuredContent.error.code, 'NOT_FOUND');
  assert.equal((await rpc(h, b, 'get_youtube_dashboard', { connectionId: bid })).structuredContent.layout.theme, 'cold-porcelain');
  await h.app(request('/auth/logout', { ...a, body: {} }));
  const again = await login(h, 'a');
  assert.equal(again.label, a.label);
  assert.equal((await rpc(h, again, 'get_youtube_dashboard', { connectionId: aid })).structuredContent.layout.theme, 'nord');
});

test('login rejects wrong browsers, replay, forged ID claims and provider diagnostics', async t => {
  const h = await harness(t);
  const start = await h.app(request('/auth/login', { method: 'POST' }));
  const authorization = new URL(start.headers.get('location'));
  assert.equal(authorization.searchParams.get('scope'), 'openid');
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.has('client_secret'), false);
  const callback = h.provider.authorize(authorization.href);
  assert.equal((await h.app(new Request(callback))).headers.get('location'), '/?notice=LOGIN_FAILED');
  assert.equal(h.provider.control.loginExchanges, 0);
  const valid = await h.app(new Request(callback, { headers: { cookie: cookiePair(start) } }));
  assert.match(valid.headers.get('location'), /SIGNED_IN/);
  assert.equal((await h.app(new Request(callback, { headers: { cookie: cookiePair(start) } }))).headers.get('location'), '/?notice=LOGIN_FAILED');
  for (const claims of [{ aud: 'another-client' }, { iss: 'https://forged.example' }, { nonce: 'incorrect' }, { exp: 1 }, { sub: '' }, { azp: 'another-client' }]) {
    h.provider.control.claims = claims;
    const failed = await h.app(request('/auth/login', { method: 'POST' }));
    const response = await h.app(new Request(h.provider.authorize(failed.headers.get('location')), { headers: { cookie: cookiePair(failed) } }));
    assert.equal(response.headers.get('location'), '/?notice=LOGIN_FAILED');
    assert.equal(response.headers.has('set-cookie'), false);
  }
  h.provider.control.claims = {}; h.provider.control.failLogin = true;
  const failed = await h.app(request('/auth/login', { method: 'POST' }));
  const response = await h.app(new Request(h.provider.authorize(failed.headers.get('location')), { headers: { cookie: cookiePair(failed) } }));
  assert.equal(response.headers.get('location'), '/?notice=LOGIN_FAILED');
  assert.equal((await response.text()).includes('synthetic-provider-private-diagnostic'), false);
});

test('session CSRF, caller identity forgery, cross-session authorization and expiry fail closed', async t => {
  const h = await harness(t), a = await login(h, 'a'), b = await login(h, 'b');
  assert.equal((await h.app(request('/auth/login', { method: 'POST', origin: 'https://foreign.example' }))).status, 403);
  assert.equal((await h.app(request('/auth/logout', { cookie: a.cookie, body: {} }))).status, 403);
  assert.equal((await h.app(request('/oauth/google/start', { ...a, csrf: b.csrf, body: {} }))).status, 403);
  assert.equal((await h.app(request('/mcp', { ...a, body: {} }))).status, 404);
  assert.equal((await h.app(new Request(ORIGIN + '/api/connections', { headers: { 'oai-authenticated-user-id': 'user-a' } }))).status, 401);
  const start = await (await h.app(request('/oauth/google/start', { ...a, body: {} }))).json();
  const url = new URL(start.authorizationUrl);
  assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'].sort());
  assert.equal('browserNonce' in start, false);
  const callback = h.provider.authorize(url.href);
  assert.equal((await h.app(new Request(callback, { headers: { cookie: b.cookie } }))).headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED');
  assert.equal((await h.app(new Request(callback, { headers: { cookie: a.cookie } }))).headers.get('location'), '/?notice=YOUTUBE_CONNECTED');
  assert.equal((await h.app(new Request(callback, { headers: { cookie: a.cookie } }))).headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED');
  const pending = await (await h.app(request('/oauth/google/start', { ...a, body: {} }))).json();
  await h.app(request('/auth/logout', { ...a, body: {} }));
  assert.equal((await h.app(new Request(h.provider.authorize(pending.authorizationUrl), { headers: { cookie: a.cookie } }))).headers.get('location'), '/?notice=YOUTUBE_AUTH_FAILED');
  h.provider.control.now += 1800001;
  assert.equal((await h.app(request('/api/connections', b))).status, 401);
});

test('plain HTTP is opt-in and limited to an exact loopback origin with separate local cookies', async t => {
  const provider = await browserFixture(), store = new SqliteStore(':memory:');t.after(() => store.close());
  const config = { ...configuration(), publicOrigin: 'http://127.0.0.1:4318', allowLoopbackHttp: true, googleLoginClientId: 'synthetic-login-client', googleLoginClientSecret: 'synthetic-login-secret' };
  const service = new DashboardService({ store, config, fetchImpl: provider.fetch, now: () => provider.control.now });
  const app = createWebApp({ service, config, loginJwks: provider.jwks, fetchImpl: provider.fetch, now: () => provider.control.now });
  const response = await app(new Request(config.publicOrigin + '/auth/login', { method: 'POST', headers: { origin: config.publicOrigin } }));
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /^ytd-local-4318-login-/);
  assert.doesNotMatch(response.headers.get('set-cookie'), /__Host-|; Secure/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  for (const changes of [{ allowLoopbackHttp: false }, { publicOrigin: 'http://192.0.2.1:4318' }, { publicOrigin: 'http://127.0.0.1:4318/path' }]) {
    assert.throws(() => new DashboardService({ store, config: { ...config, ...changes } }), { code: 'CONFIGURATION' });
  }
});

test('browser entry is public, its dashboard requires login and browser RPC rejects malformed bodies', async t => {
  const h = await harness(t);
  const home = await h.app(request('/'));
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Cold Porcelain/);
  assert.match(html, /action="\/auth\/login"/);
  assert.doesNotMatch(html, /client_secret|access_token|refresh_token/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('referrer-policy'), 'same-origin');
  assert.ok(home.headers.get('content-security-policy').includes("form-action 'self' https://accounts.google.com"));
  assert.equal((await h.app(request('/assets/web.js'))).status, 200);
  assert.equal((await h.app(request('/panel'))).status, 401);
  const user = await login(h);
  const panel = await h.app(request('/panel', user));
  assert.equal(panel.status, 200);
  assert.match(panel.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  for (const body of ['{', ' '.repeat(65537)]) {
    const response = await h.app(new Request(ORIGIN + '/browser/rpc', { method: 'POST', headers: { cookie: user.cookie, origin: ORIGIN, 'x-csrf-token': user.csrf, 'content-type': 'application/json' }, body }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_BODY');
  }
});

test('same-channel Google users remain isolated and restarting the browser adapter preserves ownership', async t => {
  const h = await harness(t), a = await login(h, 'a'), b = await login(h, 'b');
  const aid = await connect(h, a, 'a'), bid = await connect(h, b, 'a');
  await rpc(h, a, 'refresh_youtube_data', { connectionId: aid });
  const adata = (await rpc(h, a, 'get_youtube_dashboard', { connectionId: aid })).structuredContent;
  await rpc(h, a, 'update_dashboard_layout', { connectionId: aid, layout: { ...adata.layout, theme: 'dracula' } });
  const bdata = (await rpc(h, b, 'get_youtube_dashboard', { connectionId: bid })).structuredContent;
  assert.equal(adata.channel.id, bdata.channel.id);
  assert.equal(bdata.hasData, false); assert.equal(bdata.layout.theme, 'cold-porcelain');
  assert.equal((await rpc(h, b, 'get_youtube_dashboard', { connectionId: aid })).structuredContent.error.code, 'NOT_FOUND');
  h.app = createWebApp({ service: h.service, config: h.config, loginJwks: h.provider.jwks, fetchImpl: h.provider.fetch, now: () => h.provider.control.now });
  assert.equal((await h.app(request('/api/session', a))).status, 401);
  const again = await login(h, 'a');
  const restored = (await rpc(h, again, 'get_youtube_dashboard', { connectionId: aid })).structuredContent;
  assert.equal(restored.hasData, true); assert.equal(restored.layout.theme, 'dracula');
});

test('cancelled, expired and incorrectly signed browser login responses never establish sessions', async t => {
  const h = await harness(t);
  for (const mode of ['cancel', 'expire', 'duplicate']) {
    const start = await h.app(request('/auth/login', { method: 'POST' }));
    const callback = new URL(h.provider.authorize(start.headers.get('location'), { cancel: mode === 'cancel' }));
    if (mode === 'expire') h.provider.control.now += 600001;
    if (mode === 'duplicate') callback.searchParams.append('state', callback.searchParams.get('state'));
    const failed = await h.app(new Request(callback, { headers: { cookie: cookiePair(start) } }));
    assert.equal(failed.headers.get('location'), '/?notice=LOGIN_FAILED');
    assert.equal(failed.headers.has('set-cookie'), false);
  }
  assert.equal(h.provider.control.loginExchanges, 0);
  const wrongSigner = await browserFixture();
  h.app = createWebApp({ service: h.service, config: h.config, loginJwks: wrongSigner.jwks, fetchImpl: h.provider.fetch, now: () => h.provider.control.now });
  const start = await h.app(request('/auth/login', { method: 'POST' }));
  const failed = await h.app(new Request(h.provider.authorize(start.headers.get('location')), { headers: { cookie: cookiePair(start) } }));
  assert.equal(failed.headers.get('location'), '/?notice=LOGIN_FAILED'); assert.equal(failed.headers.has('set-cookie'), false);
});
