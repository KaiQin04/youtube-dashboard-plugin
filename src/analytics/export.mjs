import {
  ANALYTICS_TIMEZONE, METRIC_FIELDS, METRIC_UNITS, ContractError,
  analyticsDate, assertDate, assertId, dateSequence, normalizeSnapshot,
} from './contracts.mjs';
import { aggregateRows } from './metrics.mjs';
import { normalizeCoverage } from './storage.mjs';

export const MAX_EXPORT_BYTES = 256 * 1024;
export const EXPORT_TABLES = Object.freeze(['channel_daily', 'video_daily', 'videos']);
export const EXPORT_COLUMNS = Object.freeze({
  channel_daily: Object.freeze(['channelId', 'date', ...METRIC_FIELDS]),
  video_daily: Object.freeze(['channelId', 'videoId', 'date', ...METRIC_FIELDS]),
  videos: Object.freeze(['id', 'channelId', 'title', 'publishedAt', 'durationSeconds']),
});
const OPTIONS = new Set(['table', 'format', 'startDate', 'endDate', 'videoIds']);
const PROVIDER = 'YouTube Analytics API v2 + YouTube Data API v3';
const WATERMARK_MEANING = 'Latest channel day returned for the requested metrics, subject to provider revision; missing dates remain unknown.';

