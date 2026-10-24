/** Shared contracts for the dashboard, metric service, and read-only MCP tools. */
export const ANALYTICS_TIMEZONE = 'America/Los_Angeles';
export const SCHEMA_VERSION = 1;
export const METRIC_FIELDS = Object.freeze([
  'views', 'totalWatchSeconds', 'likes', 'comments', 'subscribersGained', 'subscribersLost',
]);
export const METRIC_UNITS = Object.freeze({
  views: 'views', totalWatchSeconds: 'seconds', watchMinutes: 'minutes',
  averageViewDurationSeconds: 'seconds/view', likes: 'likes', comments: 'comments',
  subscribersGained: 'subscribers', subscribersLost: 'subscribers', subscribersNet: 'subscribers',
});

export class ContractError extends Error {
  constructor(message, code = 'INVALID_ARGUMENT') { super(message); this.name = 'ContractError'; this.code = code; }
}

export function assertDate(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ContractError(`${name} must be YYYY-MM-DD.`);
  const date = new Date(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ContractError(`${name} is not a valid calendar date.`);
  return value;
}

export function addDays(date, days) {
  assertDate(date);
  if (!Number.isInteger(days)) throw new ContractError('days must be an integer.');
  const result = new Date(`${date}T12:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function analyticsDate(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) throw new ContractError('Timestamp is not valid.');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ANALYTICS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function dateSequence(startDate, endDate) {
  assertDate(startDate, 'startDate'); assertDate(endDate, 'endDate');
  if (endDate < startDate) return [];
  const count = Math.round((Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86_400_000) + 1;
  if (count > 3660) throw new ContractError('Date range cannot exceed 3660 days.');
  return Array.from({ length: count }, (_, i) => addDays(startDate, i));
}

export function assertId(value, name = 'id') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ContractError(`${name} must be a safe, nonempty identifier.`);
  return value;
}

export function assertChannelId(value, { demo = false } = {}) {
  if (demo) return assertId(value, 'channelId');
  if (typeof value !== 'string' || !/^UC[A-Za-z0-9_-]{22}$/.test(value)) throw new ContractError('channelId must be a canonical YouTube channel ID (UC followed by 22 characters).');
  return value;
}

export function boundedText(value, name, max = 500) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ContractError(`${name} must be nonempty text up to ${max} characters.`);
  return value;
}

function metricValue(value, name) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (name !== 'totalWatchSeconds' && !Number.isSafeInteger(value))) {
    throw new ContractError(`${name} must be a nonnegative ${name === 'totalWatchSeconds' ? 'finite number' : 'safe integer'} or null.`);
  }
  return value;
}

export function normalizeVideo(video, channelId) {
  if (!video || typeof video !== 'object') throw new ContractError('Video must be an object.');
  assertId(video.id, 'video.id');
  if (video.channelId !== channelId) throw new ContractError('Video belongs to a different or unbound channel.', 'CHANNEL_MISMATCH');
  if (typeof video.publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(video.publishedAt) || !Number.isFinite(Date.parse(video.publishedAt))) {
    throw new ContractError('publishedAt must be an ISO timestamp with an explicit timezone.');
  }
  assertDate(video.publishedAt.slice(0, 10), 'publishedAt date');
  return {
    id: video.id, channelId, title: boundedText(video.title, 'video.title'),
    publishedAt: new Date(video.publishedAt).toISOString(),
    durationSeconds: metricValue(video.durationSeconds, 'totalWatchSeconds'),
  };
}

export function normalizeDailyMetric(row, channelId, videos = null) {
  if (!row || typeof row !== 'object') throw new ContractError('Daily metric must be an object.');
  if (row.channelId !== channelId) throw new ContractError('Metric belongs to a different or unbound channel.', 'CHANNEL_MISMATCH');
  assertId(row.videoId, 'videoId'); assertDate(row.date);
  const video = videos?.get(row.videoId);
  if (videos && !video) throw new ContractError('Daily metric references an unknown video.');
  // publishedAt can be the later public-release time, not the upload time.
  // Preserve provider observations before publication, including explicit zeros.
  const result = { channelId, videoId: row.videoId, date: row.date };
  for (const field of METRIC_FIELDS) result[field] = metricValue(row[field], field);
  if (result.views === 0 && result.totalWatchSeconds !== null && result.totalWatchSeconds > 0) throw new ContractError('Positive watch time with zero views is inconsistent.');
  return result;
}

export function normalizeTopic(topic) {
  assertId(topic?.id, 'topic.id');
  const color = topic.color ?? '#6b7280';
  if (typeof color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(color)) throw new ContractError('topic.color must be a six-digit hex color.');
  return { id: topic.id, label: boundedText(topic.label, 'topic.label', 100), color };
}

export function normalizeChannelDailyMetric(row, channelId) {
  if (!row || typeof row !== 'object') throw new ContractError('Channel daily metric must be an object.');
  if (row.channelId !== channelId) throw new ContractError('Channel metric does not match the channel binding.', 'CHANNEL_MISMATCH');
  assertDate(row.date);
  const result = { channelId, date: row.date };
  for (const field of METRIC_FIELDS) result[field] = metricValue(row[field], field);
  if (result.views === 0 && result.totalWatchSeconds !== null && result.totalWatchSeconds > 0) throw new ContractError('Positive watch time with zero views is inconsistent.');
  return result;
}

/** Whitelist fields deliberately: credentials and arbitrary provider payloads are never retained. */
export function normalizeSnapshot(input = {}, { now = new Date() } = {}) {
  if (typeof now === 'function') now = now();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ContractError('Snapshot must be an object.');
  for (const field of ['videos', 'topics', 'videoTopics', 'dailyMetrics', 'channelDailyMetrics', 'syncRuns']) {
    if (input[field] !== undefined && !Array.isArray(input[field])) throw new ContractError(`${field} must be an array.`);
  }
  const mode = input.mode ?? 'real';
  if (!['real', 'demo'].includes(mode)) throw new ContractError('mode must be real or demo.');
  const channel = input.channel ? {
    id: assertChannelId(input.channel.id, { demo: mode === 'demo' }),
    title: boundedText(input.channel.title ?? input.channel.id, 'channel.title'),
    timeZone: ANALYTICS_TIMEZONE,
  } : null;
  if (input.channel?.timeZone && input.channel.timeZone !== ANALYTICS_TIMEZONE) throw new ContractError('Analytics timezone must be America/Los_Angeles.');
  const completeThrough = input.completeThrough ?? null;
  if (completeThrough !== null) {
    assertDate(completeThrough, 'completeThrough');
    if (completeThrough > addDays(analyticsDate(now), -1)) throw new ContractError('The complete-day watermark cannot include the current or a future analytics day.');
  }
  if (!channel && ((input.videos?.length ?? 0) || (input.dailyMetrics?.length ?? 0) || (input.channelDailyMetrics?.length ?? 0) || completeThrough)) throw new ContractError('Bind a channel before accepting metrics.', 'CHANNEL_UNBOUND');
  const videos = (input.videos ?? []).map(video => normalizeVideo(video, channel.id));
  const videoMap = new Map(videos.map(video => [video.id, video]));
  if (videoMap.size !== videos.length) throw new ContractError('Video IDs must be unique.');
  const topics = (input.topics ?? []).map(normalizeTopic);
  const topicMap = new Map(topics.map(topic => [topic.id, topic]));
  if (topicMap.size !== topics.length) throw new ContractError('Topic IDs must be unique.');
  const assignments = new Set();
  const videoTopics = (input.videoTopics ?? []).map(link => {
    if (!videoMap.has(link.videoId) || !topicMap.has(link.topicId)) throw new ContractError('Topic assignment references an unknown video or topic.');
    const key = `${link.videoId}:${link.topicId}`;
    if (assignments.has(key)) throw new ContractError('Topic assignments must be unique.');
    assignments.add(key); return { videoId: link.videoId, topicId: link.topicId };
  });
  const dailyMetrics = (input.dailyMetrics ?? []).map(row => normalizeDailyMetric(row, channel.id, videoMap));
  const metricKeys = new Set(dailyMetrics.map(row => `${row.videoId}:${row.date}`));
  if (metricKeys.size !== dailyMetrics.length) throw new ContractError('Each video/day metric must be unique.');
  const channelDailyMetrics = (input.channelDailyMetrics ?? []).map(row => normalizeChannelDailyMetric(row, channel.id));
  if (new Set(channelDailyMetrics.map(row => row.date)).size !== channelDailyMetrics.length) throw new ContractError('Each channel/day metric must be unique.');
  const lastSyncedAt = input.lastSyncedAt ?? null;
  if (lastSyncedAt !== null && (typeof lastSyncedAt !== 'string' || !Number.isFinite(Date.parse(lastSyncedAt)))) throw new ContractError('lastSyncedAt must be a timestamp or null.');
  return {
    schemaVersion: SCHEMA_VERSION, mode, channel, completeThrough, lastSyncedAt,
    connectionState: 'not_connected', videos, topics, videoTopics, dailyMetrics, channelDailyMetrics,
    syncRuns: (input.syncRuns ?? []).map(run => ({
      id: String(run.id), status: run.status, startedAt: run.startedAt, completedAt: run.completedAt ?? null,
      completeThrough: run.completeThrough ?? null, source: run.source ?? 'manual_import', rowCount: run.rowCount ?? 0,
    })),
  };
}
