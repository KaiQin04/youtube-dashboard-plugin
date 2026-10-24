/** Keep native period metrics separate from sums of rounded daily reports. */
export function applyNativeSummary(summary, totals, checkedAt = new Date().toISOString()) {
  const dailyAggregate = {
    views: summary.views, watchMinutes: summary.watchMinutes,
    subscribersNet: summary.subscribersNet,
    derivedAverageViewDurationSeconds: summary.averageViewDurationSeconds,
  };
  const base = {...summary, dailyAggregate, derivedAverageViewDurationSeconds:summary.averageViewDurationSeconds,
    averageViewDurationSeconds:null, averageDurationDefinition:{kind:'unavailable',nativeMetric:false},
    contentScope:'channel_all_content'};
  if(!totals)return base;
  return {...base, views:totals.views, watchMinutes:totals.estimatedMinutesWatched,
    totalWatchSeconds:totals.estimatedMinutesWatched===null?null:totals.estimatedMinutesWatched*60,
    subscribersGained:totals.subscribersGained,subscribersLost:totals.subscribersLost,
    subscribersNet:totals.subscribersGained===null||totals.subscribersLost===null?null:totals.subscribersGained-totals.subscribersLost,
    averageViewDurationSeconds:totals.engagedViews>0?totals.averageViewDuration:null,
    engagedViews:totals.engagedViews,nativeCheckedAt:checkedAt,
    averageDurationDefinition:{kind:'native',nativeMetric:true,metric:'averageViewDuration',note:'YouTube native period metric; not watch seconds divided by views. All channel content types.'},
    totalDefinition:'YouTube native period totals; daily rounded minutes may not sum exactly to this total.'};
}
