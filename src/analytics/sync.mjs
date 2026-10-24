import {AppError} from '../errors.mjs';
import {normalizeSnapshot} from './contracts.mjs';
import {normalizeCoverage} from './storage.mjs';
import {boundedSyncRange} from './youtube.mjs';
export function mergeSnapshots(prior,incoming,args){
 boundedSyncRange(args);const next=normalizeSnapshot(incoming);const coverage=normalizeCoverage(incoming.coverage);
 if(!prior)return {...next,...(coverage?{coverage}:{})};
 const old=normalizeSnapshot(prior);if(old.mode!=='real'||next.mode!=='real'||old.channel?.id!==next.channel?.id)throw new AppError('CHANNEL_MISMATCH','Cannot merge unrelated snapshots.',403);
 const outside=row=>row.date<args.startDate||row.date>args.endDate;
 const union=(a,b,key)=>[...new Map([...a,...b].map(x=>[key(x),x])).values()];
 const channelDailyMetrics=[...old.channelDailyMetrics.filter(outside),...next.channelDailyMetrics].sort((a,b)=>a.date.localeCompare(b.date));
 const merged={...next,videos:union(old.videos,next.videos,v=>v.id),topics:union(old.topics,next.topics,t=>t.id),videoTopics:union(old.videoTopics,next.videoTopics,t=>t.videoId+':'+t.topicId),dailyMetrics:[...old.dailyMetrics.filter(outside),...next.dailyMetrics],channelDailyMetrics,syncRuns:[...old.syncRuns,...next.syncRuns].slice(-100),completeThrough:channelDailyMetrics.at(-1)?.date??next.completeThrough};
 return {...normalizeSnapshot(merged),...(coverage?{coverage}:{})};
}
