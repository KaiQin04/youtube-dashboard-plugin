import { AppError } from './security.mjs';
import { assertDate, analyticsDate, dateSequence, normalizeSnapshot } from './contracts.mjs';
import {readReport} from './reports.mjs';
import {readJson} from '../http-json.mjs';
import {readDashboardReports} from './dashboard-reports.mjs';
import {normalizeSourceVideos,safeSourceThumbnail,validSourceVideoId} from '../dashboard/source-videos.mjs';
import { isProviderBudgetError } from '../provider-budget.mjs';

const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
export const DAILY_METRICS = 'views,estimatedMinutesWatched,subscribersGained,subscribersLost';
const SOURCE = 'YouTube Analytics API v2 + YouTube Data API v3';
const fail = (message = 'YouTube returned invalid data.') => new AppError('INVALID_UPSTREAM_DATA', message, 502);

export function boundedSyncRange({startDate,endDate} = {}) {
  assertDate(startDate); assertDate(endDate);
  const days=(Date.parse(endDate)-Date.parse(startDate))/86400000+1;
  if(days<1 || days>31) throw new AppError('INVALID_RANGE','Refresh requires 1–31 calendar days.');
  return {startDate,endDate};
}
function table(report, required, maxRows) {
  if(!report || !Array.isArray(report.columnHeaders)) throw fail();
  const columns=report.columnHeaders.map(c=>c?.name);
  if(columns.some(x=>typeof x!=='string') || new Set(columns).size!==columns.length || required.some(x=>!columns.includes(x))) throw fail('Missing or duplicate report columns.');
  const rows=report.rows??[];
  if(!Array.isArray(rows) || rows.length>maxRows || rows.some(r=>!Array.isArray(r)||r.length!==columns.length)) throw fail('Invalid or oversized report rows.');
  return rows.map(row=>Object.fromEntries(columns.map((c,i)=>[c,row[i]])));
}
function numeric(value, fractional=false) {
  if(value===null) return null;
  if(typeof value!=='number'||!Number.isFinite(value)||value<0||(!fractional&&!Number.isSafeInteger(value))) throw fail('Invalid metric value.');
  return value;
}
export function parseDailyReport(report,{channelId,videoId,startDate,endDate}) {
  boundedSyncRange({startDate,endDate});
  const seen=new Set();
  return table(report,['day',...DAILY_METRICS.split(',')],31).map(row=>{
    try {assertDate(row.day);} catch {throw fail('Invalid report day.');}
    if(row.day<startDate||row.day>endDate||seen.has(row.day)) throw fail('Out-of-range or duplicate report day.');
    seen.add(row.day);
    const minutes=numeric(row.estimatedMinutesWatched,true);
    return {channelId,...(videoId?{videoId}:{}),date:row.day,views:numeric(row.views),totalWatchSeconds:minutes===null?null:minutes*60,subscribersGained:numeric(row.subscribersGained),subscribersLost:numeric(row.subscribersLost),likes:null,comments:null};
  }).sort((a,b)=>a.date.localeCompare(b.date));
}
export function parseDuration(value) {
  if(value==null) return null;
  // Data API uses ISO 8601 elapsed durations. Calendar months/years are not seconds.
  const match=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value);
  if(!match || !match.slice(1).some(x=>x!==undefined)) throw fail('Invalid video duration.');
  const seconds=Number(match[1]??0)*86400+Number(match[2]??0)*3600+Number(match[3]??0)*60+Number(match[4]??0);
  if(!Number.isFinite(seconds)||seconds>31536000) throw fail('Invalid video duration.');
  return seconds;
}

