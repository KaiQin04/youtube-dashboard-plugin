import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubeSnapshotAdapter,parseDailyReport,parseDuration,boundedSyncRange} from '../src/analytics/youtube.mjs';
import {MetricService} from '../src/analytics/metrics.mjs';
import {MemoryRepository} from '../src/analytics/repository.mjs';
const channelId='UCaaaaaaaaaaaaaaaaaaaaaa',videoId='abcdefghijk';
const headers=d=>[d,'views','estimatedMinutesWatched','subscribersGained','subscribersLost'].map(name=>({name}));
const report=(dimension,rows)=>({columnHeaders:headers(dimension),rows});
const NOW=new Date('2026-10-23T02:00:00Z');
const channel={items:[{id:channelId,snippet:{title:'Test channel'}}]};
const metadata={items:[{id:videoId,snippet:{channelId,title:'Test video',publishedAt:'2026-10-01T00:00:00Z'},contentDetails:{duration:'PT9M4S'}}]};
function fixture(overrides={}) {
 const calls=[];
 const adapter=new YouTubeSnapshotAdapter({channelId,now:()=>NOW,tokenStore:{getAccessToken:async()=> 'test-token-never-public'},fetchImpl:async(url,options)=>{
   calls.push({url:new URL(url),options});
   let data;
   if(url.pathname.endsWith('/channels')) data=overrides.channel??channel;
   else if(url.pathname.endsWith('/videos')) data=overrides.metadata??metadata;
   else if(url.searchParams.get('dimensions')==='video') data=overrides.top??report('video',[[videoId,100,50,2,0]]);
   else if(url.searchParams.has('filters')) data=overrides.video??report('day',[['2026-10-20',40,20,1,0],['2026-10-21',60,30,1,0]]);
   else data=overrides.channelDaily??report('day',[['2026-10-20',100,40,3,1],['2026-10-21',200,80,4,0]]);
   return new Response(JSON.stringify(data),{status:200});
 }});
 return {adapter,calls};
}
const range={channelId,startDate:'2026-10-20',endDate:'2026-10-22'};
test('snapshot stays within official read-only origins and derives observed watermark, not requested end',async()=>{
 const {adapter,calls}=fixture(); const data=await adapter.fetchSnapshot(range);
 assert.equal(data.completeThrough,'2026-10-21');assert.equal(data.channelDailyMetrics[1].views,200);assert.equal(data.dailyMetrics[1].views,60);
 assert.equal(data.videos[0].durationSeconds,544);assert.equal(data.mode,'real');assert.equal(data.coverage.allVideosCovered,false);assert.equal(data.coverage.videoLimit,20);assert.equal(data.coverage.videoSelection,'top_by_views_in_requested_period');
 assert.equal(calls.length,5);assert.ok(calls.every(x=>x.options.method==='GET'&&x.options.redirect==='manual'&&!x.url.href.includes('token')));
 assert.deepEqual(new Set(calls.map(x=>x.url.origin)),new Set(['https://www.googleapis.com','https://youtubeanalytics.googleapis.com']));
 assert.ok(calls.filter(x=>x.url.pathname==='/v2/reports').every(x=>x.url.searchParams.get('ids')===`channel==${channelId}`));
 assert.equal(calls[2].url.searchParams.get('endDate'),'2026-10-21');assert.equal(calls[2].url.searchParams.get('sort'),'-views');assert.equal(calls[2].url.searchParams.get('maxResults'),'20');
 assert.ok(!JSON.stringify(data).includes('test-token'));assert.equal(data.channelDailyMetrics[0].likes,null);
});
test('missing day remains missing, null remains null, zero remains zero',async()=>{
 const {adapter}=fixture({channelDaily:report('day',[['2026-10-19',0,0,0,0],['2026-10-21',null,null,2,0]])});
 const data=await adapter.fetchSnapshot({...range,startDate:'2026-10-19'});
 assert.equal(data.channelDailyMetrics.length,2);assert.equal(data.channelDailyMetrics[0].views,0);assert.equal(data.channelDailyMetrics[1].views,null);assert.equal(data.channelDailyMetrics[1].totalWatchSeconds,null);
 assert.equal(data.coverage.channelDaysExpected,3);assert.equal(data.coverage.channelDaysReturned,2);
});
test('empty channel report refuses a new success snapshot; an empty top list does not erase channel totals',async()=>{
 await assert.rejects(fixture({channelDaily:report('day',[])}).adapter.fetchSnapshot(range),e=>e.code==='NO_DATA_AVAILABLE');
 const {adapter,calls}=fixture({top:report('video',[])});const data=await adapter.fetchSnapshot(range);
 assert.equal(data.videos.length,0);assert.equal(data.channelDailyMetrics.length,2);assert.equal(calls.length,3);assert.equal(data.coverage.allVideosCovered,false);
});
test('missing private/deleted metadata is disclosed; foreign metadata never accepted',async()=>{
 const data=await fixture({metadata:{items:[]}}).adapter.fetchSnapshot(range);assert.equal(data.coverage.videoMetadataMissing,1);assert.equal(data.dailyMetrics.length,0);
 await assert.rejects(fixture({metadata:{items:[{...metadata.items[0],snippet:{...metadata.items[0].snippet,channelId:'UCbbbbbbbbbbbbbbbbbbbbbb'}}]}}).adapter.fetchSnapshot(range),e=>e.code==='CHANNEL_MISMATCH');
 await assert.rejects(fixture({channel:{items:[]}}).adapter.fetchSnapshot(range),e=>e.code==='CHANNEL_MISMATCH');
});
test('binding and date/limit bounds fail before fetching',async()=>{
 const {adapter,calls}=fixture();await assert.rejects(adapter.fetchSnapshot({...range,channelId:'UCbbbbbbbbbbbbbbbbbbbbbb'}),e=>e.code==='CHANNEL_MISMATCH');assert.equal(calls.length,0);
 assert.throws(()=>boundedSyncRange({startDate:'2026-02-30',endDate:'2026-03-01'}));
 assert.throws(()=>boundedSyncRange({startDate:'2026-01-01',endDate:'2026-02-01'}));
 assert.throws(()=>new YouTubeSnapshotAdapter({channelId,maxVideos:21,tokenStore:{getAccessToken(){}}}));
});
test('bad upstream rows: duplicate day, unknown ID, negative/fractional counters, shape, current day',async()=>{
 const invalid=[report('day',[['2026-10-20',1,1,0,0],['2026-10-20',1,1,0,0]]),report('day',[['2026-10-20',-1,1,0,0]]),report('day',[['2026-10-20',1.5,1,0,0]]),report('day',[['2026-10-20',1]]),report('day',[['2026-10-22',1,1,0,0]])];
 for(const channelDaily of invalid) await assert.rejects(fixture({channelDaily}).adapter.fetchSnapshot(range));
 await assert.rejects(fixture({top:report('video',[[videoId,1,1,0,0],[videoId,2,2,0,0]])}).adapter.fetchSnapshot(range));
});
test('provider exceptions, HTTP errors and redirects never echo secrets',async()=>{
 for(const fetchImpl of [async()=>{throw Error('test-token-never-public')},async()=>new Response('test-token-never-public',{status:401}),async()=>new Response('test-token-never-public',{status:403}),async()=>new Response('test-token-never-public',{status:429}),async()=>new Response('test-token-never-public',{status:302}),async()=>new Response('not-json-test-token-never-public')]) {
   const adapter=new YouTubeSnapshotAdapter({channelId,fetchImpl,tokenStore:{getAccessToken:async()=> 'test-token-never-public'}});
   await assert.rejects(adapter.fetchSnapshot(range),e=>!e.message.includes('test-token'));
 }
});
test('duration parser does not infer Shorts and rejects calendar duration units',()=>{
 assert.equal(parseDuration('P1DT2H3M4.5S'),93784.5);assert.equal(parseDuration(null),null);assert.equal(parseDuration('PT0S'),0);
 for(const bad of ['P1Y','P1M','PT','P','garbage','PT-3S']) assert.throws(()=>parseDuration(bad));
});
test('absent metrics are invalid while explicit null is allowed',()=>{
 const context={channelId,startDate:'2026-10-20',endDate:'2026-10-21'};
 assert.throws(()=>parseDailyReport({columnHeaders:headers('day').slice(0,3),rows:[]},context));
 assert.throws(()=>parseDailyReport({columnHeaders:[...headers('day'),{name:'views'}],rows:[]},context));
 assert.throws(()=>parseDailyReport(report('day',[['2026-10-20',1,undefined,0,0]]),context));
});

