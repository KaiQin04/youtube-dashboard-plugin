import {AppError} from './security.mjs';
import {normalizeReport,validateReportRequest} from '../analytics/reports.mjs';
import {reportById} from '../dashboard/report-catalog.mjs';
import {normalizeSourceVideos} from '../dashboard/source-videos.mjs';

/** Report storage is partitioned by verified owner, channel, exact period and video. */
export class ReportStore {
 constructor(db,{now=()=>Date.now()}={}){this.db=db;this.now=now;}
 async read(ownerId,args){
  validateReportRequest(args);
  const row=await this.db.prepare('SELECT report_json FROM analytics_reports WHERE owner_id=? AND channel_id=? AND report_id=? AND video_id=? AND start_date=? AND end_date=?').bind(ownerId,args.channelId,args.reportId,args.videoId??'',args.startDate,args.endDate).first();
  return row?JSON.parse(row.report_json):null;
 }
 async save(ownerId,args,value,lockId){
  if(typeof lockId!=='string'||!lockId)throw new AppError('SYNC_LOCK_REQUIRED','A synchronization lock is required.',409);
  const definition=validateReportRequest(args);
  if(value.channelId!==args.channelId||value.reportId!==args.reportId||value.startDate!==args.startDate||value.endDate!==args.endDate||(value.videoId??null)!==(args.videoId??null))throw new AppError('REPORT_BINDING','Report does not match its owner scope.');
  let clean;
  if(value.status==='unavailable'){
   const previous=await this.read(ownerId,args);if(previous&&previous.status!=='unavailable')return previous;
   const allowed=['UPSTREAM_FORBIDDEN','UPSTREAM_RATE_LIMITED','UPSTREAM_UNAVAILABLE','UNSUPPORTED_REPORT','INVALID_REPORT_DATA','REPORT_UNAVAILABLE'];
   clean={...args,videoId:args.videoId??null,status:'unavailable',code:allowed.includes(value.code)?value.code:'REPORT_UNAVAILABLE',rows:[],observedAt:new Date(this.now()).toISOString(),availableThrough:null};
  }else{
   const fields=[...definition.dimensions,...definition.metrics];
   clean=normalizeReport({columnHeaders:fields.map(name=>({name})),rows:value.rows?.map(row=>fields.map(field=>row[field]))},args,{now:()=>new Date(value.observedAt)});
   clean.truncated=value.truncated===true;
   if(args.reportId==='relatedVideos'){
    clean.sourceVideos=normalizeSourceVideos(value.sourceVideos,clean.rows);
    clean.sourceMetadataStatus=['available','partial','unavailable'].includes(value.sourceMetadataStatus)?value.sourceMetadataStatus:'unavailable';
   }
  }
  const json=JSON.stringify(clean);if(new TextEncoder().encode(json).length>500000)throw new AppError('REPORT_TOO_LARGE','Report exceeds storage limit.',409);
  const now=this.now();
  const result=await this.db.prepare('INSERT INTO analytics_reports(owner_id,channel_id,report_id,video_id,start_date,end_date,report_json,updated_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM analytics_sync_locks WHERE owner_id=? AND channel_id=? AND lock_id=? AND expires_at>?) ON CONFLICT(owner_id,channel_id,report_id,video_id,start_date,end_date) DO UPDATE SET report_json=excluded.report_json,updated_at=excluded.updated_at').bind(ownerId,args.channelId,args.reportId,args.videoId??'',args.startDate,args.endDate,json,now,ownerId,args.channelId,lockId,now).run();
  if((result.meta?.changes??result.changes)!==1)throw new AppError('SYNC_LOCK_EXPIRED','Synchronization lock expired; existing data was preserved.',409);
  return clean;
 }
}
