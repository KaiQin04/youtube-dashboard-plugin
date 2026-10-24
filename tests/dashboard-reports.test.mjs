import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';

function supplementalFixture(base, override) {
  const requests = [];
  return { requests, fetch: async (input, options) => {
    const url = new URL(input), dimension = url.searchParams.get('dimensions');
    const supplemental = url.searchParams.get('metrics') === 'likes,comments,shares' || ['country', 'deviceType', 'insightTrafficSourceType', 'subscribedStatus'].includes(dimension);
    if (!supplemental) return base.fetch(input, options);
    requests.push(url);
    const forced = override?.(url); if (forced) return forced;
    const columns = dimension === 'day' ? ['day', 'likes', 'comments', 'shares'] : [dimension, 'views', 'estimatedMinutesWatched'];
    const rows = dimension === 'day' ? [['2026-10-20', 5, 2, 1]] : [[dimension === 'country' ? 'TW' : 'SYNTHETIC', 8, 16]];
    return Response.json({ columnHeaders: columns.map(name => ({ name })), rows });
  } };
}

test('sync exposes bounded interaction and audience reports for the authorized connection only', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture(), fixture = supplementalFixture(google);
  const service = new DashboardService({ store, config: configuration(), fetchImpl: fixture.fetch, now: () => NOW });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  await service.refresh(auth.a, a, { startDate: '2026-10-20', endDate: '2026-10-20' });
  const data = (await service.getDashboard(auth.a, a));
  assert.equal(data.metrics.likes, 5); assert.equal(data.metrics.comments, 2); assert.equal(data.metrics.shares, 1);
  assert.equal(data.daily[0].likes, 5); assert.equal(data.metrics.subscribersGained, 2);
  assert.equal(data.reports.countries.rows[0].label, 'TW');
  assert.equal(data.availability.likes, 'available');
  assert.equal(fixture.requests.length, 5);
  assert.ok(fixture.requests.every(url => url.origin === 'https://youtubeanalytics.googleapis.com' && Number(url.searchParams.get('maxResults')) <= 31));
  assert.equal((await service.getDashboard(auth.b, b)).availability.likes, 'not_synced');
  await assert.rejects(async () => (await service.getDashboard(auth.b, a)), { code: 'NOT_FOUND' });
  assert.ok(google.control.tokens.every(token => !JSON.stringify(data).includes(token)));
});

test('unavailable optional reports and partial days remain unknown rather than zero or complete', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const fixture = supplementalFixture(google, url => url.searchParams.get('dimensions') === 'country' ? new Response('sensitive-provider-diagnostic', { status: 403 }) : null);
  const service = new DashboardService({ store, config: configuration(), fetchImpl: fixture.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  await service.refresh(auth.a, id, { startDate: '2026-10-19', endDate: '2026-10-20' });
  const data = (await service.getDashboard(auth.a, id));
  assert.equal(data.hasData, true); assert.equal(data.metrics.likes, null);
  assert.equal(data.availability.likes, 'partial'); assert.equal(data.daily[0].likes, null);
  assert.equal(data.reports.countries.status, 'unavailable');
  assert.equal(JSON.stringify(data).includes('sensitive-provider-diagnostic'), false);
});

test('malformed optional rows are quarantined while top-category truncation stays explicit', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const fixture = supplementalFixture(google, url => {
    const dimension = url.searchParams.get('dimensions');
    const columns = [dimension, 'views', 'estimatedMinutesWatched'];
    if (dimension === 'country') return Response.json({ columnHeaders: columns.map(name => ({ name })), rows: Array.from({ length: 21 }, (_, index) => ['C' + index, 30 - index, 60 - index]) });
    if (dimension === 'deviceType') return Response.json({ columnHeaders: columns.map(name => ({ name })), rows: [['MOBILE', 2, 4], ['MOBILE', 3, 6]] });
    if (dimension === 'subscribedStatus') return Response.json({ columnHeaders: columns.map(name => ({ name })), rows: [['SUBSCRIBED', -1, 2]] });
    if (dimension === 'insightTrafficSourceType') return Response.json({ columnHeaders: columns.map(name => ({ name })), rows: Array.from({ length: 22 }, (_, index) => ['C' + index, 1, 2]) });
  });
  const service = new DashboardService({ store, config: configuration(), fetchImpl: fixture.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  await service.refresh(auth.a, id, { startDate: '2026-10-20', endDate: '2026-10-20' });
  const data = (await service.getDashboard(auth.a, id));
  assert.equal(data.reports.countries.rows.length, 20);
  assert.equal(data.reports.countries.truncated, true);
  assert.equal(data.reports.countries.availableThrough, null);
  for (const report of ['devices', 'subscriptionStatus', 'trafficSources']) {
    assert.equal(data.reports[report].status, 'unavailable');
    assert.deepEqual(data.reports[report].rows, []);
  }
  assert.equal(data.metrics.views, 10);
});

test('empty interaction reports remain unknown and reauthorization errors do not save a new snapshot', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture(); let rejectAuthorization = false;
  const fixture = supplementalFixture(google, url => {
    if (url.searchParams.get('dimensions') !== 'day') return;
    if (rejectAuthorization) return new Response('', { status: 401 });
    return Response.json({ columnHeaders: ['day', 'likes', 'comments', 'shares'].map(name => ({ name })), rows: [] });
  });
  const service = new DashboardService({ store, config: configuration(), fetchImpl: fixture.fetch, now: () => NOW });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  await service.refresh(auth.a, a, { startDate: '2026-10-20', endDate: '2026-10-20' });
  const data = (await service.getDashboard(auth.a, a));
  assert.equal(data.metrics.likes, null);
  assert.equal(data.availability.likes, 'empty');
  rejectAuthorization = true;
  await assert.rejects(service.refresh(auth.b, b, { startDate: '2026-10-20', endDate: '2026-10-20' }), { code: 'REAUTH_REQUIRED' });
  assert.equal((await service.getDashboard(auth.b, b)).hasData, false);
});