/** Read-only fixed-origin adapter. No arbitrary upstream URLs, raw responses or token persistence. */
export class YouTubeSnapshotAdapter {
  constructor({channelId,tokenStore,fetchImpl=globalThis.fetch.bind(globalThis),now=()=>new Date(),maxVideos=20,allVideos=false,maxCatalogVideos=500,refreshOnUnauthorized=false,unauthorizedCode='REAUTH_REQUIRED'}) {
    if(!CHANNEL.test(channelId??'')) throw new AppError('UNBOUND_CHANNEL','A canonical fixed channel is required.');
    if(!tokenStore || typeof tokenStore.getAccessToken!=='function') throw new AppError('OAUTH_NOT_CONNECTED','Server-side token provider is required.',503);
    if(!Number.isInteger(maxVideos)||maxVideos<1||maxVideos>20) throw new AppError('INVALID_LIMIT','Video limit must be 1–20.');
    if(typeof allVideos!=='boolean'||!Number.isInteger(maxCatalogVideos)||maxCatalogVideos<1||maxCatalogVideos>500)throw new AppError('INVALID_LIMIT','Catalog limit must be 1–500.');
    Object.assign(this,{channelId,tokenStore,fetchImpl,now,maxVideos,allVideos,maxCatalogVideos,refreshOnUnauthorized,unauthorizedCode});
    this.requestCount=0;this.deadline=Date.now()+480000;
  }
  async #accessToken(forceRefresh=false) {
    try {
      if(forceRefresh||!this.tokenPromise)this.tokenPromise=this.tokenStore.getAccessToken(this.channelId,{forceRefresh});
      const token=await this.tokenPromise;
      if(typeof token!=='string'||!token||/[\r\n]/.test(token))throw new AppError('OAUTH_NOT_CONNECTED','No valid server-side Google connection.',503);
      return token;
    } catch(error) {
      if(error instanceof AppError)throw error;
      throw new AppError('OAUTH_UPSTREAM_UNAVAILABLE','Google authorization service is unavailable. Try again later.',502);
    }
  }
  async #get(path,params,analytics=false) {
    const stage=analytics==='reporting'?'report_types':analytics?(params.dimensions==='video'?'top_videos':params.filters?'video_daily':'channel_daily'):(path.endsWith('/channels')?'channel_identity':'video_metadata');
    const url=new URL(path,analytics==='reporting'?'https://youtubereporting.googleapis.com':analytics?'https://youtubeanalytics.googleapis.com':'https://www.googleapis.com');
    for(const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
    let token=await this.#accessToken();
    let response, refreshed=false;
    for(let attempt=0;attempt<3;attempt++) {
      if(++this.requestCount>900||Date.now()>this.deadline)throw new AppError('SYNC_BUDGET_EXCEEDED','Sync request or time limit reached; previous data was preserved.',409);
      try {response=await this.fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});} catch (error) {if(isProviderBudgetError(error))throw error;throw new AppError('UPSTREAM_UNAVAILABLE',`YouTube request failed (stage=${stage}, transport_error). No snapshot was saved.`,502);}
      if(this.refreshOnUnauthorized&&!response.redirected&&response.status===401&&!refreshed&&attempt<2){
        await response.body?.cancel();
        token=await this.#accessToken(true);refreshed=true;continue;
      }
      if(response.redirected || ![500,502,503,504].includes(response.status) || attempt===2) break;
      await response.body?.cancel();
      await new Promise(resolve=>setTimeout(resolve,250*2**attempt));
    }
    // Only fixed stage labels and numeric status leave the server. Never echo provider bodies or URLs.
    if(!response.ok || response.redirected) {
      await response.body?.cancel().catch(() => {});
      throw new AppError(analytics===true&&response.status===400?'UNSUPPORTED_REPORT':response.status===401?this.unauthorizedCode:response.status===403?'UPSTREAM_FORBIDDEN':response.status===429?'UPSTREAM_RATE_LIMITED':'UPSTREAM_UNAVAILABLE',`YouTube request failed (stage=${stage}, HTTP=${response.status}). No snapshot was saved.`,502);
    }
    // Keep parsed upstream size bounded, without echoing provider error bodies.
    try {
      return await readJson(response,2_000_000);
    } catch {throw fail();}
  }
  async verifyOwnedChannel({includeUploads=false}={}) {
    const data=await this.#get('/youtube/v3/channels',{part:includeUploads?'id,snippet,contentDetails':'id,snippet',mine:true,maxResults:50});
    if(!Array.isArray(data.items)||data.items.length>50) throw fail();
    const found=data.items.find(item=>item?.id===this.channelId);
    if(!found) throw new AppError('CHANNEL_MISMATCH','Authorized Google account did not return the fixed channel; Studio manager access is not assumed sufficient.',403);
    if(typeof found.snippet?.title!=='string'||!found.snippet.title.trim()||found.snippet.title.length>500) throw fail('Invalid channel title.');
    const uploadsPlaylistId=found.contentDetails?.relatedPlaylists?.uploads;
    if(includeUploads&&(typeof uploadsPlaylistId!=='string'||!/^UU[A-Za-z0-9_-]{22}$/.test(uploadsPlaylistId)))throw fail('Missing channel uploads playlist.');
    return {id:this.channelId,title:found.snippet.title,timeZone:'America/Los_Angeles',...(includeUploads?{uploadsPlaylistId}:{})};
  }
  async listUploads(playlistId) {
    const ids=[],seen=new Set(),tokens=new Set();let pageToken;
    do {
      const page=await this.#get('/youtube/v3/playlistItems',{part:'contentDetails',playlistId,maxResults:50,...(pageToken?{pageToken}:{})});
      if(!Array.isArray(page.items)||page.items.length>50)throw fail('Invalid upload catalog.');
      for(const item of page.items){const id=item?.contentDetails?.videoId;if(!VIDEO.test(id??''))throw fail('Invalid catalog video ID.');if(seen.has(id))throw fail('Upload catalog changed during pagination; retry the sync.');seen.add(id);ids.push(id);}
      if(ids.length>this.maxCatalogVideos)throw new AppError('CATALOG_TOO_LARGE','The complete upload catalog exceeds this sync capacity; no partial snapshot was saved.',409);
      pageToken=page.nextPageToken;
      if(pageToken!==undefined&&(typeof pageToken!=='string'||!pageToken||pageToken.length>2048||tokens.has(pageToken)))throw fail('Invalid upload pagination.');
      if(pageToken){tokens.add(pageToken);if(tokens.size>=20)throw fail('Upload pagination limit reached.');}
    } while(pageToken);
    return ids;
  }
  async readNativeSummary({startDate,endDate}) {
    assertDate(startDate);assertDate(endDate);
    if(dateSequence(startDate,endDate).length<1||dateSequence(startDate,endDate).length>366)throw new AppError('INVALID_RANGE','Summary requires 1–366 days.');
    const metrics=[...DAILY_METRICS.split(','),'averageViewDuration','engagedViews'];
    const report=await this.#get('/v2/reports',{ids:`channel==${this.channelId}`,startDate,endDate,metrics:metrics.join(',')},true);
    const rows=table(report,metrics,1);
    if(!rows.length)throw new AppError('NO_DATA_AVAILABLE','No native channel summary is available.',409);
    return Object.fromEntries(metrics.map(metric=>[metric,numeric(rows[0][metric],['estimatedMinutesWatched','averageViewDuration'].includes(metric))]));
  }
  async readDashboardReports(range) {
    boundedSyncRange(range);
    return readDashboardReports(params=>this.#get('/v2/reports',params,true),{...range,channelId:this.channelId});
  }
  async readDashboardReport(args) {
    const report=await readReport(params=>this.#get('/v2/reports',params,true),{...args,channelId:this.channelId},{now:this.now});
    if(args.reportId!=='relatedVideos')return report;
    const ids=[...new Set(report.rows.map(row=>row.insightTrafficSourceDetail).filter(validSourceVideoId))];
    report.sourceVideos=[];report.sourceMetadataStatus='available';
    if(!ids.length)return report;
    try{
      // Sources may be public videos from other channels; they are not owned uploads.
      const metadata=await this.#get('/youtube/v3/videos',{part:'snippet',id:ids.join(','),fields:'items(id,snippet(title,thumbnails))'});
      if(!Array.isArray(metadata.items)||metadata.items.length>ids.length)throw fail();
      const seen=new Set();
      const items=metadata.items.map(item=>{
        if(!ids.includes(item?.id)||seen.has(item.id))throw fail();seen.add(item.id);
        const thumbnails=item.snippet?.thumbnails??{};
        const thumbnailUrl=['medium','high','standard','default','maxres'].map(key=>safeSourceThumbnail(thumbnails[key]?.url,item.id)).find(Boolean)??null;
        return {id:item.id,title:item.snippet?.title,thumbnailUrl};
      });
      report.sourceVideos=normalizeSourceVideos(items,report.rows);
      report.sourceMetadataStatus=report.sourceVideos.length===ids.length?'available':'partial';
    }catch(error){
      if(isProviderBudgetError(error)||['UPSTREAM_UNAUTHORIZED','REAUTH_REQUIRED','OAUTH_NOT_CONNECTED','SYNC_BUDGET_EXCEEDED'].includes(error.code))throw error;
      report.sourceMetadataStatus='unavailable';
    }
    return report;
  }
  async readReportingAvailability() {
    const supported=new Set(['channel_reach_basic_a1','channel_reach_combined_a1']);
    const found=new Set(),seen=new Set();let pageToken;
    do {
      const result=await this.#get('/v1/reportTypes',{pageSize:100,...(pageToken?{pageToken}:{})},'reporting');
      if(!Array.isArray(result.reportTypes)||result.reportTypes.length>100)throw fail();
      for(const type of result.reportTypes)if(supported.has(type?.id))found.add(type.id);
      pageToken=result.nextPageToken;
      if(pageToken!==undefined&&(typeof pageToken!=='string'||!pageToken||pageToken.length>2048||seen.has(pageToken)||seen.size>=4))throw fail();
      if(pageToken)seen.add(pageToken);
    }while(pageToken);
    return {status:found.size?'available':'not_listed',reportTypes:[...found].sort(),dataImported:false,jobsCreated:false};
  }
  async verifyReportVideo(videoId) {
    if(!VIDEO.test(videoId??''))throw new AppError('INVALID_VIDEO','Invalid video.');
    const response=await this.#get('/youtube/v3/videos',{part:'snippet',id:videoId});
    if(!Array.isArray(response.items)||response.items.length!==1||response.items[0]?.id!==videoId||response.items[0]?.snippet?.channelId!==this.channelId)throw new AppError('CHANNEL_MISMATCH','Video does not belong to the authorized channel.',403);
  }
  async #report({startDate,endDate,videoId,top=false}) {
    return this.#get('/v2/reports',{ids:`channel==${this.channelId}`,startDate,endDate,dimensions:top?'video':'day',metrics:DAILY_METRICS,sort:top?'-views':'day',maxResults:top?this.maxVideos:31,...(videoId?{filters:`video==${videoId}`}:{})},true);
  }
  async fetchSnapshot({channelId=this.channelId,startDate,endDate}) {
    boundedSyncRange({startDate,endDate});
    if(channelId!==this.channelId) throw new AppError('CHANNEL_MISMATCH','Refresh cannot change the bound channel.',403);
    const started=new Date(this.now());
    if(!Number.isFinite(started.getTime())) throw new AppError('INVALID_CLOCK','A valid clock is required.');
    const channel=await this.verifyOwnedChannel({includeUploads:this.allVideos});
    const channelRows=parseDailyReport(await this.#report({startDate,endDate}),{channelId,startDate,endDate});
    if(!channelRows.length) throw new AppError('NO_DATA_AVAILABLE','No channel daily rows returned; the previous snapshot must be preserved.',409);
    const completeThrough=channelRows.at(-1).date;
    if(completeThrough>=analyticsDate(started)) throw fail('An unfinished analytics day cannot be marked available.');
    // Query all metrics together: endDate is capped by the provider's latest available metric.
    // This watermark means observed API availability, not immutable/final audited data.
    const topRows=this.allVideos?[]:table(await this.#report({startDate,endDate:completeThrough,top:true}),['video',...DAILY_METRICS.split(',')],this.maxVideos);
    const videoIds=this.allVideos?await this.listUploads(channel.uploadsPlaylistId):topRows.map(row=>row.video);
    if(videoIds.some(id=>!VIDEO.test(id??''))||new Set(videoIds).size!==videoIds.length) throw fail('Invalid or duplicate video ID.');
    for(const row of topRows) for(const key of DAILY_METRICS.split(',')) numeric(row[key],key==='estimatedMinutesWatched');
    let metadata=[];
    const seen=new Set();
    for(let offset=0;offset<videoIds.length;offset+=50) {
      const batch=videoIds.slice(offset,offset+50);
      const response=await this.#get('/youtube/v3/videos',{part:'snippet,contentDetails',id:batch.join(','),maxResults:50});
      if(!Array.isArray(response.items)||response.items.length>batch.length) throw fail('Invalid video metadata.');
      metadata.push(...response.items.map(item=>{
        if(!batch.includes(item?.id)||seen.has(item.id)) throw fail('Unexpected metadata ID.');
        seen.add(item.id);
        if(item.snippet?.channelId!==channelId) throw new AppError('CHANNEL_MISMATCH','Video metadata belongs to another channel.',403);
        return {id:item.id,channelId,title:item.snippet.title,publishedAt:item.snippet.publishedAt,durationSeconds:parseDuration(item.contentDetails?.duration)};
      }));
    }
    // Bound concurrency and wait for outstanding requests before releasing the sync lock.
    const dailyByVideo=new Array(metadata.length);let cursor=0,failure;
    await Promise.all(Array.from({length:Math.min(3,metadata.length)},async()=>{
      while(!failure&&cursor<metadata.length){const index=cursor++,video=metadata[index];
        try {dailyByVideo[index]=parseDailyReport(await this.#report({startDate,endDate:completeThrough,videoId:video.id}),{channelId,videoId:video.id,startDate,endDate:completeThrough});}
        catch(error){failure??=error;}
      }
    }));
    if(failure)throw failure;
    const dailyMetrics=dailyByVideo.flat();
    const snapshot=normalizeSnapshot({mode:'real',channel,videos:metadata,dailyMetrics,channelDailyMetrics:channelRows,topics:[],videoTopics:[],completeThrough,lastSyncedAt:started.toISOString(),syncRuns:[{id:crypto.randomUUID(),status:'complete',startedAt:started.toISOString(),completedAt:new Date(this.now()).toISOString(),completeThrough,source:SOURCE,rowCount:channelRows.length+dailyMetrics.length}]},{now:started});
    return {...snapshot,channelId,coverage:{source:SOURCE,requestedStartDate:startDate,requestedEndDate:endDate,availableThrough:completeThrough,watermarkMeaning:'Latest channel day returned for the requested metrics, subject to provider revision; missing dates remain unknown.',channelDaysReturned:channelRows.length,channelDaysExpected:dateSequence(startDate,completeThrough).length,videoSelection:this.allVideos?'all_current_uploads':'top_by_views_in_requested_period',videoLimit:this.allVideos?this.maxCatalogVideos:this.maxVideos,videoIdsReturned:videoIds.length,videoMetadataAvailable:metadata.length,videoMetadataMissing:videoIds.length-metadata.length,allVideosCovered:this.allVideos&&metadata.length===videoIds.length,videoReportsRequested:metadata.length,videosWithDailyRows:dailyByVideo.filter(rows=>rows.length>0).length,videosWithoutDailyRows:dailyByVideo.filter(rows=>rows.length===0).length,contentFormat:'not_classified; Shorts, long-form and live are not inferred from duration',videoSubscriberAttribution:'Video-filtered subscriptions are attributed to video watch pages and need not sum to channel subscriptions.'}};
  }
}
