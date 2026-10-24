import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorkspace } from '../src/local-workspace.mjs';
import { googleFixture, CHANNEL_A, NOW } from './helpers.mjs';
import { defaultLayout } from '../src/layout.mjs';

test('first-run setup stays local, rejects foreign writes, and never returns credential values', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-local-setup-'));
  let runtime;
  t.after(async () => { await runtime?.close(); await rm(directory, { recursive: true, force: true }); });
  runtime = await startLocalWorkspace({ directory, port: 0, fetchImpl: () => { throw new Error('No network expected during setup'); } });
  const origin = runtime.url;
  assert.equal((await fetch(origin + '/api/session')).status, 401);
  const home = await fetch(origin + '/');
  const cookie = home.headers.getSetCookie()[0].split(';')[0];
  const session = await (await fetch(origin + '/api/session', { headers: { cookie } })).json();
  assert.equal(session.authMode, 'local');
  assert.equal(session.configurationReady, false);
  const settings = { googleClientId: 'synthetic-client.apps.googleusercontent.com', googleClientSecret: 'synthetic-private-value' };
  const save = (originHeader, csrf = session.csrfToken) => fetch(origin + '/api/local/config', { method: 'POST', headers: { cookie, origin: originHeader, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(settings) });
  assert.equal((await save('https://foreign.example')).status, 403);
  assert.equal((await save(origin, 'wrong')).status, 403);
  const saved = await save(origin);
  assert.equal(saved.status, 200);
  const result = await saved.json();
  assert.deepEqual(result, { configured: true, version: 1 });
  const status = await runtime.status();
  assert.equal(status.configurationReady, true);
  assert.equal(JSON.stringify(status).includes(settings.googleClientId), false);
  assert.equal(JSON.stringify(status).includes(settings.googleClientSecret), false);
  if (process.platform !== 'win32') {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    for (const name of ['profile.json', 'google.json', 'dashboard.sqlite']) assert.equal((await stat(join(directory, name))).mode & 0o777, 0o600);
  }
  assert.equal((await save(origin)).status, 409);
  await runtime.close(); runtime = await startLocalWorkspace({ directory, port: 0 });
  assert.equal((await runtime.status()).configurationReady, true);
});

