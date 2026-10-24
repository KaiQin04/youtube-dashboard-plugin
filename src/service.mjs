import { AppError } from './errors.mjs';
import { applicationOrigin } from './origin.mjs';
import { requirePrincipal } from './auth/identity.mjs';
import { Vault, randomString, sha256 } from './crypto.mjs';
import { GoogleClient } from './google.mjs';
import { YouTubeSnapshotAdapter, boundedSyncRange } from './analytics/youtube.mjs';
import { createAnalyticsExport } from './analytics/export.mjs';
import { normalizeSnapshot, analyticsDate, addDays } from './analytics/contracts.mjs';
import { normalizeCoverage } from './analytics/storage.mjs';
import { MetricService } from './analytics/metrics.mjs';
import { MemoryRepository } from './analytics/repository.mjs';
import { applyNativeSummary } from './analytics/native-summary.mjs';
import { freshness } from './analytics/freshness.mjs';
import { loadLayout, validateLayout } from './layout.mjs';
import { dashboardData } from './dashboard-data.mjs';
import { validateReportRequest } from './analytics/reports.mjs';
import { reportKey } from './dashboard/report-catalog.mjs';

function configuration(config) {
  applicationOrigin(config);
  if (!config.googleClientId || !config.googleClientSecret) throw new AppError('CONFIGURATION','Configure Google credentials through server secrets.',503);
}

