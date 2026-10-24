import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { identities, configuration, googleFixture, authorize, ORIGIN, CHANNEL_A, CHANNEL_B, NOW } from './helpers.mjs';

async function setup(t,options={}) {
  const store=new SqliteStore(options.filename??':memory:'); t.after(()=>store.close());
  const auth=await identities(),google=googleFixture(),config=configuration(); let now=NOW;
  const service=new DashboardService({store,config,fetchImpl:google.fetch,now:()=>now});
  const callback=start=>`${ORIGIN}/oauth/google/callback?state=${new URL(start.authorizationUrl).searchParams.get('state')}&code=synthetic-code`;
  return {store,auth,google,config,service,callback,advance:ms=>{now+=ms;}};
}

test('OAuth state is browser-bound, single-use, expiring and uses only the two read-only scopes',async t=>{
  const f=await setup(t);const start=await f.service.beginGoogle(f.auth.a);const url=new URL(start.authorizationUrl);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.deepEqual(new Set(url.searchParams.get('scope').split(' ')),new Set(['https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/yt-analytics.readonly']));
  await assert.rejects(f.service.completeGoogle({callbackUrl:f.callback(start),browserNonce:'x'.repeat(43)}),{code:'INVALID_STATE'});
  const result=await f.service.completeGoogle({callbackUrl:f.callback(start),browserNonce:start.browserNonce});
  await assert.rejects(f.service.completeGoogle({callbackUrl:f.callback(start),browserNonce:start.browserNonce}),{code:'INVALID_STATE'});
  await assert.rejects(f.service.selectChannel(f.auth.a,result.connectionId,CHANNEL_B),{code:'CHANNEL_FORBIDDEN'});
  await assert.rejects(f.service.selectChannel(f.auth.b,result.connectionId,CHANNEL_A),{code:'NOT_FOUND'});
  const expired=await f.service.beginGoogle(f.auth.b);f.advance(600001);
  await assert.rejects(f.service.completeGoogle({callbackUrl:f.callback(expired),browserNonce:expired.browserNonce}),{code:'INVALID_STATE'});
});

test('wrong callbacks and cancellation never exchange codes or leak provider errors',async t=>{
  const f=await setup(t);const start=await f.service.beginGoogle(f.auth.a);const callback=f.callback(start);
  const before=f.google.control.calls;
  for (const bad of [callback.replace(ORIGIN,'https://attacker.example'),callback+'&state=duplicate',callback+'#fragment']) {
    await assert.rejects(f.service.completeGoogle({callbackUrl:bad,browserNonce:start.browserNonce}));
  }
  await assert.rejects(f.service.completeGoogle({callbackUrl:callback+'&error=access_denied',browserNonce:start.browserNonce}),{code:'AUTHORIZATION_NOT_COMPLETED'});
  assert.equal(f.google.control.calls,before);
});

test('expired token refresh remains tenant-bound and invalid_grant preserves a reauth state',async t=>{
  const f=await setup(t);const a=await authorize(f.service,f.auth.a);f.google.control.channels=[CHANNEL_B];const b=await authorize(f.service,f.auth.b,CHANNEL_B);
  f.advance(3600001);
  await f.service.refresh(f.auth.a,a,{startDate:'2026-10-20',endDate:'2026-10-20'});
  assert.equal((await f.service.getData(f.auth.a,a)).snapshot.channel.id,CHANNEL_A);
  f.google.control.failRefresh=true;
  await assert.rejects(f.service.refresh(f.auth.b,b,{startDate:'2026-10-20',endDate:'2026-10-20'}));
  assert.equal((await f.service.getConnection(f.auth.b,b)).status,'reauth_required');
  assert.equal((await f.service.getConnection(f.auth.a,a)).connected,true);
});

test('revocation failure still removes local data and reports that Google revocation is unconfirmed',async t=>{
  const f=await setup(t);const a=await authorize(f.service,f.auth.a);f.google.control.failRevoke=true;
  assert.deepEqual(await f.service.disconnect(f.auth.a,a),{localDataDeleted:true,googleRevoked:false,revocationStatus:'unconfirmed'});
  await assert.rejects(async ()=>(await f.service.getData(f.auth.a,a)),{code:'NOT_FOUND'});
});

