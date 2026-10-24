import test from 'node:test';
import assert from 'node:assert/strict';

// Supports validating the deployment copy before the foundation mirror is updated.
const { createAnalyticsExport, EXPORT_TABLES, EXPORT_COLUMNS, MAX_EXPORT_BYTES } = await import(
  new URL('../src/analytics/export.mjs', import.meta.url)
);
const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const now = '2026-10-23T04:00:00.000Z';
const firstId = 'VID00000001', secondId = 'VID00000002';
const metrics = (date, extra = {}) => ({ channelId, date, views: 10, totalWatchSeconds: 600, likes: null, comments: null, subscribersGained: 2, subscribersLost: 1, ...extra });
function fixture() {
  return {
    mode: 'real', channel: { id: channelId, title: 'Synthetic channel', timeZone: 'America/Los_Angeles' },
    completeThrough: '2026-10-20', lastSyncedAt: '2026-10-21T10:00:00.000Z',
    videos: [
      { id: firstId, channelId, title: 'Older video', publishedAt: '2026-10-18T06:30:00Z', durationSeconds: 600 },
      { id: secondId, channelId, title: 'New video', publishedAt: '2026-10-19T08:00:00Z', durationSeconds: null },
    ],
    dailyMetrics: [
      metrics('2026-10-18', { videoId: firstId }), metrics('2026-10-19', { videoId: firstId }),
      metrics('2026-10-20', { videoId: firstId, views: 0, totalWatchSeconds: 0 }),
      metrics('2026-10-19', { videoId: secondId, views: null, totalWatchSeconds: null }),
      metrics('2026-10-21', { videoId: firstId, views: 999 }),
    ],
    channelDailyMetrics: [metrics('2026-10-17'), metrics('2026-10-19'), metrics('2026-10-20'), metrics('2026-10-21', { views: 999 })],
    topics: [], videoTopics: [], syncRuns: [],
  };
}
const options = (table = 'channel_daily', extra = {}) => ({ table, startDate: '2026-10-18', endDate: '2026-10-22', ...extra });
const run = (snapshot = fixture(), opts = options(), config = {}) => createAnalyticsExport(snapshot, opts, { now, ...config });
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  assert.equal(quoted, false, 'CSV quotes must be balanced');
  assert.equal(row.length, 0, 'CSV must end on a record boundary');
  const [headers, ...records] = rows;
  assert.ok(records.every(record => record.length === headers.length), 'Every record must have the same column count');
  return records.map(record => Object.fromEntries(headers.map((key, index) => [key, record[index]])));
}
function withCoverage(snapshot) {
  snapshot.coverage = {
    source: 'YouTube Analytics API v2 + YouTube Data API v3', requestedStartDate: '2026-10-18', requestedEndDate: '2026-10-22', availableThrough: '2026-10-20',
    watermarkMeaning: 'Latest channel day returned for the requested metrics, subject to provider revision; missing dates remain unknown.',
    channelDaysReturned: 2, channelDaysExpected: 3, videoSelection: 'top_by_views_in_requested_period', videoLimit: 20,
    videoIdsReturned: 2, videoMetadataAvailable: 2, videoMetadataMissing: 0, allVideosCovered: false,
    contentFormat: 'not_classified; Shorts, long-form and live are not inferred from duration',
    videoSubscriberAttribution: 'Video-filtered subscriptions are attributed to video watch pages and need not sum to channel subscriptions.',
  };
  return snapshot;
}

