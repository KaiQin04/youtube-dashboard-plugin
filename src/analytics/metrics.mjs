import {
  ANALYTICS_TIMEZONE, METRIC_FIELDS, METRIC_UNITS, ContractError,
  addDays, analyticsDate, assertDate, assertId, boundedText, dateSequence,
} from './contracts.mjs';

const EMPTY_METRICS = Object.freeze({
  views: null, totalWatchSeconds: null, watchMinutes: null, averageViewDurationSeconds: null,
  likes: null, comments: null, subscribersGained: null, subscribersLost: null, subscribersNet: null,
});

/** Pure aggregation: unknown or missing observations must never silently turn into zero. */
export function aggregateRows(rows, { expectedRows = rows.length } = {}) {
  if (!Array.isArray(rows) || !Number.isSafeInteger(expectedRows) || expectedRows < 0) throw new ContractError('Invalid aggregation inputs.');
  for (const row of rows) {
    if (!row || typeof row !== 'object') throw new ContractError('Metric rows must be objects.');
    for (const field of METRIC_FIELDS) {
      const value = row[field];
      if (value !== null && value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (field !== 'totalWatchSeconds' && !Number.isSafeInteger(value)))) throw new ContractError(`Invalid ${field} in metric row.`);
    }
  }
  const coverageComplete = expectedRows > 0 && rows.length === expectedRows;
  const values = { ...EMPTY_METRICS };
  const unknownMetrics = [];
  for (const field of METRIC_FIELDS) {
    if (coverageComplete && rows.every(row => typeof row[field] === 'number' && Number.isFinite(row[field]))) {
      const total = rows.reduce((sum, row) => sum + row[field], 0);
      values[field] = Number.isFinite(total) && (field === 'totalWatchSeconds' || Number.isSafeInteger(total)) ? total : null;
    }
    if (values[field] === null) unknownMetrics.push(field);
  }
  values.watchMinutes = values.totalWatchSeconds === null ? null : values.totalWatchSeconds / 60;
  values.averageViewDurationSeconds = values.totalWatchSeconds !== null && values.views !== null && values.views > 0
    ? values.totalWatchSeconds / values.views : null;
  values.subscribersNet = values.subscribersGained !== null && values.subscribersLost !== null
    ? values.subscribersGained - values.subscribersLost : null;
  return {
    ...values,
    quality: {
      expectedRows, observedRows: rows.length, missingRows: Math.max(0, expectedRows - rows.length),
      coverageComplete, unknownMetrics,
      durationUnavailableReason: values.averageViewDurationSeconds === null
        ? (values.views === 0 ? 'zero_views' : 'missing_or_incomplete_data') : null,
    },
  };
}

export function releaseAgeWindow(publishedAt, ageDays) {
  if (!Number.isSafeInteger(ageDays) || ageDays < 1 || ageDays > 365) throw new ContractError('ageDays must be an integer between 1 and 365.');
  const releaseDate = analyticsDate(publishedAt);
  const startDate = addDays(releaseDate, 1);
  return { releaseDate, startDate, endDate: addDays(startDate, ageDays - 1), ageDays, timezone: ANALYTICS_TIMEZONE };
}

function rangeFor(snapshot, options, now) {
  const endDate = options.endDate ?? snapshot.completeThrough ?? addDays(analyticsDate(now), -1);
  const startDate = options.startDate ?? addDays(endDate, -27);
  assertDate(startDate, 'startDate'); assertDate(endDate, 'endDate');
  if (startDate > endDate) throw new ContractError('startDate must not be after endDate.');
  dateSequence(startDate, endDate);
  const effectiveEndDate = snapshot.completeThrough ? (endDate < snapshot.completeThrough ? endDate : snapshot.completeThrough) : null;
  return {
    startDate, endDate,
    effectiveStartDate: effectiveEndDate && effectiveEndDate >= startDate ? startDate : null,
    effectiveEndDate: effectiveEndDate && effectiveEndDate >= startDate ? effectiveEndDate : null,
    timezone: ANALYTICS_TIMEZONE,
    clippedToCompleteDays: !effectiveEndDate || effectiveEndDate < endDate,
  };
}

function metadata(snapshot, dateBounds = null, subscriberScope = 'channel') {
  return {
    mode: snapshot.mode, timezone: ANALYTICS_TIMEZONE,
    source: snapshot.mode === 'demo' ? 'synthetic_demo' : 'youtube_analytics_snapshot',
    dateBounds, completeThrough: snapshot.completeThrough, units: METRIC_UNITS,
    subscriberScope,
    averageDurationDefinition: {
      kind: 'derived', numerator: 'totalWatchSeconds', denominator: 'views',
      nativeMetric: false,
      note: 'Derived watch seconds / views. This is not a promise of equality to the native YouTube averageViewDuration metric, especially for Shorts and loops.',
    },
    topicSemantics: 'overlapping_non_additive',
  };
}

