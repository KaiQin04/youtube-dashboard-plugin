import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { identities, configuration, googleFixture, authorize, CHANNEL_A, CHANNEL_B, NOW } from './helpers.mjs';

test('two users authorize and select only their own verified channels', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(); const google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const a = await authorize(service, auth.a);
  google.control.channels = [CHANNEL_B];
  const b = await authorize(service, auth.b, CHANNEL_B);
  assert.deepEqual((await service.listConnections(auth.a)).map(c => c.channel.id), [CHANNEL_A]);
  assert.deepEqual((await service.listConnections(auth.b)).map(c => c.channel.id), [CHANNEL_B]);
  await assert.rejects(async () => (await service.getConnection(auth.b, a)), { code: 'NOT_FOUND' });
  await assert.rejects(service.selectChannel(auth.a, b, CHANNEL_B), { code: 'NOT_FOUND' });
  assert.equal((await service.getConnection(auth.a, a)).syncState, 'not_synced');
  const visible = JSON.stringify((await service.listConnections(auth.a)));
  assert.ok(google.control.tokens.every(token => !visible.includes(token)));
});

test('snapshots, exports and deletion remain isolated, even for the same channel', async t => {
  const store=new SqliteStore(':memory:'); t.after(()=>store.close());
  const auth=await identities(); const google=googleFixture();
  const service=new DashboardService({store,config:configuration(),fetchImpl:google.fetch,now:()=>NOW});
  const a=await authorize(service,auth.a); const b=await authorize(service,auth.b);
  await service.refresh(auth.a,a,{startDate:'2026-10-20',endDate:'2026-10-20'});
  assert.equal((await service.getData(auth.a,a)).snapshot.channelDailyMetrics[0].views,10);
  assert.equal((await service.getData(auth.b,b)).hasData,false);
  await assert.rejects(async ()=>(await service.getData(auth.b,a)),{code:'NOT_FOUND'});
  await assert.rejects(async ()=>(await service.exportData(auth.b,a,{table:'channel_daily',format:'json',startDate:'2026-10-20',endDate:'2026-10-20'})),{code:'NOT_FOUND'});
  const exported=(await service.exportData(auth.a,a,{table:'channel_daily',format:'json',startDate:'2026-10-20',endDate:'2026-10-20'}));
  assert.ok(JSON.stringify(exported).includes(CHANNEL_A));
  await assert.rejects(service.disconnect(auth.b,a),{code:'NOT_FOUND'});
  const removed=await service.disconnect(auth.a,a);
  assert.equal(removed.localDataDeleted,true); assert.equal(removed.googleRevoked,true);
  await assert.rejects(async ()=>(await service.getConnection(auth.a,a)),{code:'NOT_FOUND'});
  assert.equal((await service.getConnection(auth.b,b)).connected,true);
});
