import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { handleMcp } from '../src/mcp.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';

test('layout persists per user and connection across restart, even for the same channel', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'dashboard-layout-'));
  let store = new SqliteStore(join(folder, 'test.sqlite'));
  t.after(async () => { store.close(); await rm(folder, { recursive: true, force: true }); });
  const auth = await identities(), google = googleFixture(), config = configuration();
  const serviceFor = () => new DashboardService({ store, config, fetchImpl: google.fetch, now: () => NOW });
  let service = serviceFor();
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  const second = await authorize(service, auth.a);
  const defaults = (await service.getDashboard(auth.a, a)).layout;
  assert.equal(defaults.theme, 'cold-porcelain');
  const custom = { ...defaults, dashboardTitle: 'My Studio', name: 'Weekly review', mode: 'dark', density: 'compact', columns: 'one', widgets: [
    {id:'subscribers',kind:'metric',metric:'subscribersNet',width:'full',title:'Audience growth'},
    {id:'views',kind:'metric',metric:'views',width:'half'},
  ] };
  assert.deepEqual((await service.updateLayout(auth.a, a, custom)), custom);
  assert.deepEqual((await service.getDashboard(auth.b, b)).layout, defaults);
  assert.deepEqual((await service.getDashboard(auth.a, second)).layout, defaults);
  await assert.rejects(async () => (await service.updateLayout(auth.b, a, custom)), { code: 'NOT_FOUND' });
  store.close(); store = new SqliteStore(join(folder, 'test.sqlite')); service = serviceFor();
  assert.deepEqual((await service.getDashboard(auth.a, a)).layout, custom);
  await service.disconnect(auth.a, a);
  await assert.rejects(async () => (await service.getDashboard(auth.a, a)), { code: 'NOT_FOUND' });
  const replacement = await authorize(service, auth.a);
  assert.deepEqual((await service.getDashboard(auth.a, replacement)).layout, defaults);
});

test('layout tool rejects malformed preferences and read-only callers without changing saved layout', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  const defaults = (await service.getDashboard(auth.a, id)).layout;
  const call = (principal, layout, extra = {}) => handleMcp(service, principal, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_dashboard_layout', arguments: { connectionId: id, layout, ...extra } } });
  const custom = { ...defaults, mode: 'dark', widgets: [{id:'views',kind:'metric',metric:'views',width:'half'}] };
  assert.deepEqual((await call(auth.a, custom)).result.structuredContent, custom);
  const reader = await auth.principal('user-a', 'dashboard:read');
  assert.equal((await call(reader, defaults)).result.isError, true);
  for (const invalid of [null, {}, { ...custom, theme: 'neon' }, { ...custom, version: 3 },
    { ...custom, widgets: [] }, { ...custom, widgets: [custom.widgets[0], custom.widgets[0]] },
    { ...custom, widgets: [{...custom.widgets[0], metric:'<script>'}] }, { ...custom, mode: 'neon' },
    { ...custom, css: 'url(https://example.com)' }]) {
    await assert.rejects(async () => (await service.updateLayout(auth.a, id, invalid)), { code: 'INVALID_LAYOUT' });
    assert.equal((await call(auth.a, invalid)).result.isError, true);
    assert.deepEqual((await service.getDashboard(auth.a, id)).layout, custom);
  }
  assert.equal((await call(auth.a, defaults, { userId: auth.b.id })).result.isError, true);
  assert.equal((await call(auth.b, defaults)).result.structuredContent.error.code, 'NOT_FOUND');
  assert.equal(google.control.calls, 2);
});