function selectVideos(snapshot, options) {
  let selected = snapshot.videos;
  if (options.videoIds !== undefined) {
    if (!Array.isArray(options.videoIds) || options.videoIds.length > 500) throw new ContractError('videoIds must be an array of at most 500 IDs.');
    options.videoIds.forEach(id => assertId(id, 'videoId'));
    const ids = new Set(options.videoIds);
    if ([...ids].some(id => !snapshot.videos.some(video => video.id === id))) throw new ContractError('Unknown video ID.');
    selected = selected.filter(video => ids.has(video.id));
  }
  if (options.topicId !== undefined && options.topicId !== null && options.topicId !== '') {
    assertId(options.topicId, 'topicId');
    if (!snapshot.topics.some(topic => topic.id === options.topicId)) throw new ContractError('Unknown topic ID.');
    const ids = new Set(snapshot.videoTopics.filter(link => link.topicId === options.topicId).map(link => link.videoId));
    selected = selected.filter(video => ids.has(video.id));
  }
  return selected;
}

function topicsFor(snapshot, videoId) {
  const ids = new Set(snapshot.videoTopics.filter(link => link.videoId === videoId).map(link => link.topicId));
  return snapshot.topics.filter(topic => ids.has(topic.id));
}

function videoRangeRows(snapshot, videos, bounds) {
  if (!bounds.effectiveStartDate) return { rows: [], expectedRows: 0 };
  const ids = new Set(videos.map(video => video.id));
  const rows = snapshot.dailyMetrics.filter(row => ids.has(row.videoId) && row.date >= bounds.effectiveStartDate && row.date <= bounds.effectiveEndDate);
  let expectedRows = 0;
  for (const video of videos) {
    const releaseDate = analyticsDate(video.publishedAt);
    const firstDay = bounds.effectiveStartDate > releaseDate ? bounds.effectiveStartDate : releaseDate;
    expectedRows += dateSequence(firstDay, bounds.effectiveEndDate).length;
    // Earlier observed days are valid; never invent zeros for unobserved days.
    expectedRows += rows.filter(row => row.videoId === video.id && row.date < releaseDate).length;
  }
  return {
    rows,
    expectedRows,
  };
}

function channelRangeRows(snapshot, bounds) {
  if (!bounds.effectiveStartDate) return { rows: [], expectedRows: 0 };
  return {
    rows: snapshot.channelDailyMetrics.filter(row => row.date >= bounds.effectiveStartDate && row.date <= bounds.effectiveEndDate),
    expectedRows: dateSequence(bounds.effectiveStartDate, bounds.effectiveEndDate).length,
  };
}

/** One source of metric truth, used identically by HTTP UI and MCP readers. */
export class MetricService {
  #repository;
  #now;
  constructor(repository, { now = () => new Date() } = {}) {
    if (!repository || typeof repository.snapshot !== 'function') throw new ContractError('MetricService requires a repository with snapshot().');
    this.#repository = repository;
    this.#now = typeof now === 'function' ? now : () => new Date(now);
  }

