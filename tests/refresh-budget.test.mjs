import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store.mjs';
import { D1Store } from '../src/d1-store.mjs';
import { DashboardService } from '../src/service.mjs';
import { migratedD1 } from './d1-test-adapter.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';
const range = { startDate: '2026-10-20', endDate: '2026-10-20' };
for (const backend of ['sqlite', 'd1']) {
  test(backend + ': failed syncs retain channel cooldown across connections and restarts', async t => {
    const db = backend === 'd1' ? await migratedD1() : new SqliteStore(':memory:');
    const store = backend === 'd1' ? new D1Store(db) : db;
    t.after(() => db.close());
    const auth = await identities(), google = googleFixture(), config = configuration();
    let now = NOW, fail = false;
    const fetchImpl = (input, options) => {
      if (fail && new URL(input).origin === 'https://youtubeanalytics.googleapis.com') {
        google.control.calls++; return Response.json({ error: { code: 403, message: 'synthetic failure' } }, { status: 403 });
      }
      return google.fetch(input, options);
    };
    let service = new DashboardService({ store, config, fetchImpl, now: () => now });
    const a = await authorize(service, auth.a), b = await authorize(service, auth.a);
    fail = true;
    await assert.rejects(service.refresh(auth.a, a, range), { code: 'UPSTREAM_FORBIDDEN' });
    const calls = google.control.calls;
    service = new DashboardService({ store, config, fetchImpl, now: () => now });
    await assert.rejects(service.refresh(auth.a, a, range), { code: 'REFRESH_COOLDOWN', status: 429 });
    await assert.rejects(service.refresh(auth.a, b, range), { code: 'REFRESH_COOLDOWN', status: 429 });
    assert.equal(google.control.calls, calls);
    assert.equal((await service.getData(auth.a, a)).hasData, false);
    assert.equal((await service.getConnection(auth.a, b)).connected, true);
    now += 900001; fail = false;
    await service.refresh(auth.a, a, range);
    assert.equal((await service.getData(auth.a, a)).hasData, true);
  });
  test(backend + ': report key churn and failures share a persistent budget', async t => {
    const db = backend === 'd1' ? await migratedD1() : new SqliteStore(':memory:');
    const store = backend === 'd1' ? new D1Store(db) : db;
    t.after(() => db.close());
    const auth = await identities(), google = googleFixture(), config = configuration();
    let fail = false;
    const fetchImpl = (input, options) => {
      if (fail && new URL(input).origin === 'https://youtubeanalytics.googleapis.com') {
        google.control.calls++; return Response.json({ error: { code: 403, message: 'synthetic failure' } }, { status: 403 });
      }
      return google.fetch(input, options);
    };
    let service = new DashboardService({ store, config, fetchImpl, now: () => NOW });
    const id = await authorize(service, auth.a);
    await service.refresh(auth.a, id, range);
    const saved = (await service.getData(auth.a, id)).snapshot;
    fail = true;
    for (let day = 1; day <= 20; day++) {
      const date = '2026-10-' + String(day).padStart(2, '0');
      await assert.rejects(service.refreshReport(auth.a, id, { reportId: 'countries', startDate: date, endDate: date }), { code: 'UPSTREAM_FORBIDDEN' });
    }
    const calls = google.control.calls;
    service = new DashboardService({ store, config, fetchImpl, now: () => NOW });
    await assert.rejects(service.refreshReport(auth.a, id, { reportId: 'devices', ...range }), { code: 'PROVIDER_BUDGET_EXCEEDED', status: 429 });
    assert.equal(google.control.calls, calls);
    assert.deepEqual((await service.getData(auth.a, id)).snapshot, saved);
  });
}
test('failed-sync cooldown survives SQLite reopen and disconnect/reconnect', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-budget-restart-'));
  let store = new SqliteStore(join(directory, 'test.sqlite'));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const auth = await identities(), google = googleFixture(), config = configuration();
  let fail = false;
  const fetchImpl = (url, options) => fail && new URL(url).origin === 'https://youtubeanalytics.googleapis.com'
    ? new Response('', { status: 403 }) : google.fetch(url, options);
  let service = new DashboardService({ store, config, fetchImpl, now: () => NOW });
  const old = await authorize(service, auth.a);
  fail = true;
  await assert.rejects(service.refresh(auth.a, old, range));
  await service.disconnect(auth.a, old);
  store.close(); store = new SqliteStore(join(directory, 'test.sqlite'));
  service = new DashboardService({ store, config, fetchImpl, now: () => NOW });
  const replacement = await authorize(service, auth.a);
  await assert.rejects(service.refresh(auth.a, replacement, range), { code: 'REFRESH_COOLDOWN', status: 429 });
});
