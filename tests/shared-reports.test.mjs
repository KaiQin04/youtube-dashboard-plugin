import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { handleMcp } from '../src/mcp.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';

test('shared advanced reports stay connection-scoped and cache reads never query Google', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), base = googleFixture(); let advancedCalls = 0;
  const service = new DashboardService({ store, config: configuration(), now: () => NOW, fetchImpl: async (input, options) => {
    const url = new URL(input);
    if (url.searchParams.get('dimensions') === 'insightTrafficSourceDetail') { advancedCalls++; return Response.json({ columnHeaders: ['insightTrafficSourceDetail', 'views', 'engagedViews', 'estimatedMinutesWatched'].map(name => ({ name })), rows: [['abcdefghijk', 12, 10, 24]] }); }
    if (url.searchParams.get('fields') === 'items(id,snippet(title,thumbnails))') return Response.json({ items: [{ id: 'abcdefghijk', snippet: { title: 'Synthetic source', thumbnails: {} } }] });
    return base.fetch(input, options);
  } });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  await service.refresh(auth.a, a, { startDate: '2026-10-20', endDate: '2026-10-20' });
  const args = { connectionId: a, reportId: 'relatedVideos', startDate: '2026-10-20', endDate: '2026-10-20' };
  const call = (principal, name, input = args) => handleMcp(service, principal, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } });
  const report = await call(auth.a, 'refresh_analytics_report');
  assert.equal(report.result.isError, undefined);
  assert.equal(report.result.structuredContent.sourceVideos[0].title, 'Synthetic source');
  assert.equal(advancedCalls, 1);
  assert.equal((await call(auth.a, 'get_analytics_report')).result.structuredContent.sourceVideos[0].title, 'Synthetic source');
  assert.equal(advancedCalls, 1);
  assert.equal((await call(auth.b, 'get_analytics_report')).result.structuredContent.error.code, 'NOT_FOUND');
  assert.equal((await call(auth.b, 'get_analytics_report', { ...args, connectionId: b })).result.structuredContent.status, 'not_synced');
  assert.equal((await call(auth.a, 'refresh_analytics_report', { ...args, reportId: 'retention', videoId: 'unknown1234' })).result.isError, true);
  assert.equal(advancedCalls, 1);
  const dashboard = await service.getDashboard(auth.a, a);
  assert.equal(dashboard.reportCache.relatedVideos.sourceVideos[0].title, 'Synthetic source');
  assert.ok(base.control.tokens.every(token => !JSON.stringify(dashboard).includes(token)));
});

test('advanced report authorization failure preserves saved data and requests reconnection', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture(); let revoked = false;
  const service = new DashboardService({ store, config: configuration(), now: () => NOW, fetchImpl: (url, options) => revoked ? new Response('', { status: 401 }) : google.fetch(url, options) });
  const id = await authorize(service, auth.a);
  await service.refresh(auth.a, id, { startDate: '2026-10-20', endDate: '2026-10-20' });
  const before = await service.getData(auth.a, id);
  revoked = true;
  await assert.rejects(service.refreshReport(auth.a, id, { reportId: 'countries', startDate: '2026-10-20', endDate: '2026-10-20' }), { code: 'REAUTH_REQUIRED' });
  assert.equal((await service.getConnection(auth.a, id)).status, 'reauth_required');
  assert.deepEqual((await service.getData(auth.a, id)).snapshot, before.snapshot);
});

test('ordinary synchronization preserves scoped report caches and explicit date ranges', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture(); let now = NOW;
  const service = new DashboardService({ store, config: configuration(), now: () => now, fetchImpl: (input, options) => {
    const url = new URL(input);
    if (url.searchParams.get('dimensions') === 'country' && url.searchParams.get('metrics').includes('engagedViews')) return Response.json({ columnHeaders: ['country','views','engagedViews','estimatedMinutesWatched','averageViewDuration','averageViewPercentage'].map(name => ({ name })), rows: [['TW',10,8,30,180,50]] });
    return google.fetch(input, options);
  } });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  const range = { startDate: '2026-10-20', endDate: '2026-10-20' };
  await service.refresh(auth.a, a, range);
  const args = { reportId: 'countries', ...range };
  const saved = await service.refreshReport(auth.a, a, args);
  assert.equal(saved.status, 'available');
  now += 16 * 60000;
  await service.refresh(auth.a, a, range);
  assert.deepEqual(await service.getReport(auth.a, a, args), saved);
  assert.deepEqual((await service.getDashboard(auth.a, a)).reportCache.countries, saved);
  now += 16 * 60000;
  await service.refresh(auth.a, a, { startDate: '2026-10-19', endDate: '2026-10-20' });
  assert.deepEqual(await service.getReport(auth.a, a, args), saved);
  assert.equal((await service.getDashboard(auth.a, a)).reportCache.countries, undefined);
  assert.equal((await service.getReport(auth.b, b, args)).status, 'not_synced');
});
