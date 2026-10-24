import { reportById } from './report-catalog.mjs';

/** Adapt existing tenant snapshots into the same display contract as an owner-bound site. */
export function widgetData(data) {
  const f = data.freshness ?? {}, reports = { ...(data.reportCache ?? {}) };
  for (const [id, report] of Object.entries(data.reports ?? {})) {
    if (reports[id]) continue;
    const definition = reportById(id); if (!definition) continue;
    reports[id] = { ...report, reportId: id, rows: (report.rows ?? []).map(row => id === 'engagement'
      ? { day: row.date, ...row }
      : { [definition.dimensions[0]]: row.label, ...row, estimatedMinutesWatched: row.watchMinutes }) };
  }
  return {
    ...data,
    status: { mode: data.hasData ? 'real' : 'awaiting_sync', hasData: data.hasData, connected: data.connection?.connected === true, channel: data.channel, boundChannelId: data.channel?.id, completeThrough: f.availableThrough ?? null, lastSyncedAt: f.observedAt ?? null },
    summary: { ...data.summary, ...data.metrics, watchMinutes: data.summary?.watchMinutes ?? null, averageViewDurationSeconds: data.metrics?.averageViewDuration ?? null },
    range: { start: f.requestedStartDate, end: f.availableThrough, requestedStart: f.requestedStartDate, requestedEnd: f.requestedEndDate },
    reports,
    videos: (data.widgetVideos ?? data.videos ?? []).map(video => ({ ...video, watchMinutes: video.watchMinutes ?? (Number.isFinite(video.watchHours) ? video.watchHours * 60 : null) })),
  };
}