test('upstream diagnostics expose only fixed stages and HTTP status',async()=>{
 for(const stage of ['channel_identity','channel_daily','top_videos','video_metadata','video_daily']) {
  let calls=0;
  const failureIndex=['channel_identity','channel_daily','top_videos','video_metadata','video_daily'].indexOf(stage);
  const adapter=new YouTubeSnapshotAdapter({channelId,now:()=>NOW,tokenStore:{getAccessToken:async()=> 'fixture-secret'},fetchImpl:async()=>{
   if(calls++===failureIndex)return new Response('private-upstream-message-fixture-secret',{status:400});
   return Response.json([channel,report('day',[['2026-10-20',1,1,0,0]]),report('video',[[videoId,1,1,0,0]]),metadata][calls-1]);
  }});
  await assert.rejects(adapter.fetchSnapshot(range),e=>e.message===`YouTube request failed (stage=${stage}, HTTP=400). No snapshot was saved.`);
 }
});

test('observed days before public release are retained without breaking totals or release-age windows',async()=>{
 const {adapter}=fixture({metadata:{items:[{...metadata.items[0],snippet:{...metadata.items[0].snippet,publishedAt:'2026-10-21T12:00:00Z'}}]}});
 const snapshot=await adapter.fetchSnapshot(range);
 assert.equal(snapshot.dailyMetrics[0].date,'2026-10-20');
 assert.equal(snapshot.dailyMetrics[0].views,40);
 const service=new MetricService(new MemoryRepository(snapshot,{now:NOW}),{now:()=>NOW});
 const video=service.videoMetrics(range).videos[0];
 assert.equal(video.views,100);assert.equal(video.quality.coverageComplete,true);
 assert.equal(video.quality.expectedRows,2);
 const before=service.summary({startDate:'2026-10-20',endDate:'2026-10-20',videoIds:[videoId]});
 assert.equal(before.views,40);
 const gap=service.summary({startDate:'2026-10-19',endDate:'2026-10-19',videoIds:[videoId]});
 assert.equal(gap.views,null);
});

test('temporary server errors retry with a fixed bound, while permission errors never retry',async()=>{
 for(const status of [500,502,503,504,401,403,429,302]) {
  let calls=0;
  const adapter=new YouTubeSnapshotAdapter({channelId,tokenStore:{getAccessToken:async()=> 'fixture-secret'},fetchImpl:async()=>{calls++;return new Response('fixture-secret',{status});}});
  await assert.rejects(adapter.verifyOwnedChannel(),e=>!e.message.includes('fixture-secret'));
  assert.equal(calls,[500,502,503,504].includes(status)?3:1);
 }
 let calls=0;
 const adapter=new YouTubeSnapshotAdapter({channelId,tokenStore:{getAccessToken:async()=> 'fixture-secret'},fetchImpl:async()=>++calls===1?new Response('fixture-secret',{status:500}):Response.json(channel)});
 assert.equal((await adapter.verifyOwnedChannel()).id,channelId);assert.equal(calls,2);
});
