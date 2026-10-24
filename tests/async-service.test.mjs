import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { defaultLayout } from '../src/layout.mjs';
import { identities, configuration, googleFixture, authorize, NOW, ORIGIN } from './helpers.mjs';

test('service awaits an asynchronous store through authorization, data, layout and removal', async t => {
  const sqlite = new SqliteStore(':memory:');
  t.after(() => sqlite.close());
  const store = new Proxy(sqlite, {
    get(target, property) {
      return async (...args) => target[property](...args);
    },
  });
  const auth = await identities();
  const google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  assert.equal((await service.listConnections(auth.a)).length, 1);
  assert.equal((await service.getConnection(auth.a, id)).connected, true);
  await assert.rejects(service.getData(auth.b, id), { code: 'NOT_FOUND' });
  const layout = { ...defaultLayout(), dashboardTitle: 'Synthetic dashboard' };
  assert.deepEqual(await service.updateLayout(auth.a, id, layout), layout);
  assert.deepEqual((await service.getDashboard(auth.a, id)).layout, layout);
  await service.refresh(auth.a, id, { startDate: '2026-10-20', endDate: '2026-10-20' });
  assert.equal((await service.getData(auth.a, id)).hasData, true);
  const exported = await service.exportData(auth.a, id, { table: 'channel_daily', format: 'json', startDate: '2026-10-20', endDate: '2026-10-20' });
  assert.ok(JSON.stringify(exported).includes('2026-10-20'));
  await service.disconnect(auth.a, id);
  assert.deepEqual(await service.listConnections(auth.a), []);
});

test('principal-bound callbacks preserve a pending SQLite authorization for its owner', async t => {
  const store = new SqliteStore(':memory:');
  t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const start = await service.beginGoogle(auth.a);
  const state = new URL(start.authorizationUrl).searchParams.get('state');
  const callback = { callbackUrl: `${ORIGIN}/oauth/google/callback?state=${state}&code=synthetic-code`, browserNonce: start.browserNonce };
  await assert.rejects(service.completeGoogle({ ...callback, principal: auth.b }), { code: 'INVALID_STATE' });
  assert.equal(google.control.calls, 0);
  const complete = await service.completeGoogle({ ...callback, principal: auth.a });
  assert.equal(complete.connectionId, start.connectionId);
});

test('a delayed snapshot read cannot bypass the synchronization cooldown', async t => {
  const sqlite = new SqliteStore(':memory:');
  t.after(() => sqlite.close());
  let pause = false, notify, resume;
  const paused = new Promise(resolve => { notify = resolve; });
  const resumed = new Promise(resolve => { resume = resolve; });
  const store = new Proxy(sqlite, {
    get(target, property) {
      return async (...args) => {
        const result = target[property](...args);
        if (property === 'snapshot' && pause) {
          pause = false;
          notify();
          await resumed;
        }
        return result;
      };
    },
  });
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  const range = { startDate: '2026-10-20', endDate: '2026-10-20' };
  const settle = promise => promise.then(() => ({ success: true }), error => ({ success: false, code: error.code }));
  pause = true;
  const first = settle(service.refresh(auth.a, id, range));
  await paused;
  const second = await settle(service.refresh(auth.a, id, range));
  resume();
  const results = [await first, second];
  assert.equal(results.filter(result => result.success).length, 1);
  assert.ok(['OPERATION_BUSY', 'REFRESH_COOLDOWN'].includes(results.find(result => !result.success).code));
});