/** Application boundary: all caller-selected IDs are resolved under a verified tenant. */
export class DashboardService {
  #store; #vault; #google; #config; #now; #fetch;
  constructor({store,config,fetchImpl=globalThis.fetch,now=()=>Date.now()}) {
    configuration(config);
    this.#store=store; this.#config={...config}; this.#vault=new Vault(config.encryptionKey);
    this.#google=new GoogleClient(config,fetchImpl); this.#now=now; this.#fetch=fetchImpl;
  }
  #context(row,purpose='grant') { return [row.user_id,row.id,purpose,row.channel_id ?? 'unselected']; }
  async #row(principal,id,scope='dashboard:read') {
    const userId=requirePrincipal(principal,scope);
    if (typeof id!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) throw new AppError('NOT_FOUND','Connection not found.',404);
    await this.#store.prune(this.#now());
    return this.#store.get(userId,id);
  }
  async #public(row) {
    const channels=JSON.parse(row.channels_json);
    const snapshot=await this.#store.snapshot(row.user_id,row.id);
    return {id:row.id,status:row.status,connected:row.status==='connected',channel:channels.find(channel=>channel.id===row.channel_id)??null,channels:row.status==='select_channel'?channels:undefined,syncState:snapshot?'synced':'not_synced'};
  }
  async listConnections(principal) {
    const userId=requirePrincipal(principal,'dashboard:read'); await this.#store.prune(this.#now());
    const rows=await this.#store.list(userId);
    return Promise.all(rows.map(row=>this.#public(row)));
  }
  async getConnection(principal,id) { return this.#public(await this.#row(principal,id)); }
  async beginGoogle(principal) {
    const userId=requirePrincipal(principal,'dashboard:manage');
    const id=randomString(),state=randomString(),browserNonce=randomString(),verifier=randomString(48);
    const payload=this.#vault.seal({verifier},[userId,id,'oauth-state']);
    await this.#store.begin({userId,id,stateHash:sha256(state),browserHash:sha256(browserNonce),payload,now:this.#now()});
    return {connectionId:id,authorizationUrl:this.#google.authorizationUrl(state,verifier),browserNonce,expiresInSeconds:600};
  }
  async completeGoogle({callbackUrl,browserNonce,principal}) {
    const url=new URL(callbackUrl);
    if (url.origin+url.pathname!==this.#config.publicOrigin+'/oauth/google/callback' || url.hash || url.username || url.password || url.searchParams.getAll('state').length!==1) throw new AppError('INVALID_CALLBACK','Invalid OAuth callback.');
    const state=url.searchParams.get('state');
    if (!/^[A-Za-z0-9_-]{43}$/.test(state??'') || !/^[A-Za-z0-9_-]{43}$/.test(browserNonce??'')) throw new AppError('INVALID_STATE','Invalid or expired authorization state.');
    let pending;
    if (principal !== undefined) {
      const userId=requirePrincipal(principal,'dashboard:manage');
      if (typeof this.#store.consumeStateForUser!=='function') throw new AppError('CONFIGURATION','Principal-bound authorization is unavailable.',503);
      pending=await this.#store.consumeStateForUser(sha256(state),sha256(browserNonce),this.#now(),userId);
    } else {
      pending=await this.#store.consumeState(sha256(state),sha256(browserNonce),this.#now());
    }
    if (!pending) throw new AppError('INVALID_STATE','Invalid or expired authorization state.');
    if (url.searchParams.has('error') || url.searchParams.getAll('code').length!==1 || !url.searchParams.get('code') || url.searchParams.get('code').length>8192) throw new AppError('AUTHORIZATION_NOT_COMPLETED','Google authorization was not completed.');
    const {verifier}=this.#vault.open(pending.payload_cipher,[pending.user_id,pending.connection_id,'oauth-state']);
    const token=await this.#google.token({grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:verifier,redirect_uri:this.#config.publicOrigin+'/oauth/google/callback'});
    const channels=await this.#google.channels(token.accessToken);
    const row=await this.#store.get(pending.user_id,pending.connection_id);
    const grant=this.#vault.seal({...token,expiresAt:this.#now()+token.expiresIn*1000},this.#context(row));
    await this.#store.complete(row.user_id,row.id,channels,grant,this.#now());
    return {connectionId:row.id,selectionRequired:true,channels};
  }
  async selectChannel(principal,id,channelId) {
    const row=await this.#row(principal,id,'dashboard:manage');
    if (!JSON.parse(row.channels_json).some(channel=>channel.id===channelId)) throw new AppError('CHANNEL_FORBIDDEN','Choose a channel verified by this Google authorization.',403);
    if (row.status!=='select_channel') throw new AppError('CONNECTION_CHANGED','Create a new connection to change the bound channel.',409);
    const grant=this.#vault.open(row.grant_cipher,this.#context(row));
    await this.#store.select(row.user_id,id,channelId,this.#vault.seal(grant,this.#context({...row,channel_id:channelId})),row.version);
    return this.getConnection(principal,id);
  }
  async getData(principal,id) {
    const row=await this.#row(principal,id);
    const raw=await this.#store.snapshot(row.user_id,id);
    return {connection:await this.#public(row),hasData:Boolean(raw),snapshot:raw?JSON.parse(raw):null};
  }
  async exportData(principal,id,options) {
    const data=await this.getData(principal,id);
    if (!data.hasData) throw new AppError('NOT_SYNCED','This connection has no synchronized data.',409);
    return createAnalyticsExport(data.snapshot,options,{now:new Date(this.#now())});
  }
  async getDashboard(principal,id) {
    const data=await this.getData(principal,id);
    const row=await this.#row(principal,id);
    const layout=loadLayout(await this.#store.layout(row.user_id,id));
    if (!data.hasData) return dashboardData({connection:data.connection,hasData:false,channel:data.connection.channel,summary:null,daily:[],videos:[],layout});
    const snapshot=data.snapshot;
    const range={startDate:snapshot.coverage.requestedStartDate,endDate:snapshot.completeThrough};
    const metrics=new MetricService(new MemoryRepository(snapshot,{now:new Date(this.#now())}));
    const summary=applyNativeSummary(metrics.summary(range),snapshot.nativeSummary?.totals??null,snapshot.lastSyncedAt);
    const allVideos=metrics.videoMetrics({...range,limit:500}).videos;
    return dashboardData({connection:data.connection,hasData:true,channel:snapshot.channel,summary,daily:metrics.dailySeries(range).daily,videos:allVideos.slice(0,20),widgetVideos:allVideos,reportCache:Object.fromEntries(Object.values(snapshot.reportCache??{}).filter(report=>report.startDate===snapshot.coverage.requestedStartDate&&report.endDate===snapshot.coverage.requestedEndDate).map(report=>[reportKey(report),report])),videoDisplayLimit:20,coverage:snapshot.coverage,freshness:freshness(snapshot,{startDate:range.startDate,endDate:snapshot.coverage.requestedEndDate,now:new Date(this.#now())}),layout},snapshot.dashboardReports??{},allVideos);
  }
  async updateLayout(principal,id,layout) {
    const row=await this.#row(principal,id,'dashboard:manage');
    const validated=validateLayout(layout);
    await this.#store.saveLayout(row.user_id,id,JSON.stringify(validated));
    return validated;
  }
  async getReport(principal, id, args) {
    const row = await this.#row(principal, id);
    const request = { ...args, channelId: row.channel_id };
    validateReportRequest(request);
    const raw = await this.#store.snapshot(row.user_id, id);
    const key = JSON.stringify([args.reportId, args.videoId ?? null, args.startDate, args.endDate]);
    return (raw ? JSON.parse(raw).reportCache?.[key] : null) ?? { ...request, status: 'not_synced', rows: [], availableThrough: null };
  }
  async refreshReport(principal, id, args) {
    const row = await this.#row(principal, id, 'dashboard:manage');
    const definition = validateReportRequest({ ...args, channelId: row.channel_id });
    const end = addDays(analyticsDate(new Date(this.#now())), -1);
    if (args.endDate > end) throw new AppError('INVALID_RANGE', 'Only completed Pacific dates are supported.');
    const lease = await this.#store.acquire(row.user_id, id, 'sync', randomString(), this.#now(), 600000);
    try {
      const raw = await this.#store.snapshot(row.user_id, id);
      if (!raw) throw new AppError('NOT_SYNCED', 'Synchronize this connection before loading reports.', 409);
      const snapshot = JSON.parse(raw);
      if (definition.video && !snapshot.videos.some(video => video.id === args.videoId)) throw new AppError('VIDEO_NOT_SYNCED', 'Select a video from this authorized channel.', 403);
      const key = JSON.stringify([args.reportId, args.videoId ?? null, args.startDate, args.endDate]);
      const previous = snapshot.reportCache?.[key];
      if (previous?.observedAt && this.#now() - Date.parse(previous.observedAt) < 60000) return { ...previous, refreshSkipped: 'recently_updated' };
      const adapter = new YouTubeSnapshotAdapter({ channelId: row.channel_id, tokenStore: { getAccessToken: () => this.#accessToken(row) }, fetchImpl: this.#fetch, now: () => new Date(this.#now()) });
      await adapter.verifyOwnedChannel();
      if (definition.video) await adapter.verifyReportVideo(args.videoId);
      const report = await adapter.readDashboardReport(args);
      const cache = { ...snapshot.reportCache }; delete cache[key]; cache[key] = report;
      snapshot.reportCache = Object.fromEntries(Object.entries(cache).slice(-32));
      const payload = JSON.stringify(snapshot);
      if (new TextEncoder().encode(payload).byteLength > 1_800_000) throw new AppError('SNAPSHOT_TOO_LARGE', 'Report cache exceeds storage capacity; previous data was preserved.', 409);
      await this.#store.saveSnapshot(row.user_id, id, row.channel_id, payload, lease, this.#now());
      return report;
    } catch (error) {
      if (error instanceof AppError && error.code === 'REAUTH_REQUIRED') {
        try {
          const current = await this.#store.get(row.user_id, id);
          await this.#store.markReauth(row.user_id, id, current.version);
        } catch {}
      }
      throw error;
    } finally { await this.#store.release(row.user_id, id, 'sync', lease); }
  }
  async #accessToken(row) {
    if (row.status!=='connected') throw new AppError('REAUTH_REQUIRED','Connect and select a verified channel before synchronizing.',401);
    let grant=this.#vault.open(row.grant_cipher,this.#context(row));
    if (grant.expiresAt>this.#now()+60000) return grant.accessToken;
    const lease=await this.#store.acquire(row.user_id,row.id,'grant',randomString(),this.#now(),60000);
    try {
      row=await this.#store.get(row.user_id,row.id);
      grant=this.#vault.open(row.grant_cipher,this.#context(row));
      if (grant.expiresAt>this.#now()+60000) return grant.accessToken;
      const refreshed=await this.#google.token({grant_type:'refresh_token',refresh_token:grant.refreshToken},grant);
      const channels=await this.#google.channels(refreshed.accessToken);
      if (!channels.some(channel=>channel.id===row.channel_id)) throw new AppError('REAUTH_REQUIRED','The bound channel is no longer accessible.',401);
      await this.#store.replaceGrant(row.user_id,row.id,row.version,this.#vault.seal({...refreshed,expiresAt:this.#now()+refreshed.expiresIn*1000},this.#context(row)),lease,this.#now());
      return refreshed.accessToken;
    } catch (error) {
      if (error instanceof AppError && error.code==='REAUTH_REQUIRED') await this.#store.markReauth(row.user_id,row.id,row.version);
      throw error;
    } finally { await this.#store.release(row.user_id,row.id,'grant',lease); }
  }
  async refresh(principal,id,options) {
    const row=await this.#row(principal,id,'dashboard:manage');
    const endDate=addDays(analyticsDate(new Date(this.#now())),-1);
    const range=boundedSyncRange(options??{startDate:addDays(endDate,-27),endDate});
    if (range.endDate>endDate) throw new AppError('INVALID_RANGE','Only completed Pacific calendar days can be synchronized.');
    if (options && Object.keys(options).some(key=>!['startDate','endDate'].includes(key))) throw new AppError('INVALID_ARGUMENTS','Unexpected refresh field.');
    if (row.status!=='connected') throw new AppError('REAUTH_REQUIRED','Connect and select a verified channel before synchronizing.',401);
    const lease=await this.#store.acquire(row.user_id,id,'sync',randomString(),this.#now(),600000);
    try {
      const previous=await this.#store.snapshot(row.user_id,id);
      if (previous && this.#now()-Date.parse(JSON.parse(previous).lastSyncedAt)<900000) throw new AppError('REFRESH_COOLDOWN','Wait fifteen minutes between successful synchronizations.',429);
      const adapter=new YouTubeSnapshotAdapter({channelId:row.channel_id,tokenStore:{getAccessToken:channelId=>{
        if (channelId!==row.channel_id) throw new AppError('CHANNEL_FORBIDDEN','The token is bound to another channel.',403);
        return this.#accessToken(row);
      }},fetchImpl:this.#fetch,now:()=>new Date(this.#now()),allVideos:true});
      const incoming=await adapter.fetchSnapshot(range);
      const snapshot=normalizeSnapshot(incoming,{now:new Date(this.#now())});
      snapshot.coverage=normalizeCoverage(incoming.coverage);
      try {
        const summaryRange={startDate:range.startDate,endDate:snapshot.completeThrough};
        snapshot.nativeSummary={...summaryRange,totals:await adapter.readNativeSummary(summaryRange)};
      } catch(error) { if(error instanceof AppError&&error.code==='REAUTH_REQUIRED')throw error;snapshot.nativeSummary=null; }
      snapshot.dashboardReports=await adapter.readDashboardReports({startDate:range.startDate,endDate:snapshot.completeThrough});
      const saved = previous ? JSON.parse(previous) : null;
      if (saved?.channel?.id === row.channel_id && saved.reportCache) {
        const cache = [];
        for (const [key, report] of Object.entries(saved.reportCache).slice(-32)) {
          try {
            const request = { channelId: report.channelId, reportId: report.reportId, startDate: report.startDate, endDate: report.endDate, ...(report.videoId ? { videoId: report.videoId } : {}) };
            validateReportRequest(request);
            if (report.channelId === row.channel_id && report.endDate <= endDate && key === JSON.stringify([report.reportId, report.videoId ?? null, report.startDate, report.endDate])) cache.push([key, report]);
          } catch { /* Ignore malformed legacy cache entries; never relabel their range. */ }
        }
        snapshot.reportCache = Object.fromEntries(cache);
      }
      const payload = JSON.stringify(snapshot);
      if (new TextEncoder().encode(payload).byteLength > 1_800_000) throw new AppError('SNAPSHOT_TOO_LARGE', 'Snapshot exceeds storage capacity; previous data was preserved.', 409);
      await this.#store.saveSnapshot(row.user_id,id,row.channel_id,payload,lease,this.#now());
      return await this.getData(principal,id);
    } catch(error) {
      if(error instanceof AppError&&error.code==='REAUTH_REQUIRED'){
        try { const current=await this.#store.get(row.user_id,id);await this.#store.markReauth(row.user_id,id,current.version); } catch {}
      }
      throw error;
    } finally { await this.#store.release(row.user_id,id,'sync',lease); }
  }
  async disconnect(principal,id) {
    const row=await this.#row(principal,id,'dashboard:manage');
    // Local deletion happens first; FK cascades and later writes cannot resurrect this ID.
    await this.#store.remove(row.user_id,id);
    let googleRevoked=false;
    if (row.grant_cipher) {
      try { googleRevoked=await this.#google.revoke(this.#vault.open(row.grant_cipher,this.#context(row)).refreshToken); }
      catch {}
    }
    return {localDataDeleted:true,googleRevoked,revocationStatus:row.grant_cipher?(googleRevoked?'confirmed':'unconfirmed'):'no_stored_grant'};
  }
}
