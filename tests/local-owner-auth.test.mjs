import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLocalWorkspace } from '../src/local-workspace.mjs';
const call = name => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } });
test('anonymous loopback clients cannot obtain an owner session, even with forged Origin', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-owner-auth-'));
  const runtime = await startLocalWorkspace({ directory, port: 0, fetchImpl: () => { throw new Error('No Google access expected'); } });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  for (const path of ['/', '/setup', '/?access=guess']) {
    const response = await fetch(runtime.url + path);
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.doesNotMatch(await response.text(), /#[^" ]*access=/);
  }
  assert.equal((await fetch(runtime.url + '/api/session')).status, 401);
  assert.equal((await fetch(runtime.url + '/panel')).status, 401);
  assert.equal((await fetch(runtime.url + '/browser/rpc', { method: 'POST', headers: { origin: runtime.url, 'content-type': 'application/json' }, body: JSON.stringify(call('list_youtube_connections')) })).status, 401);
  const wrong = await fetch(runtime.url + '/api/local/unlock', { method: 'POST', headers: { origin: runtime.url, 'content-type': 'application/json' }, body: JSON.stringify({ token: 'a'.repeat(43) }) });
  assert.equal(wrong.status, 401); assert.equal(wrong.headers.getSetCookie().length, 0);
});
test('trusted launch is one-use, concurrent-safe, and expires on restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-owner-launch-'));
  let runtime = await startLocalWorkspace({ directory, port: 0 });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const opened = await runtime.rpc(call('open_youtube_dashboard'));
  const launch = new URL(opened.result.structuredContent.url);
  const token = new URLSearchParams(launch.hash.slice(1)).get('access');
  assert.match(token ?? '', /^[A-Za-z0-9_-]{43}$/); assert.equal(launch.search, ''); assert.equal(launch.origin, runtime.url);
  const unlock = (origin, value) => fetch(runtime.url + '/api/local/unlock', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token: value }) });
  assert.equal((await unlock('https://other.example', token)).status, 403);
  const attempts = await Promise.all(Array.from({ length: 4 }, () => unlock(runtime.url, token)));
  assert.deepEqual(attempts.map(response => response.status).sort(), [200,401,401,401]);
  const response = attempts.find(response => response.status === 200), cookie = response.headers.getSetCookie()[0].split(';')[0];
  assert.match(response.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax/);
  const session = await (await fetch(runtime.url + '/api/session', { headers: { cookie } })).json();
  assert.equal(session.authenticated, true); assert.equal(JSON.stringify(session).includes(token), false);
  const noCsrf = await fetch(runtime.url + '/browser/rpc', { method: 'POST', headers: { cookie, origin: runtime.url, 'content-type': 'application/json' }, body: JSON.stringify(call('list_youtube_connections')) });
  assert.equal(noCsrf.status, 403);
  const next = new URL((await runtime.rpc(call('open_youtube_dashboard'))).result.structuredContent.url);
  const unused = new URLSearchParams(next.hash.slice(1)).get('access');
  await runtime.close(); runtime = await startLocalWorkspace({ directory, port: 0 });
  assert.equal((await unlock(runtime.url, unused)).status, 401);
  assert.equal((await fetch(runtime.url + '/api/session', { headers: { cookie } })).status, 401);
});
