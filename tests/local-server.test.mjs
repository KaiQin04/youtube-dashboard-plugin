import test from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { startLoopback, localConfiguration } from '../src/local-server.mjs';

test('local server binds loopback, rejects forged hosts and bounds request bodies', async t => {
  let calls = 0;
  const server = await startLoopback({ port: 0, createHandler: () => async request => {
    calls++;
    return new Response(await request.text(), { headers: [['set-cookie', 'a=one; HttpOnly'], ['set-cookie', 'b=two; HttpOnly']] });
  } }); t.after(() => server.close());
  const response = await fetch(server.url, { method: 'POST', headers: { origin: server.url }, body: 'synthetic' });
  assert.equal(await response.text(), 'synthetic'); assert.equal(response.headers.getSetCookie().length, 2);
  const forged = await new Promise((resolve, reject) => { const req = httpRequest(server.url, { headers: { host: 'foreign.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(forged, 403);
  assert.equal((await fetch(server.url, { headers: { origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(server.url, { method: 'POST', body: 'x'.repeat(65537) })).status, 413);
  assert.equal(calls, 1);
});

test('local runtime configuration requires explicit credentials and an exact numeric loopback origin', () => {
  assert.throws(() => localConfiguration({}), error => error.code === 'LOCAL_CONFIGURATION');
  const env = { PUBLIC_ORIGIN: 'http://127.0.0.1:4318', GOOGLE_LOGIN_CLIENT_ID: 'synthetic-login-client', GOOGLE_LOGIN_CLIENT_SECRET: 'synthetic-login-secret', GOOGLE_CLIENT_ID: 'synthetic-youtube-client', GOOGLE_CLIENT_SECRET: 'synthetic-youtube-secret', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url') };
  assert.equal(localConfiguration(env).port, 4318);
  for (const origin of ['http://0.0.0.0:4318', 'http://localhost:4318', 'https://dashboard.example', 'http://127.0.0.1:4318/path']) assert.throws(() => localConfiguration({ ...env, PUBLIC_ORIGIN: origin }), error => error.code === 'LOCAL_CONFIGURATION');
});