function fail(message, code = 'INVALID_EXPORT') { throw new ContractError(message, code); }
function plainOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Export options must be an object.');
  if (Object.keys(value).some(key => !OPTIONS.has(key))) fail('Unsupported export option.');
}
function clockDate(now) {
  const date = new Date(typeof now === 'function' ? now() : now);
  if (!Number.isFinite(date.getTime())) fail('A valid export clock is required.');
  return date;
}
function selectVideos(snapshot, table, videoIds, startDate, effectiveEndDate) {
  if (table === 'channel_daily') {
    if (videoIds !== undefined) fail('channel_daily contains whole-channel observations and cannot accept a video filter.');
    return [];
  }
  let selected = snapshot.videos;
  if (videoIds !== undefined) {
    if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > 20) fail('videoIds must contain 1–20 unique video IDs.');
    videoIds.forEach(id => assertId(id, 'videoId'));
    const ids = new Set(videoIds);
    if (ids.size !== videoIds.length) fail('videoIds must be unique.');
    const available = new Set(snapshot.videos.map(video => video.id));
    if (videoIds.some(id => !available.has(id))) fail('Export references an unknown video.');
    return snapshot.videos.filter(video => ids.has(video.id)).sort((a, b) => a.id.localeCompare(b.id));
  }
  const views = new Map();
  for (const row of snapshot.dailyMetrics) {
    if (effectiveEndDate && row.date >= startDate && row.date <= effectiveEndDate && row.views !== null) {
      views.set(row.videoId, (views.get(row.videoId) ?? 0) + row.views);
    }
  }
  return [...selected].sort((a, b) => (views.get(b.id) ?? -1) - (views.get(a.id) ?? -1) || a.id.localeCompare(b.id)).slice(0, 20);
}
function dateCoverage(dates, kind, dateField) {
  const sorted = [...new Set(dates)].sort();
  return {
    kind, dateField, startDate: sorted[0] ?? null, endDate: sorted.at(-1) ?? null,
    distinctDateCount: sorted.length, dates: sorted,
  };
}
function pickColumns(row, columns) {
  // Never spread provider objects. Arbitrary fields and nested payloads cannot enter exports.
  return Object.fromEntries(columns.map(column => [column, row[column] ?? null]));
}
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  // Prefix text with an apostrophe before CSV quoting. Quoting alone does not stop
  // spreadsheet formulas. Treat leading whitespace/control/format chars conservatively.
  if (typeof value === 'string' && /^[=+\-@\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Pure, bounded export of an already-authorized snapshot. This function never
 * fetches, persists, publishes, or transmits data. The caller must authorize the
 * owner before calling it and deliver content privately with its metadata.
 *
 * For videos, the requested range describes associated daily analytics coverage;
 * it is NOT a publication-date filter. Video titles retain their original form in
 * JSON; spreadsheet-dangerous leading text is apostrophe-prefixed only in CSV.
 * CSV is one RFC 4180 table with recordType/exportMetadataJson columns. It has
 * one metadata record, then data records; filter recordType=data for observations.
 * This preserves provenance even when the CSV is detached from its response.
 */
export function createAnalyticsExport(input, options, { now = () => new Date(), maxBytes = MAX_EXPORT_BYTES, filenamePrefix = 'youtube-dashboard' } = {}) {
  plainOptions(options);
  const { table, format = 'json', startDate, endDate, videoIds } = options;
  if (!EXPORT_TABLES.includes(table)) fail('table must be channel_daily, video_daily, or videos.');
  if (!['csv', 'json'].includes(format)) fail('format must be csv or json.');
  assertDate(startDate, 'startDate'); assertDate(endDate, 'endDate');
  const requestedDays = (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000 + 1;
  if (requestedDays < 1 || requestedDays > 31) fail('Exports require 1–31 inclusive calendar days.', 'INVALID_EXPORT_RANGE');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_EXPORT_BYTES) fail('The export byte limit must be between 1 and 262144.');
  const generated = clockDate(now);
  const snapshot = normalizeSnapshot(input, { now: generated });
  if (!snapshot.channel) fail('Bind a channel before exporting analytics.', 'CHANNEL_UNBOUND');
  const sourceCoverage = normalizeCoverage(input.coverage) ?? null;
  const cappedEnd = snapshot.completeThrough && snapshot.completeThrough < endDate ? snapshot.completeThrough : endDate;
  const effectiveEndDate = snapshot.completeThrough && cappedEnd >= startDate ? cappedEnd : null;
  const effectiveStartDate = effectiveEndDate ? startDate : null;
  const selected = selectVideos(snapshot, table, videoIds, startDate, effectiveEndDate);
  const ids = new Set(selected.map(video => video.id));
  const inRange = row => effectiveEndDate !== null && row.date >= startDate && row.date <= effectiveEndDate;
  const channelScope = table === 'channel_daily';
  const observedRows = (channelScope ? snapshot.channelDailyMetrics : snapshot.dailyMetrics)
    .filter(row => inRange(row) && (channelScope || ids.has(row.videoId)))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.videoId ?? '').localeCompare(b.videoId ?? ''));
  const effectiveDays = effectiveEndDate ? dateSequence(startDate, effectiveEndDate) : [];
  const expectedRows = channelScope ? effectiveDays.length : selected.reduce((total, video) => {
    const firstDate = analyticsDate(video.publishedAt) > startDate ? analyticsDate(video.publishedAt) : startDate;
    return total + (effectiveEndDate && firstDate <= effectiveEndDate ? dateSequence(firstDate, effectiveEndDate).length : 0);
  }, 0);
  const quality = aggregateRows(observedRows, { expectedRows }).quality;
  const rows = (table === 'videos' ? selected : observedRows).map(row => pickColumns(row, EXPORT_COLUMNS[table]));
  const observedAt = snapshot.lastSyncedAt === null ? null : new Date(snapshot.lastSyncedAt).toISOString();
  const ageSeconds = observedAt === null ? null : Math.floor((generated.getTime() - Date.parse(observedAt)) / 1000);
  const metadata = {
    exportSchemaVersion: 1, snapshotSchemaVersion: snapshot.schemaVersion, table, format,
    generatedAt: generated.toISOString(), mode: snapshot.mode,
    channel: { id: snapshot.channel.id, title: snapshot.channel.title },
    source: snapshot.mode === 'demo' ? 'synthetic_demo' : 'youtube_analytics_snapshot',
    provider: snapshot.mode === 'demo' ? null : PROVIDER,
    timezone: ANALYTICS_TIMEZONE,
    observation: {
      observedAt, snapshotAgeSeconds: ageSeconds !== null && ageSeconds >= 0 ? ageSeconds : null,
      freshness: observedAt === null ? 'observation_time_unknown' : ageSeconds < 0 ? 'observation_time_ahead_of_export_clock' : 'saved_snapshot_age_only',
      liveFetchPerformed: false,
      meaning: 'Last snapshot synchronization time, not per-row observation time. Retained historical rows may have been observed earlier.',
    },
    watermark: { completeThrough: snapshot.completeThrough, meaning: snapshot.mode === 'demo' ? 'Synthetic demo availability watermark; not real provider data.' : WATERMARK_MEANING, finalOrAudited: false },
    requestedRange: { startDate, endDate, inclusiveDays: requestedDays, timezone: ANALYTICS_TIMEZONE },
    effectiveAnalyticsRange: {
      startDate: effectiveStartDate, endDate: effectiveEndDate,
      clippedToWatermark: effectiveEndDate !== endDate,
    },
    actualDateCoverage: table === 'videos'
      ? dateCoverage(selected.map(video => analyticsDate(video.publishedAt)), 'publication_dates_not_analytics_observations', 'publishedAt_in_Pacific_calendar_days')
      : dateCoverage(rows.map(row => row.date), 'exported_analytics_observation_dates', 'date'),
    units: Object.fromEntries(EXPORT_COLUMNS[table].filter(column => column in METRIC_UNITS || column === 'durationSeconds').map(column => [column, column === 'durationSeconds' ? 'seconds' : METRIC_UNITS[column]])),
    columns: [...EXPORT_COLUMNS[table]],
    rowCount: rows.length,
    videoSelection: channelScope ? null : {
      kind: videoIds === undefined ? 'top_observed_views_in_requested_window_from_saved_snapshot' : 'explicit_video_id_subset',
      videoIds: selected.map(video => video.id), count: selected.length, limit: 20,
      candidateVideoCount: snapshot.videos.length, omittedVideoCount: snapshot.videos.length - selected.length,
      selectionLimitApplied: videoIds === undefined && snapshot.videos.length > 20,
      ranking: videoIds === undefined ? 'Sum of non-null observed views in the effective analytics range; unknown totals rank after observed zero; ties use video ID. Incomplete coverage can affect ranking.' : null,
      allChannelVideosCovered: false,
    },
    coverage: {
      scope: channelScope ? 'channel_daily' : 'selected_video_daily',
      ...quality,
      actualAnalyticsDateCoverage: dateCoverage(observedRows.map(row => row.date), 'saved_analytics_observation_dates', 'date'),
      missingValuesByMetric: Object.fromEntries(METRIC_FIELDS.map(field => [field, observedRows.filter(row => row[field] === null).length])),
      // This describes only the latest import, not every historical row or this export.
      latestImportCoverage: sourceCoverage,
    },
    subscriberScope: channelScope ? 'channel' : 'video_watch_page_attributed',
    missingValues: {
      representation: format === 'json' ? 'null' : 'empty CSV field',
      meaning: 'Unknown or unavailable, never implicit zero. Missing observation rows are omitted, not filled with zero.',
    },
    csvSafety: format === 'csv' ? {
      formulaProtection: 'Apostrophe prefix on text starting with formula markers, whitespace, or control/format characters, before RFC 4180 quoting.',
      recordTypeColumn: 'recordType', metadataColumn: 'exportMetadataJson',
      metadataDelivery: 'The first CSV record has recordType=metadata and a JSON metadata cell; filter recordType=data to read observations.',
      columns: ['recordType', ...EXPORT_COLUMNS[table], 'exportMetadataJson'],
    } : null,
    limitations: [
      'Saved observations only. This export does not fetch current data or transmit data to another service.',
      'The watermark indicates observed availability, not finality or complete coverage. Provider data can be revised.',
      'Unknown metrics remain null or empty; omitted dates are unknown, not zero.',
      'Video data may be a bounded top-by-views subset collected in prior imports, not the full channel catalog.',
      'Default exports select at most 20 videos by available observed views in the effective range. Partial observations can affect this ranking; omission is explicit in videoSelection.',
      'Video-filtered subscriptions are attributed to video watch pages and need not sum to channel subscriptions.',
      'Shorts, long-form, and live formats are not classified or inferred from video duration.',
      'No credentials, private comment text, comment-author information, or unrecognized provider fields are included.',
      ...(table === 'videos' ? ['The requested date range describes associated analytics coverage, not a publication filter. Video metadata is not a period metric.'] : []),
      ...(snapshot.mode === 'demo' ? ['All observations are synthetic demo data, not actual channel performance.'] : []),
    ],
  };
  const content = format === 'json'
    ? JSON.stringify({ metadata, rows }, null, 2) + '\n'
    : [
      ['recordType', ...EXPORT_COLUMNS[table], 'exportMetadataJson'].map(csvCell).join(','),
      ['metadata', ...EXPORT_COLUMNS[table].map(() => null), JSON.stringify(metadata)].map(csvCell).join(','),
      ...rows.map(row => ['data', ...EXPORT_COLUMNS[table].map(column => row[column]), null].map(csvCell).join(',')),
    ].join('\r\n') + '\r\n';
  if (new TextEncoder().encode(content).byteLength > maxBytes) fail('Export exceeds the byte limit. Request fewer dates or video IDs; no truncated file was produced.', 'EXPORT_TOO_LARGE');
  return {
    content, filename: `${filenamePrefix}-${snapshot.mode}-${table}-${startDate}-to-${endDate}.${format}`,
    mime: format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
    metadata,
  };
}
