import {analyticsDate,addDays,dateSequence} from './contracts.mjs';
export function freshness(snapshot,{startDate,endDate,now=new Date()}={}) {
 const today=analyticsDate(now),lastRequestedDay=endDate??addDays(today,-1);
 const rows=(snapshot?.channelDailyMetrics??[]).filter(r=>(!startDate||r.date>=startDate)&&r.date<=lastRequestedDay);
 const watermark=rows.map(r=>r.date).sort().at(-1)??null;
 const observedAt=snapshot?.lastSyncedAt??null;
 const requestedWindowPreviouslyFetched = !startDate || (snapshot?.coverage?.requestedStartDate<=startDate && snapshot?.coverage?.requestedEndDate>=lastRequestedDay);
 const elapsed=observedAt?Math.max(0,new Date(now)-new Date(observedAt)):null;
 return {source:'YouTube Analytics API v2 + YouTube Data API v3',observedAt,checkedAt:new Date(now).toISOString(),timezone:'America/Los_Angeles',requestedStartDate:startDate??null,requestedEndDate:lastRequestedDay,availableThrough:watermark,latestStoredDay:snapshot?.completeThrough??null,reportLagDays:watermark?Math.round((Date.parse(today)-Date.parse(watermark))/86400000):null,snapshotAgeSeconds:elapsed===null?null:Math.floor(elapsed/1000),refreshSuggested:elapsed===null||elapsed>=900000||!requestedWindowPreviouslyFetched,requestedWindowPreviouslyFetched,returnedDays:rows.length,missingDates:startDate?dateSequence(startDate,lastRequestedDay).filter(d=>!rows.some(r=>r.date===d)):[],watermarkMeaning:'Latest returned day, not finalized settlement. Missing dates and metrics remain unknown; source data may be revised.',realTime:false};
}
