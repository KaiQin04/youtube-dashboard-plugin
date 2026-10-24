import { layoutPresets } from './layout.mjs';
import { METRICS, dashboardCatalog, VIDEO_SORTS } from './dashboard-catalog.mjs';

const finite = value => Number.isFinite(value) ? value : null;
const hours = value => Number.isFinite(value) ? value / 60 : null;
/** Safe display projection shared by MCP and HTTP, including source/availability distinctions. */
export function dashboardData(data, reports = {}, allVideos = []) {
  const summary = data.summary ?? {}, metrics = {
    views: finite(summary.views), watchHours: hours(summary.watchMinutes), subscribersNet: finite(summary.subscribersNet),
    subscribersGained: finite(summary.subscribersGained), subscribersLost: finite(summary.subscribersLost),
    averageViewDuration: finite(summary.averageViewDurationSeconds), engagedViews: finite(summary.engagedViews),
    likes: null, comments: null, shares: null, videoCount: data.hasData ? allVideos.length : null,
  };
  const engagement = reports.engagement;
  for (const key of ['likes', 'comments', 'shares']) {
    if (engagement?.status === 'available' && engagement.rows.length && engagement.rows.every(row => Number.isFinite(row[key]))) {
      const total = engagement.rows.reduce((sum, row) => sum + row[key], 0); metrics[key] = Number.isSafeInteger(total) ? total : null;
    }
  }
  const availability = Object.fromEntries(METRICS.map(({ id }) => [id, !data.hasData ? 'not_synced' : metrics[id] !== null ? 'available' : ['likes', 'comments', 'shares'].includes(id) ? engagement?.status === 'available' ? 'unavailable' : engagement?.status ?? 'not_loaded' : 'unavailable']));
  const engagementDays = new Map((engagement?.rows ?? []).map(row => [row.date, row]));
  const daily = (data.daily ?? []).map(row => ({ ...row, watchHours: hours(row.watchMinutes), likes: finite(engagementDays.get(row.date)?.likes), comments: finite(engagementDays.get(row.date)?.comments), shares: finite(engagementDays.get(row.date)?.shares) }));
  const videos = allVideos.map(video => ({ id: video.id, title: video.title, publishedAt: video.publishedAt, durationSeconds: finite(video.durationSeconds), views: finite(video.views), watchHours: hours(video.watchMinutes), subscribersNet: finite(video.subscribersNet), subscribersGained: finite(video.subscribersGained), subscribersLost: finite(video.subscribersLost) }));
  const videoTables = Object.fromEntries(VIDEO_SORTS.map(sort => [sort, [...videos].sort((a, b) => {
    if (sort === 'publishedAt') return b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id);
    if (a[sort] === null || b[sort] === null) return a[sort] === b[sort] ? a.id.localeCompare(b.id) : a[sort] === null ? 1 : -1;
    return b[sort] - a[sort] || a.id.localeCompare(b.id);
  }).slice(0, 20)]));
  return { ...data, metrics, availability, daily, reports, videoTables, totalVideos: videos.length, catalog: dashboardCatalog(), presets: layoutPresets() };
}
