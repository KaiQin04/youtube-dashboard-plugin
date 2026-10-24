import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Store } from '../src/d1-store.mjs';
import { DashboardService } from '../src/service.mjs';
import { defaultLayout } from '../src/layout.mjs';
import { migratedD1 } from './d1-test-adapter.mjs';
import { identities, configuration, googleFixture, authorize, CHANNEL_A, NOW, ORIGIN } from './helpers.mjs';

async function setup(t) {
  const db = await migratedD1();
  t.after(() => db.close());
  return { db, store: new D1Store(db) };
}

function pending(userId, id, now = NOW) {
  return { userId, id, stateHash: `state-${userId}-${id}`, browserHash: 'browser', payload: 'synthetic-sealed-state', now };
}

async function connected(store, userId, id) {
  await store.begin(pending(userId, id));
  await store.complete(userId, id, [{ id: CHANNEL_A, title: 'Synthetic channel' }], 'synthetic-sealed-grant', NOW);
  await store.select(userId, id, CHANNEL_A, 'synthetic-bound-grant', 1);
}

test('D1 keeps same-channel tenant data separate and rejects foreign writes', async t => {
  const { store } = await setup(t);
  await connected(store, 'a', 'shared-id');
  await connected(store, 'b', 'shared-id');
  await connected(store, 'a', 'only-a');
  await store.saveLayout('a', 'shared-id', '{"name":"a"}');
  await store.saveLayout('b', 'shared-id', '{"name":"b"}');
  await store.acquire('a', 'shared-id', 'sync', 'lease-a', NOW, 1000);
  await store.saveSnapshot('a', 'shared-id', CHANNEL_A, '{"views":10}', 'lease-a', NOW);
  assert.equal(await store.snapshot('b', 'shared-id'), null);
  assert.equal(await store.layout('b', 'shared-id'), '{"name":"b"}');
  await assert.rejects(store.get('b', 'only-a'), { code: 'NOT_FOUND' });
  await assert.rejects(store.saveLayout('b', 'only-a', '{}'), { code: 'NOT_FOUND' });
  await assert.rejects(store.complete('b', 'only-a', [], 'wrong', NOW), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(store.select('b', 'only-a', CHANNEL_A, 'wrong', 2), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(store.acquire('b', 'only-a', 'sync', 'wrong', NOW, 1000), { code: 'OPERATION_BUSY' });
  await assert.rejects(store.saveSnapshot('b', 'only-a', CHANNEL_A, '{}', 'lease-a', NOW), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(store.replaceGrant('b', 'only-a', 2, 'wrong', 'lease-a', NOW), { code: 'CONNECTION_CHANGED' });
  await store.markReauth('b', 'only-a', 2);
  await store.release('b', 'shared-id', 'sync', 'lease-a');
  await assert.rejects(store.remove('b', 'only-a'), { code: 'NOT_FOUND' });
  assert.equal((await store.get('a', 'only-a')).status, 'connected');
  assert.equal(await store.snapshot('a', 'shared-id'), '{"views":10}');
  await assert.rejects(store.acquire('a', 'shared-id', 'sync', 'other', NOW, 1000), { code: 'OPERATION_BUSY' });
});

test('D1 consumes OAuth state once under concurrent callbacks and preserves mismatches', async t => {
  const { store } = await setup(t);
  const state = pending('a', 'one');
  await store.begin(state);
  assert.equal(await store.consumeState(state.stateHash, 'wrong-browser', NOW), null);
  assert.equal(await store.consumeStateForUser(state.stateHash, 'browser', NOW, 'b'), null);
  const attempts = await Promise.all(Array.from({ length: 12 }, () => store.consumeStateForUser(state.stateHash, 'browser', NOW, 'a')));
  assert.equal(attempts.filter(Boolean).length, 1);
  await store.begin(pending('a', 'expired'));
  assert.equal(await store.consumeState('state-a-expired', 'browser', NOW + 600000), null);
});

test('D1 atomically caps parallel authorizations per user and rolls back partial begins', async t => {
  const { store, db } = await setup(t);
  const attempts = await Promise.allSettled(Array.from({ length: 16 }, (_, i) => store.begin(pending('a', `id-${i}`))));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 5);
  assert.ok(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'CONNECTION_LIMIT'));
  assert.equal((await store.list('a')).length, 5);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM oauth_states WHERE user_id=?').bind('a').first()).n, 5);
  await assert.rejects(store.begin({ ...pending('a', 'id-0'), stateHash: 'must-not-insert' }), { code: 'CONNECTION_LIMIT' });
  assert.equal(await store.consumeState('must-not-insert', 'browser', NOW), null);
  await store.begin(pending('b', 'other'));
  await assert.rejects(store.begin({ ...pending('b', 'rollback'), stateHash: 'state-b-other' }));
  assert.equal((await store.list('b')).length, 1);
  await store.begin(pending('a', 'after-expiry', NOW + 600001));
  assert.equal((await store.list('a')).length, 1);
});

test('D1 lease expiry and grant versions prevent stale writes and wrong releases', async t => {
  const { store } = await setup(t);
  await connected(store, 'a', 'one');
  await store.acquire('a', 'one', 'grant', 'old', NOW, 1000);
  await assert.rejects(store.replaceGrant('a', 'one', 2, 'late', 'old', NOW + 1000), { code: 'CONNECTION_CHANGED' });
  await store.acquire('a', 'one', 'grant', 'new', NOW + 1000, 1000);
  await store.release('a', 'one', 'grant', 'old');
  await assert.rejects(store.replaceGrant('a', 'one', 2, 'wrong', 'old', NOW + 1001), { code: 'CONNECTION_CHANGED' });
  await store.replaceGrant('a', 'one', 2, 'new-grant', 'new', NOW + 1001);
  await assert.rejects(store.replaceGrant('a', 'one', 2, 'stale-version', 'new', NOW + 1001), { code: 'CONNECTION_CHANGED' });
  await store.markReauth('a', 'one', 2);
  assert.equal((await store.get('a', 'one')).status, 'connected');
  assert.equal((await store.get('a', 'one')).grant_cipher, 'new-grant');
});

test('D1 deletion cascades and cannot be undone by delayed snapshots or layouts', async t => {
  const { store, db } = await setup(t);
  await connected(store, 'a', 'one');
  await connected(store, 'b', 'one');
  await store.acquire('a', 'one', 'sync', 'lease', NOW, 1000);
  await store.saveSnapshot('a', 'one', CHANNEL_A, '{}', 'lease', NOW);
  await store.saveLayout('a', 'one', '{}');
  await store.remove('a', 'one');
  await assert.rejects(store.saveSnapshot('a', 'one', CHANNEL_A, '{}', 'lease', NOW), { code: 'CONNECTION_CHANGED' });
  await assert.rejects(store.saveLayout('a', 'one', '{}'), { code: 'NOT_FOUND' });
  for (const table of ['oauth_states', 'snapshots', 'layouts', 'leases']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind('a').first()).n, 0);
  }
  assert.equal((await store.get('b', 'one')).status, 'connected');
});