test('persistent database contains encrypted grants and survives reopening without public secrets',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'youtube-dashboard-test-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'test.sqlite');const auth=await identities(),google=googleFixture(),config=configuration();
  let store=new SqliteStore(filename);let service=new DashboardService({store,config,fetchImpl:google.fetch,now:()=>NOW});
  const id=await authorize(service,auth.a);store.close();
  const bytes=readFileSync(filename).toString('latin1');assert.ok(google.control.tokens.every(token=>!bytes.includes(token)));
  store=new SqliteStore(filename);t.after(()=>store.close());service=new DashboardService({store,config,fetchImpl:google.fetch,now:()=>NOW});
  assert.equal((await service.getConnection(auth.a,id)).channel.id,CHANNEL_A);
  await assert.rejects(async ()=>(await service.getConnection(auth.b,id)),{code:'NOT_FOUND'});
});

test('deletion during a running sync fences the later snapshot write',async t=>{
  const f=await setup(t);const id=await authorize(f.service,f.auth.a);
  let reached,release;const ready=new Promise(resolve=>{reached=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  f.google.control.onReports=async()=>{reached();await blocked;};
  const pending=f.service.refresh(f.auth.a,id,{startDate:'2026-10-20',endDate:'2026-10-20'});
  await ready;await f.service.disconnect(f.auth.a,id);release();
  await assert.rejects(pending,{code:'CONNECTION_CHANGED'});
  assert.equal((await f.service.listConnections(f.auth.a)).length,0);
});

test('sync leases serialize one connection while allowing independent users',async t=>{
  const f=await setup(t);const a=await authorize(f.service,f.auth.a);const b=await authorize(f.service,f.auth.b);
  let reached,release;const ready=new Promise(resolve=>{reached=resolve;});const blocked=new Promise(resolve=>{release=resolve;});
  f.google.control.onReports=async()=>{reached();await blocked;};
  const pending=f.service.refresh(f.auth.a,a,{startDate:'2026-10-20',endDate:'2026-10-20'});
  await ready;
  await assert.rejects(f.service.refresh(f.auth.a,a,{startDate:'2026-10-20',endDate:'2026-10-20'}),{code:'OPERATION_BUSY'});
  f.google.control.onReports=null;await f.service.refresh(f.auth.b,b,{startDate:'2026-10-20',endDate:'2026-10-20'});
  release();await pending;
  assert.equal((await f.service.getData(f.auth.b,b)).hasData,true);
});

test('transient refresh failure is not mislabeled as revoked authorization',async t=>{
  const store=new SqliteStore(':memory:');t.after(()=>store.close());const auth=await identities(),google=googleFixture();let now=NOW,fail=false;
  const service=new DashboardService({store,config:configuration(),now:()=>now,fetchImpl:async(url,options)=>fail&&new URL(url).pathname==='/token'?new Response('',{status:503}):google.fetch(url,options)});
  const id=await authorize(service,auth.a);now+=3600001;fail=true;
  await assert.rejects(service.refresh(auth.a,id,{startDate:'2026-10-20',endDate:'2026-10-20'}),{code:'OAUTH_UPSTREAM_UNAVAILABLE'});
  assert.equal((await service.getConnection(auth.a,id)).connected,true);
});

test('provider revocation during a still-valid token updates connection state',async t=>{
  const store=new SqliteStore(':memory:');t.after(()=>store.close());const auth=await identities(),google=googleFixture();let revoked=false;
  const service=new DashboardService({store,config:configuration(),now:()=>NOW,fetchImpl:async(url,options)=>revoked&&new URL(url).pathname==='/youtube/v3/channels'?new Response('',{status:401}):google.fetch(url,options)});
  const id=await authorize(service,auth.a);revoked=true;
  await assert.rejects(service.refresh(auth.a,id,{startDate:'2026-10-20',endDate:'2026-10-20'}),{code:'REAUTH_REQUIRED'});
  assert.equal((await service.getConnection(auth.a,id)).status,'reauth_required');
});
