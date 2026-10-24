import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNativeSummary} from '../src/analytics/native-summary.mjs';
import {YouTubeSnapshotAdapter} from '../src/analytics/youtube.mjs';

test('native average is not recomputed from views; native totals and daily sums stay distinct',()=>{
 const daily={views:1000,watchMinutes:2000,subscribersNet:10,averageViewDurationSeconds:120,quality:{coverageComplete:true}};
 const result=applyNativeSummary(daily,{views:1000,estimatedMinutesWatched:2001,subscribersGained:12,subscribersLost:2,averageViewDuration:328,engagedViews:360});
 assert.equal(result.averageViewDurationSeconds,328);
 assert.equal(result.derivedAverageViewDurationSeconds,120);
 assert.equal(result.averageDurationDefinition.nativeMetric,true);
 assert.equal(result.watchMinutes,2001);assert.equal(result.dailyAggregate.watchMinutes,2000);
 assert.equal(result.subscribersNet,10);assert.equal(daily.averageViewDurationSeconds,120);
});

test('missing native response never falls back to falsely labeled derived average',()=>{
 const result=applyNativeSummary({views:10,averageViewDurationSeconds:120},null);
 assert.equal(result.views,10);assert.equal(result.averageViewDurationSeconds,null);
 assert.equal(result.averageDurationDefinition.kind,'unavailable');
 const zero=applyNativeSummary({}, {views:0,estimatedMinutesWatched:0,subscribersGained:0,subscribersLost:0,averageViewDuration:0,engagedViews:0});
 assert.equal(zero.averageViewDurationSeconds,null);assert.equal(zero.subscribersNet,0);
});

test('native period query fixes channel and metrics, strips unknown columns and rejects malformed values',async()=>{
 const metrics=['views','estimatedMinutesWatched','subscribersGained','subscribersLost','averageViewDuration','engagedViews'];
 let calls=0;
 const adapter=new YouTubeSnapshotAdapter({channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',tokenStore:{getAccessToken:async()=> 'fixture-secret'},fetchImpl:async(url,options)=>{
  calls++;assert.equal(options.method,'GET');assert.equal(url.searchParams.get('ids'),'channel==UCaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(url.searchParams.get('metrics'),metrics.join(','));assert.equal(url.searchParams.has('dimensions'),false);
  return Response.json({columnHeaders:[...metrics,'unexpected'].map(name=>({name})),rows:[[100,50,2,1,328,9,'fixture-secret']]});
 }});
 const result=await adapter.readNativeSummary({startDate:'2026-09-24',endDate:'2026-10-20'});
 assert.equal(result.averageViewDuration,328);assert.ok(!JSON.stringify(result).includes('fixture-secret'));
 await assert.rejects(adapter.readNativeSummary({startDate:'2026-10-21',endDate:'2026-10-20'}));assert.equal(calls,1);
});