test('D1 rejects oversized UTF-8 snapshots and preserves the last saved data', async t => {
  const { store } = await setup(t);
  await connected(store, 'a', 'one');
  await store.acquire('a', 'one', 'sync', 'lease', NOW, 1000);
  const payload = 'x'.repeat(1_800_000);
  await store.saveSnapshot('a', 'one', CHANNEL_A, payload, 'lease', NOW);
  await assert.rejects(store.saveSnapshot('a', 'one', CHANNEL_A, '界'.repeat(600001), 'lease', NOW), { code: 'SNAPSHOT_LIMIT' });
  assert.equal(await store.snapshot('a', 'one'), payload);
  await assert.rejects(store.saveSnapshot('a', 'one', CHANNEL_A, '{}', 'lease', NOW + 1000), { code: 'CONNECTION_CHANGED' });
});

test('D1 service rejects a callback from another principal without consuming owner state', async t => {
  const { store } = await setup(t);
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const start = await service.beginGoogle(auth.a);
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const callback = { callbackUrl: `${ORIGIN}/oauth/google/callback?state=${state}&code=synthetic-code`, browserNonce: start.browserNonce };
  await assert.rejects(service.completeGoogle({ ...callback, principal: auth.b }), { code: 'INVALID_STATE' });
  assert.equal(google.control.calls, 0);
  await service.completeGoogle({ ...callback, principal: auth.a });
  await service.selectChannel(auth.a, start.connectionId, CHANNEL_A);
  assert.equal((await service.getConnection(auth.a, start.connectionId)).connected, true);
});

test('D1 service authorizes two tenants with one channel and persists isolated dashboards', async t => {
  const { store } = await setup(t);
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  await service.updateLayout(auth.a, a, { ...defaultLayout(), dashboardTitle: 'Only A' });
  await service.refresh(auth.a, a, { startDate: '2026-10-20', endDate: '2026-10-20' });
  assert.equal((await service.getDashboard(auth.a, a)).summary.views, 10);
  assert.equal((await service.getDashboard(auth.b, b)).hasData, false);
  assert.notEqual((await service.getDashboard(auth.b, b)).layout.dashboardTitle, 'Only A');
  await service.disconnect(auth.a, a);
  await assert.rejects(service.getDashboard(auth.a, a), { code: 'NOT_FOUND' });
  assert.equal((await service.getConnection(auth.b, b)).connected, true);
});
