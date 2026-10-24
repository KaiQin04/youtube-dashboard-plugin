import test from 'node:test';
import assert from 'node:assert/strict';
import {YouTubeSnapshotAdapter} from '../src/analytics/youtube.mjs';
import {normalizeCoverage} from '../src/analytics/storage.mjs';

const channelId='UCaaaaaaaaaaaaaaaaaaaaaa';
const playlistId='UUaaaaaaaaaaaaaaaaaaaaaa';
const range={startDate:'2026-10-01',endDate:'2026-10-20'};
const report=rows=>({columnHeaders:['day','views','estimatedMinutesWatched','subscribersGained','subscribersLost'].map(name=>({name})),rows});
function fixture({count=73,missing=false,foreign=false,loop=false,failDaily=false,maxCatalogVideos=500}={}) {
 const ids=Array.from({length:count},(_,i)=>String(i).padStart(11,'0'));
 const calls=[];let active=0,maximum=0,tokenReads=0;
 const adapter=new YouTubeSnapshotAdapter({channelId,allVideos:true,maxCatalogVideos,now:()=>new Date('2026-10-23T08:00:00Z'),tokenStore:{getAccessToken:async()=>{tokenReads++;return 'fixture-secret';}},fetchImpl:async(url)=>{
  calls.push(new URL(url));
  if(url.pathname.endsWith('/channels'))return Response.json({items:[{id:channelId,snippet:{title:'Test'},contentDetails:{relatedPlaylists:{uploads:playlistId}}}]});
  if(url.pathname.endsWith('/playlistItems')){
   assert.equal(url.searchParams.get('playlistId'),playlistId);assert.equal(url.searchParams.get('maxResults'),'50');
   const offset=Number(url.searchParams.get('pageToken')??0);
   return Response.json({items:ids.slice(offset,offset+50).map(videoId=>({contentDetails:{videoId}})),...(loop?{nextPageToken:'0'}:offset+50<ids.length?{nextPageToken:String(offset+50)}:{})});
  }
  if(url.pathname.endsWith('/videos')){
   const batch=url.searchParams.get('id').split(',');assert.ok(batch.length<=50);
   return Response.json({items:batch.filter(id=>!missing||id!==ids[0]).map(id=>({id,snippet:{channelId:foreign?'UCbbbbbbbbbbbbbbbbbbbbbb':channelId,title:'Video',publishedAt:'2026-09-01T00:00:00Z'},contentDetails:{duration:'PT10M'}}))});
  }
  assert.notEqual(url.searchParams.get('dimensions'),'video');
  if(!url.searchParams.has('filters'))return Response.json(report([['2026-10-20',1000,500,10,1]]));
  active++;maximum=Math.max(maximum,active);
  await new Promise(resolve=>setTimeout(resolve,1));active--;
  if(failDaily)return new Response('fixture-secret',{status:403});
  return Response.json(report(url.searchParams.get('filters')===`video==${ids[0]}`?[]:[['2026-10-20',10,5,1,0]]));
 }});
 return {adapter,calls,stats:()=>({maximum,active,tokenReads})};
}

test('all uploads cross page and metadata batch boundaries, never use top20, bound concurrency',async()=>{
 const f=fixture();const result=await f.adapter.fetchSnapshot(range);
 assert.equal(result.videos.length,73);assert.equal(result.coverage.videoIdsReturned,73);
 assert.equal(result.coverage.allVideosCovered,true);assert.equal(result.coverage.videoSelection,'all_current_uploads');
 assert.equal(result.coverage.videoReportsRequested,73);assert.equal(result.coverage.videosWithoutDailyRows,1);
 assert.equal(result.dailyMetrics.length,72);assert.equal(f.calls.filter(x=>x.pathname.endsWith('/playlistItems')).length,2);
 assert.equal(f.calls.filter(x=>x.pathname.endsWith('/videos')).length,2);
 assert.equal(f.stats().tokenReads,1);assert.equal(f.stats().active,0);assert.ok(f.stats().maximum<=3);
 assert.deepEqual(normalizeCoverage(result.coverage),result.coverage);
 assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('missing metadata is explicit and cannot claim all videos covered',async()=>{
 const result=await fixture({count:3,missing:true}).adapter.fetchSnapshot(range);
 assert.equal(result.coverage.videoMetadataMissing,1);assert.equal(result.coverage.allVideosCovered,false);
 assert.equal(result.coverage.videoReportsRequested,2);
 assert.throws(()=>normalizeCoverage({...result.coverage,allVideosCovered:true}));
});

test('pagination loops, catalog cap and foreign metadata fail before accepting a snapshot',async()=>{
 await assert.rejects(fixture({count:1,loop:true}).adapter.fetchSnapshot(range),e=>e.code==='INVALID_UPSTREAM_DATA');
 await assert.rejects(fixture({count:2,maxCatalogVideos:1}).adapter.fetchSnapshot(range),e=>e.code==='CATALOG_TOO_LARGE');
 const f=fixture({count:2,foreign:true});await assert.rejects(f.adapter.fetchSnapshot(range),e=>e.code==='CHANNEL_MISMATCH');
 assert.equal(f.calls.filter(x=>x.searchParams.has('filters')).length,0);
});

test('failed daily requests drain bounded workers and return no partial snapshot or raw error',async()=>{
 const f=fixture({count:20,failDaily:true});
 await assert.rejects(f.adapter.fetchSnapshot(range),e=>e.code==='UPSTREAM_FORBIDDEN'&&!e.message.includes('fixture-secret'));
 assert.equal(f.stats().active,0);assert.ok(f.calls.filter(x=>x.searchParams.has('filters')).length<=3);
});

test('an empty upload catalog can still preserve independent channel totals',async()=>{
 const result=await fixture({count:0}).adapter.fetchSnapshot(range);
 assert.equal(result.videos.length,0);assert.equal(result.channelDailyMetrics[0].views,1000);
 assert.equal(result.coverage.allVideosCovered,true);
});
