import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeSnapshotAdapter } from '../src/analytics/youtube.mjs';
import { readJson } from '../src/google.mjs';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';

test('oversized chunked YouTube bodies are cancelled before the full response is buffered',async()=>{
 let cancelled=false,pulls=0;
 const adapter=new YouTubeSnapshotAdapter({channelId:'UCaaaaaaaaaaaaaaaaaaaaaa',tokenStore:{getAccessToken:async()=>'synthetic'},fetchImpl:async()=>new Response(new ReadableStream({pull(controller){pulls++;if(pulls>20){controller.close();return;}controller.enqueue(new Uint8Array(1_000_000));},cancel(){cancelled=true;}}))});
 await assert.rejects(adapter.verifyOwnedChannel());assert.equal(cancelled,true);assert.ok(pulls<10);
});

test('expired refresh leases cannot overwrite authorization after their deadline',async t=>{
 const store=new SqliteStore(':memory:');t.after(()=>store.close());const auth=await identities(),google=googleFixture();let now=NOW,expire=false;
 const service=new DashboardService({store,config:configuration(),now:()=>now,fetchImpl:async(url,options)=>{const result=await google.fetch(url,options);if(expire&&new URL(url).pathname==='/token')now+=60001;return result;}});
 const id=await authorize(service,auth.a);now+=3600001;expire=true;
 await assert.rejects(service.refresh(auth.a,id,{startDate:'2026-10-20',endDate:'2026-10-20'}),{code:'CONNECTION_CHANGED'});
 assert.equal((await service.getData(auth.a,id)).hasData,false);
});