async function browser(runtime) {
  const cookie = (await fetch(runtime.url + '/')).headers.getSetCookie()[0].split(';')[0];
  const session = await (await fetch(runtime.url + '/api/session', { headers: { cookie } })).json();
  return {
    cookie,
    post: (path, data) => fetch(runtime.url + path, { method: 'POST', headers: { cookie, origin: runtime.url, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify(data) }),
  };
}
const message = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('one local authorization verifies the channel and preserves user branding across restart without sharing profiles', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-local-auth-'));
  const otherDirectory = await mkdtemp(join(tmpdir(), 'youtube-local-other-'));
  const google = googleFixture(); let runtime, other;
  t.after(async () => { await runtime?.close(); await other?.close(); await rm(directory, { recursive: true, force: true }); await rm(otherDirectory, { recursive: true, force: true }); });
  runtime = await startLocalWorkspace({ directory, port: 0, fetchImpl: google.fetch, now: () => NOW });
  let client = await browser(runtime);
  await client.post('/api/local/config', { googleClientId: 'synthetic-client.apps.googleusercontent.com', googleClientSecret: 'synthetic-private-value' });
  const initial = await client.post('/oauth/google/start', { acceptedPrivacy: true });
  const data = await initial.json(), authorization = new URL(data.authorizationUrl);
  assert.deepEqual(authorization.searchParams.get('scope').split(' ').sort(), ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly']);
  assert.equal(authorization.searchParams.get('redirect_uri'), runtime.url + '/oauth/google/callback');
  const state = authorization.searchParams.get('state');
  const pendingCookie = initial.headers.getSetCookie()[0].split(';')[0];
  const callback = runtime.url + '/oauth/google/callback?state=' + state + '&code=synthetic-code';
  const wrongBrowser = await fetch(callback, { headers: { cookie: client.cookie }, redirect: 'manual' });
  assert.match(wrongBrowser.headers.get('location'), /YOUTUBE_AUTH_FAILED/);
  const completed = await fetch(callback, { headers: { cookie: client.cookie + '; ' + pendingCookie }, redirect: 'manual' });
  assert.match(completed.headers.get('location'), /YOUTUBE_CONNECTED/);
  assert.doesNotMatch(completed.headers.get('location'), /code=|state=/);
  const list = await runtime.rpc(message('list_youtube_connections'));
  const [connection] = list.result.structuredContent.connections;
  assert.equal(connection.channels[0].id, CHANNEL_A);
  assert.equal(connection.status, 'select_channel');
  await runtime.rpc(message('select_youtube_channel', { connectionId: connection.id, channelId: CHANNEL_A }));
  const layout = { ...defaultLayout(), headerName: 'My Research Studio', headerIcon: 'camera', headerSubtitle: 'Weekly results', showHeaderSubtitle: false };
  assert.equal((await runtime.rpc(message('update_dashboard_layout', { connectionId: connection.id, layout }))).result.isError, undefined);
  const refreshed = await runtime.rpc(message('refresh_youtube_data', { connectionId: connection.id }));
  assert.equal(refreshed.result.isError, undefined);
  assert.equal(refreshed.result.structuredContent.metrics.views, 10);
  assert.equal(google.control.tokens.some(token => JSON.stringify(refreshed).includes(token)), false);
  const panel = await fetch(runtime.url + '/panel', { headers: { cookie: client.cookie } });
  assert.equal(panel.status, 200);
  assert.match(await panel.text(), /自訂介面/);
  const replay = await fetch(callback, { headers: { cookie: client.cookie + '; ' + pendingCookie }, redirect: 'manual' });
  assert.match(replay.headers.get('location'), /YOUTUBE_AUTH_FAILED/);
  await runtime.close(); runtime = await startLocalWorkspace({ directory, port: 0, fetchImpl: google.fetch, now: () => NOW });
  const openingCalls = google.control.calls;
  const opened = await runtime.rpc(message('open_youtube_dashboard'));
  assert.deepEqual(opened.result.structuredContent, { url: runtime.url, configurationReady: true });
  assert.equal(google.control.calls, openingCalls);
  const saved = (await runtime.rpc(message('get_youtube_dashboard', { connectionId: connection.id }))).result.structuredContent;
  assert.equal(saved.connection.channel.id, CHANNEL_A);
  assert.deepEqual(saved.layout, layout);
  assert.equal(saved.hasData, true);
  other = await startLocalWorkspace({ directory: otherDirectory, port: 0, fetchImpl: google.fetch, now: () => NOW });
  const otherClient = await browser(other);
  client = await browser(runtime);
  const sharedCookieJar = client.cookie + '; ' + otherClient.cookie;
  assert.equal((await fetch(runtime.url + '/api/session', { headers: { cookie: sharedCookieJar } })).status, 200);
  assert.equal((await fetch(other.url + '/api/session', { headers: { cookie: sharedCookieJar } })).status, 200);
  await otherClient.post('/api/local/config', { googleClientId: 'synthetic-other.apps.googleusercontent.com', googleClientSecret: 'synthetic-other-secret' });
  assert.deepEqual((await other.rpc(message('list_youtube_connections'))).result.structuredContent.connections, []);
  assert.equal((await other.rpc(message('get_youtube_dashboard', { connectionId: connection.id }))).result.structuredContent.error.code, 'NOT_FOUND');
  const calls = google.control.calls;
  const tools = await runtime.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(tools.result.tools.some(tool => tool.securitySchemes), false);
  assert.ok(tools.result.tools.some(tool => tool.name === 'open_youtube_dashboard'));
  assert.equal(google.control.calls, calls);
});
