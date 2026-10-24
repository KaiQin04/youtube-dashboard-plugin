import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { D1Store } from '../src/d1-store.mjs';
import { DashboardService } from '../src/service.mjs';
import { migratedD1 } from './d1-test-adapter.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';
import { setImmediate } from 'node:timers/promises';

for (const backend of ['sqlite', 'd1']) {
  async function setup(t) {
    const db = backend === 'd1' ? await migratedD1() : new SqliteStore(':memory:');
    t.after(() => db.close());
    return backend === 'd1' ? new D1Store(db) : db;
  }
  test(backend + ': report limits aggregate by tenant, channel and service independently', async t => {
    const store = await setup(t);
    const spend = (userId, channelId) => Promise.resolve().then(() => store.reserveProviderWork({ userId, channelId, kind: 'report', now: NOW }));
    for (let n = 0; n < 20; n++) await spend('one', 'shared');
    await assert.rejects(spend('one', 'new-channel'), { code: 'PROVIDER_BUDGET_EXCEEDED' });
    await assert.rejects(spend('other-user', 'shared'), { code: 'PROVIDER_BUDGET_EXCEEDED' });
    for (let group = 1; group < 10; group++) for (let n = 0; n < 20; n++) await spend('user-' + group, 'channel-' + group);
    await assert.rejects(spend('new-user', 'new-channel'), { code: 'PROVIDER_BUDGET_EXCEEDED', status: 429, retryAfterSeconds: 60 });
    await store.reserveProviderWork({ userId: 'new-user', channelId: 'new-channel', kind: 'report', now: NOW + 60000 });
  });
  test(backend + ': provider concurrency is atomic across callers and expired slots recover', async t => {
    const store = await setup(t);
    const args = { userId: 'one', channelId: 'channel', kind: 'request', now: NOW };
    const attempts = await Promise.allSettled(Array.from({ length: 24 }, () => Promise.resolve().then(() => store.reserveProviderWork(args))));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 12);
    assert.ok(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'PROVIDER_BUDGET_EXCEEDED'));
    await store.releaseProviderWork(attempts.find(result => result.status === 'fulfilled').value);
    await store.reserveProviderWork(args);
    const recovered = await store.reserveProviderWork({ ...args, now: NOW + 30000 });
    assert.equal(typeof recovered, 'string');
  });
  test(backend + ': service-wide request exhaustion prevents upstream work for a fresh tenant', async t => {
    const store = await setup(t), auth = await identities(), google = googleFixture();
    const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
    const id = await authorize(service, auth.a);
    // Authorization already consumed two of the six thousand service requests.
    for (let n = 0; n < 5998; n++) {
      const permit = await store.reserveProviderWork({ userId: 'filler-' + n % 10, channelId: 'channel-' + n % 10, kind: 'request', now: NOW });
      await store.releaseProviderWork(permit);
    }
    const calls = google.control.calls;
    await assert.rejects(service.refresh(auth.a, id, { startDate: '2026-10-20', endDate: '2026-10-20' }), { code: 'PROVIDER_BUDGET_EXCEEDED', status: 429 });
    assert.equal(google.control.calls, calls);
    assert.equal((await service.getConnection(auth.a, id)).connected, true);
  });
}

test('provider concurrency remains reserved until response bodies finish or are cancelled', async t => {
  const store = new SqliteStore(':memory:');
  t.after(() => store.close());
  const auth = await identities(), starts = [], controllers = [];
  let calls = 0;
  const service = new DashboardService({ store, config: configuration(), now: () => NOW, fetchImpl: async () => {
    calls++;
    return new Response(new ReadableStream({ start(controller) { controllers.push(controller); } }));
  } });
  for (let index = 0; index < 13; index++) {
    const principal = await auth.principal('body-user-' + index);
    const start = await service.beginGoogle(principal);
    const state = new URL(start.authorizationUrl).searchParams.get('state');
    starts.push({ browserNonce: start.browserNonce, callbackUrl: 'https://dashboard.example/oauth/google/callback?state=' + state + '&code=synthetic' });
  }
  const pending = starts.slice(0, 12).map(args => service.completeGoogle(args).catch(error => error.code));
  try {
    for (let turn = 0; turn < 30; turn++) await setImmediate();
    pending.push(service.completeGoogle(starts[12]).catch(error => error.code));
    for (let turn = 0; turn < 30; turn++) await setImmediate();
    assert.equal(calls, 12);
  } finally {
    for (const controller of controllers) controller.close();
    await Promise.all(pending);
  }
  const permit = await store.reserveProviderWork({ userId: 'after', kind: 'request', now: NOW });
  await store.releaseProviderWork(permit);
});
