import {AppError} from './security.mjs';
import {ReportStore} from './report-store.mjs';
import {validateReportRequest} from '../analytics/reports.mjs';
import {REPORTS,reportKey} from '../dashboard/report-catalog.mjs';

const unavailable=(args,code='REPORT_UNAVAILABLE')=>({...args,videoId:args.videoId??null,status:'unavailable',code,rows:[],availableThrough:null});
/** Cache reads never instantiate OAuth or call Google. */
export async function cachedReport({db,ownerId,channelId,args}) {
 const request={...args,channelId};validateReportRequest(request);
 return await new ReportStore(db).read(ownerId,request)??{...request,status:'not_synced',rows:[],availableThrough:null};
}
export async function cachedReports({db,ownerId,channelId,startDate,endDate,layout}) {
 if(!startDate||!endDate)return {};
 const requests=REPORTS.filter(report=>!report.video).map(report=>({reportId:report.id,startDate,endDate}));
 for(const widget of layout?.widgets??[])if(widget.kind==='report'&&widget.videoId)requests.push({reportId:widget.report,videoId:widget.videoId,startDate,endDate});
 const output={};
 for(const args of requests){try{output[reportKey(args)]=await cachedReport({db,ownerId,channelId,args});}catch(error){if(error.code==='INVALID_RANGE')return {};throw error;}}
 return output;
}
function hardFailure(error){return ['REAUTH_REQUIRED','CHANNEL_MISMATCH','OAUTH_NOT_CONNECTED','UPSTREAM_UNAUTHORIZED','SYNC_BUDGET_EXCEEDED','SYNC_LOCK_EXPIRED','SYNC_LOCK_REQUIRED'].includes(error.code);}
/** One explicit update; validates channel/video ownership before querying analytics. */
export async function refreshReport({db,ownerId,channelId,args,store,adapter}) {
 const request={...args,channelId};const definition=validateReportRequest(request);
 if(definition.video){const snapshot=await store.readSnapshot(ownerId,channelId);if(!snapshot?.videos?.some(video=>video.id===args.videoId))throw new AppError('VIDEO_NOT_SYNCED','Select a video from this authorized channel.',403);}
 const reports=new ReportStore(db),prior=await reports.read(ownerId,request);
 if(prior?.observedAt&&Date.now()-Date.parse(prior.observedAt)<60000)return {...prior,refreshSkipped:'recently_updated'};
 const lock=await store.acquireLock(ownerId,channelId,600000);
 try{
  await adapter.verifyOwnedChannel();if(definition.video)await adapter.verifyReportVideo(args.videoId);
  const result=await adapter.readDashboardReport(args);return await reports.save(ownerId,request,result,lock);
 }catch(error){
  if(hardFailure(error))throw error;
  const failed=unavailable(request,error.code);await reports.save(ownerId,request,failed,lock);
  return prior?{...prior,refreshError:failed.code}:failed;
 }finally{await store.releaseLock(ownerId,channelId,lock);}
}
/** Already inside the data-sync lock; supplemental failures preserve core and prior good reports. */
export async function refreshChannelReports({db,ownerId,channelId,startDate,endDate,adapter,lockId}) {
 const reports=new ReportStore(db),statuses={};
 for(const definition of REPORTS.filter(report=>!report.video)){
  const args={channelId,reportId:definition.id,startDate,endDate};
  try{const result=await adapter.readDashboardReport({reportId:definition.id,startDate,endDate});await reports.save(ownerId,args,result,lockId);statuses[definition.id]=result.status;}
  catch(error){if(hardFailure(error))throw error;await reports.save(ownerId,args,unavailable(args,error.code),lockId);statuses[definition.id]='unavailable';}
 }
 return statuses;
}