  get repository() { return this.#repository; }

  status() {
    const snapshot = this.#repository.snapshot();
    const blockers = [];
    if (snapshot.mode === 'demo') blockers.push('DEMO_DATA_ONLY');
    else {
      if (!snapshot.channel) blockers.push('CHANNEL_UNBOUND');
      if (!snapshot.completeThrough) blockers.push('NO_COMPLETE_DAY_WATERMARK');
      if (!snapshot.dailyMetrics.length && !snapshot.channelDailyMetrics.length) blockers.push('NO_ANALYTICS_DATA');
    }
    return {
      mode: snapshot.mode, connected: false, completeThrough: snapshot.completeThrough,
      timezone: ANALYTICS_TIMEZONE, lastSyncedAt: snapshot.lastSyncedAt, blockers,
      channel: snapshot.channel, source: snapshot.mode === 'demo' ? 'synthetic_demo' : 'youtube_analytics_snapshot',
      topics: snapshot.topics, topicSemantics: 'overlapping_non_additive',
      hasData: Boolean(snapshot.completeThrough && (snapshot.dailyMetrics.length || snapshot.channelDailyMetrics.length)),
    };
  }

  summary(options = {}) {
    const snapshot = this.#repository.snapshot();
    const bounds = rangeFor(snapshot, options, this.#now());
    const subset = options.videoIds !== undefined || Boolean(options.topicId);
    const selected = selectVideos(snapshot, options);
    const { rows, expectedRows } = subset ? videoRangeRows(snapshot, selected, bounds) : channelRangeRows(snapshot, bounds);
    return {
      ...aggregateRows(rows, { expectedRows }),
      ...metadata(snapshot, bounds, subset ? 'video_watch_page_attributed' : 'channel'),
      videoCount: selected.length, scope: subset ? 'video_subset' : 'channel',
    };
  }

  videoMetrics(options = {}) {
    const snapshot = this.#repository.snapshot();
    const bounds = rangeFor(snapshot, options, this.#now());
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new ContractError('limit must be an integer between 1 and 500.');
    const selected = selectVideos(snapshot, options);
    const videos = selected.map(video => {
      const { rows, expectedRows } = videoRangeRows(snapshot, [video], bounds);
      return { ...video, topics: topicsFor(snapshot, video.id), ...aggregateRows(rows, { expectedRows }) };
    }).sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id));
    return {
      videos: videos.slice(0, limit), totalVideos: videos.length, truncated: videos.length > limit,
      ...metadata(snapshot, bounds, 'video_watch_page_attributed'),
    };
  }

  dailySeries(options = {}) {
    const snapshot = this.#repository.snapshot();
    const bounds = rangeFor(snapshot, options, this.#now());
    const selected = selectVideos(snapshot, options);
    const subset = options.videoIds !== undefined || Boolean(options.topicId);
    const daily = dateSequence(bounds.startDate, bounds.endDate).map(date => {
      // Keep unknown/pending dates visible as null gaps instead of silently drawing zero.
      const withinWatermark = Boolean(snapshot.completeThrough && date <= snapshot.completeThrough);
      const dayBounds = { effectiveStartDate: withinWatermark ? date : null, effectiveEndDate: withinWatermark ? date : null };
      const { rows, expectedRows } = subset ? videoRangeRows(snapshot, selected, dayBounds) : channelRangeRows(snapshot, dayBounds);
      return { date, ...aggregateRows(rows, { expectedRows }), complete: withinWatermark && expectedRows > 0 && rows.length === expectedRows };
    });
    return { daily, ...metadata(snapshot, bounds, subset ? 'video_watch_page_attributed' : 'channel') };
  }

  compareCohorts({ cohorts, ageDays = 28 } = {}) {
    if (!Array.isArray(cohorts) || cohorts.length < 1 || cohorts.length > 20) throw new ContractError('cohorts must contain between 1 and 20 groups.');
    releaseAgeWindow('2000-01-01T00:00:00Z', ageDays);
    const snapshot = this.#repository.snapshot();
    const videoMap = new Map(snapshot.videos.map(video => [video.id, video]));
    const rowMap = new Map(snapshot.dailyMetrics.map(row => [`${row.videoId}:${row.date}`, row]));
    const labels = new Set();
    const membership = new Map();
    const groups = cohorts.map(cohort => {
      boundedText(cohort?.label, 'cohort.label', 100);
      if (labels.has(cohort.label)) throw new ContractError('Cohort labels must be unique.');
      labels.add(cohort.label);
      if (!Array.isArray(cohort.videoIds) || cohort.videoIds.length > 500) throw new ContractError('Each cohort needs videoIds, with at most 500 IDs.');
      const ids = [...new Set(cohort.videoIds)];
      ids.forEach(id => { assertId(id, 'videoId'); if (!videoMap.has(id)) throw new ContractError('Cohort references an unknown video.'); });
      if (cohort.topicId !== undefined) {
        assertId(cohort.topicId, 'topicId');
        if (!snapshot.topics.some(topic => topic.id === cohort.topicId)) throw new ContractError('Cohort references an unknown topic.');
      }
      const excludedVideos = [], includedVideos = [], rows = [];
      for (const id of ids) {
        const window = releaseAgeWindow(videoMap.get(id).publishedAt, ageDays);
        if (!snapshot.completeThrough || window.endDate > snapshot.completeThrough) {
          excludedVideos.push({ videoId: id, reason: snapshot.completeThrough ? 'age_window_not_complete' : 'no_complete_day_watermark', ...window });
          continue;
        }
        const days = dateSequence(window.startDate, window.endDate);
        const videoRows = days.map(date => rowMap.get(`${id}:${date}`));
        const missingDates = days.filter((_, index) => !videoRows[index]);
        if (missingDates.length) {
          excludedVideos.push({ videoId: id, reason: 'missing_daily_coverage', missingDates, ...window });
          continue;
        }
        includedVideos.push({ videoId: id, ...window }); rows.push(...videoRows);
        membership.set(id, (membership.get(id) ?? 0) + 1);
      }
      return {
        ...(cohort.topicId !== undefined ? { topicId: cohort.topicId } : {}),
        label: cohort.label, requestedVideoCount: ids.length, videoCount: includedVideos.length,
        ...aggregateRows(rows, { expectedRows: includedVideos.length * ageDays }),
        includedVideos, excludedVideos,
      };
    });
    return {
      releaseAgeDays: ageDays, groups,
      ...metadata(snapshot, null, 'video_watch_page_attributed'),
      alignment: 'first_full_analytics_day_after_publication',
      excludesReleasePartialDay: true, overlappingVideoIds: [...membership].filter(([, count]) => count > 1).map(([id]) => id),
      comparisonWarning: 'Cohort totals are descriptive, not causal. Overlapping groups are non-additive; unequal cohort sizes affect totals.',
    };
  }
}