test('export API declares fixed frozen tables, columns, and hard byte limit', () => {
  assert.deepEqual(EXPORT_TABLES, ['channel_daily', 'video_daily', 'videos']);
  assert.equal(MAX_EXPORT_BYTES, 262144);
  assert.ok(Object.isFrozen(EXPORT_TABLES));
  assert.ok(Object.isFrozen(EXPORT_COLUMNS));
  for (const columns of Object.values(EXPORT_COLUMNS)) assert.ok(Object.isFrozen(columns));
});
test('JSON export preserves provenance, requested range, actual coverage and explicit nulls', () => {
  const result = run(withCoverage(fixture()));
  const data = JSON.parse(result.content);
  assert.deepEqual(data.metadata, result.metadata);
  assert.equal(result.mime, 'application/json; charset=utf-8');
  assert.equal(result.filename, 'youtube-dashboard-real-channel_daily-2026-10-18-to-2026-10-22.json');
  assert.equal(data.metadata.timezone, 'America/Los_Angeles');
  assert.equal(data.metadata.observation.observedAt, '2026-10-21T10:00:00.000Z');
  assert.equal(data.metadata.observation.snapshotAgeSeconds, 151200);
  assert.equal(data.metadata.observation.liveFetchPerformed, false);
  assert.equal(data.metadata.watermark.completeThrough, '2026-10-20');
  assert.equal(data.metadata.watermark.finalOrAudited, false);
  assert.deepEqual(data.metadata.requestedRange, { startDate: '2026-10-18', endDate: '2026-10-22', inclusiveDays: 5, timezone: 'America/Los_Angeles' });
  assert.deepEqual(data.metadata.effectiveAnalyticsRange, { startDate: '2026-10-18', endDate: '2026-10-20', clippedToWatermark: true });
  assert.deepEqual(data.metadata.actualDateCoverage.dates, ['2026-10-19', '2026-10-20']);
  assert.equal(data.metadata.coverage.expectedRows, 3);
  assert.equal(data.metadata.coverage.observedRows, 2);
  assert.equal(data.metadata.coverage.missingRows, 1);
  assert.equal(data.metadata.coverage.coverageComplete, false);
  assert.deepEqual(data.metadata.coverage.unknownMetrics, ['views', 'totalWatchSeconds', 'likes', 'comments', 'subscribersGained', 'subscribersLost']);
  assert.equal(data.metadata.coverage.latestImportCoverage.allVideosCovered, false);
  assert.equal(data.metadata.units.totalWatchSeconds, 'seconds');
  assert.ok(data.rows.every(row => row.likes === null && row.comments === null));
  assert.ok(!data.rows.some(row => row.views === 999));
});
test('date range accepts 1 and 31 days, rejects missing, malformed, reversed and 32+ day ranges', () => {
  for (const [startDate, endDate] of [['2026-10-20', '2026-10-20'], ['2026-09-20', '2026-10-20']]) assert.doesNotThrow(() => run(fixture(), options('channel_daily', { startDate, endDate })));
  for (const extra of [{ startDate: undefined }, { endDate: undefined }, { startDate: '2026-02-30' }, { startDate: '2026-10-22', endDate: '2026-10-21' }, { startDate: '2026-09-19', endDate: '2026-10-20' }, { startDate: '2026-10-01T00:00:00Z' }]) assert.throws(() => run(fixture(), options('channel_daily', extra)));
});
test('unsupported options, formats, tables, and ambiguous channel video filters are rejected', () => {
  assert.throws(() => createAnalyticsExport(fixture(), undefined, { now }));
  for (const opts of [null, [], options('private_comments'), options('channel_daily', { format: 'xml' }), options('channel_daily', { includeTokens: true }), options('channel_daily', { videoIds: [firstId] })]) assert.throws(() => run(fixture(), opts));
});
test('video export filters explicit IDs, preserves observed zero and computes release-day coverage in Pacific time', () => {
  const { rows, metadata } = JSON.parse(run(fixture(), options('video_daily', { videoIds: [firstId] })).content);
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.videoId === firstId));
  assert.equal(rows.at(-1).views, 0);
  assert.equal(metadata.coverage.expectedRows, 3);
  assert.equal(metadata.coverage.coverageComplete, true);
  assert.equal(metadata.subscriberScope, 'video_watch_page_attributed');
  const both = run(fixture(), options('video_daily')).metadata;
  assert.equal(both.coverage.expectedRows, 5);
  assert.equal(both.coverage.observedRows, 4);
  assert.equal(both.coverage.missingRows, 1);
});
test('video ID subset rejects unknown, duplicate, malformed, empty and oversized sets', () => {
  for (const videoIds of [[firstId, firstId], ['unknown'], ['=formula'], [], 'all', Array(21).fill(firstId)]) assert.throws(() => run(fixture(), options('video_daily', { videoIds })));
});
test('default video selection is bounded top20 of observed views with honest omitted counts', () => {
  const snapshot = fixture();
  snapshot.videos = []; snapshot.dailyMetrics = [];
  for (let i = 0; i < 25; i++) {
    const id = `video${String(i).padStart(6, '0')}`;
    snapshot.videos.push({ id, channelId, title: `Video ${i}`, publishedAt: '2026-10-17T12:00:00Z', durationSeconds: null });
    snapshot.dailyMetrics.push(metrics('2026-10-19', { videoId: id, views: i, totalWatchSeconds: i * 60 }));
  }
  const result = JSON.parse(run(snapshot, options('video_daily')).content);
  assert.equal(result.metadata.videoSelection.count, 20);
  assert.equal(result.metadata.videoSelection.candidateVideoCount, 25);
  assert.equal(result.metadata.videoSelection.omittedVideoCount, 5);
  assert.equal(result.metadata.videoSelection.selectionLimitApplied, true);
  assert.equal(result.metadata.videoSelection.allChannelVideosCovered, false);
  assert.equal(result.metadata.videoSelection.videoIds[0], 'video000024');
  assert.ok(result.rows.every(row => row.views >= 5));
  assert.equal(result.rows.length, 20);
  const selected = JSON.parse(run(snapshot, options('videos', { videoIds: ['video000000'] })).content);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].id, 'video000000');
});
test('known zero ranks ahead of unknown, and unavailable past-watermark rows do not affect ranking', () => {
  const snapshot = fixture();
  snapshot.dailyMetrics = [metrics('2026-10-19', { videoId: firstId, views: null }), metrics('2026-10-19', { videoId: secondId, views: 0, totalWatchSeconds: 0 }), metrics('2026-10-21', { videoId: firstId, views: 10000 })];
  assert.deepEqual(run(snapshot, options('videos')).metadata.videoSelection.videoIds, [secondId, firstId]);
});
test('video metadata retains older publications while explaining analytics-window semantics', () => {
  const { rows, metadata } = JSON.parse(run(fixture(), options('videos')).content);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].publishedAt, '2026-10-18T06:30:00.000Z');
  assert.equal(metadata.actualDateCoverage.startDate, '2026-10-17');
  assert.equal(metadata.actualDateCoverage.kind, 'publication_dates_not_analytics_observations');
  assert.equal(metadata.units.durationSeconds, 'seconds');
  assert.ok(metadata.limitations.some(note => note.includes('not a publication filter')));
});
test('explicit allowlists omit secrets, raw payloads and private comment/author fields at every level', () => {
  const snapshot = withCoverage(fixture());
  const marker = 'NEVER_EXPORT_SECRET_VALUE';
  snapshot.accessToken = marker;
  snapshot.grant = { refreshToken: marker };
  snapshot.channel.email = marker;
  snapshot.channel.ownerInfo = marker;
  snapshot.videos[0].privateComments = marker;
  snapshot.videos[0].authorInfo = marker;
  snapshot.dailyMetrics[0].rawProviderResponse = marker;
  snapshot.channelDailyMetrics[0].privateCommentText = marker;
  snapshot.coverage.privateAccessToken = marker;
  snapshot.syncRuns = [{ id: marker, status: marker, startedAt: marker, source: marker }];
  for (const table of EXPORT_TABLES) for (const format of ['json', 'csv']) {
    const result = run(snapshot, options(table, { format }));
    assert.ok(!result.content.includes(marker));
    assert.ok(!JSON.stringify(result.metadata).includes(marker));
    if (format === 'json') for (const row of JSON.parse(result.content).rows) assert.deepEqual(Object.keys(row), [...EXPORT_COLUMNS[table]]);
  }
});
test('CSV carries standalone JSON metadata, consistent records, nulls, Unicode, quotes and newlines', () => {
  const snapshot = fixture();
  snapshot.videos[0].title = '投資,"策略"\r\n下一行';
  const result = run(snapshot, options('videos', { format: 'csv' }));
  assert.equal(result.mime, 'text/csv; charset=utf-8');
  const records = parseCsv(result.content);
  assert.equal(records[0].recordType, 'metadata');
  assert.deepEqual(JSON.parse(records[0].exportMetadataJson), result.metadata);
  const rows = records.filter(row => row.recordType === 'data');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, snapshot.videos[0].title);
  assert.equal(rows[1].durationSeconds, '');
  assert.ok(rows.every(row => row.exportMetadataJson === ''));
  assert.equal(result.metadata.missingValues.representation, 'empty CSV field');
});
test('CSV apostrophe-protects formulas and leading whitespace/control characters, while JSON stays exact', () => {
  const malicious = ['=HYPERLINK("https://bad.invalid")', '+SUM(1,1)', '-1+1', '@SUM(1,2)', '\t=1+1', '\r=1+1', '\n=1+1', '   =1+1', '\u0000=1+1', '\uFEFF=1+1', '\u200b=1+1'];
  for (const title of malicious) {
    const snapshot = fixture(); snapshot.videos[0].title = title;
    const csv = run(snapshot, options('videos', { videoIds: [firstId], format: 'csv' }));
    assert.equal(parseCsv(csv.content).find(row => row.recordType === 'data').title, `'${title}`);
    assert.equal(JSON.parse(run(snapshot, options('videos', { videoIds: [firstId] })).content).rows[0].title, title);
  }
});
test('no watermark or no overlap yields no daily rows, null actual bounds and metadata-only CSV', () => {
  for (const completeThrough of [null, '2026-10-17']) {
    const snapshot = fixture(); snapshot.completeThrough = completeThrough;
    const result = run(snapshot);
    assert.deepEqual(JSON.parse(result.content).rows, []);
    assert.equal(result.metadata.actualDateCoverage.startDate, null);
    assert.equal(result.metadata.effectiveAnalyticsRange.endDate, null);
    assert.equal(result.metadata.coverage.coverageComplete, false);
    const records = parseCsv(run(snapshot, options('channel_daily', { format: 'csv' })).content);
    assert.equal(records.length, 1);
    assert.equal(records[0].recordType, 'metadata');
    assert.ok(JSON.parse(records[0].exportMetadataJson).limitations.length);
  }
});
test('UTF-8 byte cap rejects oversized results rather than truncating and cannot exceed hard maximum', () => {
  const snapshot = fixture(); snapshot.videos[0].title = '投'.repeat(500);
  for (const format of ['csv', 'json']) {
    const opts = options('videos', { format });
    const result = run(snapshot, opts);
    const bytes = new TextEncoder().encode(result.content).byteLength;
    assert.ok(bytes > result.content.length);
    assert.throws(() => run(snapshot, opts, { maxBytes: bytes - 1 }), error => error.code === 'EXPORT_TOO_LARGE');
    assert.equal(run(snapshot, opts, { maxBytes: bytes }).content, result.content);
  }
  for (const maxBytes of [0, -1, 1.5, Infinity, MAX_EXPORT_BYTES + 1]) assert.throws(() => run(snapshot, options(), { maxBytes }));
});
test('unknown or ahead-of-clock observation time is explicit, not false freshness', () => {
  const snapshot = fixture(); snapshot.lastSyncedAt = null;
  assert.equal(run(snapshot).metadata.observation.snapshotAgeSeconds, null);
  assert.equal(run(snapshot).metadata.observation.freshness, 'observation_time_unknown');
  snapshot.lastSyncedAt = '2026-10-24T04:00:00Z';
  assert.equal(run(snapshot).metadata.observation.snapshotAgeSeconds, null);
  assert.equal(run(snapshot).metadata.observation.freshness, 'observation_time_ahead_of_export_clock');
});
test('demo remains explicit, unbound/mixed-channel/invalid data and malformed coverage fail closed', () => {
  const snapshot = fixture(); snapshot.mode = 'demo';
  const result = run(snapshot);
  assert.equal(result.metadata.source, 'synthetic_demo');
  assert.equal(result.metadata.provider, null);
  assert.match(result.filename, /^youtube-dashboard-demo-/);
  assert.ok(result.metadata.limitations.some(note => note.includes('synthetic demo')));
  assert.throws(() => run({ mode: 'real' }));
  const mixed = fixture(); mixed.videos[0].channelId = 'UCbbbbbbbbbbbbbbbbbbbbbb'; assert.throws(() => run(mixed));
  const invalid = fixture(); invalid.channelDailyMetrics[0].views = -1; assert.throws(() => run(invalid));
  const invalidCoverage = withCoverage(fixture()); invalidCoverage.coverage.source = 'untrusted-provider'; assert.throws(() => run(invalidCoverage));
  assert.throws(() => run(fixture(), options(), { now: 'not-a-date' }));
});
test('export is deterministic, never mutates the snapshot and performs no network requests', () => {
  const snapshot = fixture(), original = structuredClone(snapshot), fetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Export must not perform network requests'); };
  try {
    for (const table of EXPORT_TABLES) for (const format of ['json', 'csv']) assert.deepEqual(run(snapshot, options(table, { format })), run(snapshot, options(table, { format })));
    assert.deepEqual(snapshot, original);
  } finally { globalThis.fetch = fetch; }
});
