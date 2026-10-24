import test from 'node:test';
import assert from 'node:assert/strict';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { handleMcp } from '../src/mcp.mjs';
import { identities, configuration, googleFixture, authorize, NOW } from './helpers.mjs';

const layout = { version: 2, theme: 'everforest', mode: 'dark', density: 'comfortable', columns: 'two', typography: 'sans', widgets: [
  { id: 'subscribers', kind: 'metric', metric: 'subscribersGained', width: 'half' },
  { id: 'watch', kind: 'trend', metric: 'watchHours', chart: 'line', width: 'full' },
  { id: 'sources', kind: 'breakdown', report: 'trafficSources', chart: 'bar', width: 'half' },
  { id: 'catalog', kind: 'videos', columns: ['publishedAt', 'views', 'watchHours'], sort: 'publishedAt', limit: 10, width: 'full' },
] };

test('builder stores ordered data widgets and publishes an honest scoped data catalog', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const a = await authorize(service, auth.a), b = await authorize(service, auth.b);
  const response = await handleMcp(service, auth.a, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_dashboard_layout', arguments: { connectionId: a, layout } } });
  assert.deepEqual(response.result.structuredContent, layout);
  const data = (await service.getDashboard(auth.a, a));
  assert.deepEqual(data.layout, layout);
  assert.equal((await service.getDashboard(auth.b, b)).layout.theme, 'cold-porcelain');
  assert.equal(data.catalog.themes.some(theme => theme.id === 'nord'), true);
  assert.equal(data.catalog.metrics.some(metric => metric.id === 'subscribersGained'), true);
  assert.equal(data.catalog.unavailable.find(item => item.id === 'revenue').reason, 'additional_scope_required');
  assert.equal(data.availability.views, 'not_synced');
  assert.equal(google.control.calls, 4);
  await assert.rejects(async () => (await service.updateLayout(auth.b, a, layout)), { code: 'NOT_FOUND' });
});

test('legacy layouts migrate without losing order and invalid widget bindings never overwrite saved preferences', async t => {
  const store = new SqliteStore(':memory:'); t.after(() => store.close());
  const auth = await identities(), google = googleFixture();
  const service = new DashboardService({ store, config: configuration(), fetchImpl: google.fetch, now: () => NOW });
  const id = await authorize(service, auth.a);
  const legacy = {version:1,theme:'dark',density:'compact',columns:'two',cards:['subscribersNet','views'],showTrend:false,showVideos:true};
  // Simulate a persisted record written by the previous released storage format.
  store.saveLayout(auth.a.id,id,JSON.stringify(legacy));
  const migrated = (await service.getDashboard(auth.a,id)).layout;
  assert.equal(migrated.version,2);assert.equal(migrated.mode,'dark');
  assert.deepEqual(migrated.widgets.map(widget=>widget.id),['subscribersNet','views','videos']);
  assert.equal((await service.updateLayout(auth.a,id,legacy)).version,2);
  const invalid = [
    {...layout,widgets:[]}, {...layout,widgets:Array.from({length:17},(_,i)=>({...layout.widgets[0],id:'item'+i}))},
    {...layout,widgets:[{id:'x',kind:'trend',metric:'averageViewDuration',chart:'line',width:'full'}]},
    {...layout,widgets:[{id:'x',kind:'metric',metric:'views',width:'full',url:'https://example.com'}]},
    {...layout,widgets:[{...layout.widgets[3],columns:['views','views']}]},
    {...layout,widgets:[{...layout.widgets[3],limit:500}]},
    {...layout,widgets:[{...layout.widgets[2],report:'privateEmails'}]},
  ];
  for(const value of invalid){await assert.rejects(async ()=>(await service.updateLayout(auth.a,id,value)),{code:'INVALID_LAYOUT'});assert.deepEqual((await service.getDashboard(auth.a,id)).layout,migrated);}
});

test('every published theme supports readable body, muted and action text in both modes', async t => {
  const store=new SqliteStore(':memory:');t.after(()=>store.close());
  const auth=await identities(),google=googleFixture();
  const service=new DashboardService({store,config:configuration(),fetchImpl:google.fetch,now:()=>NOW});
  const id=await authorize(service,auth.a);
  const themes=(await service.getDashboard(auth.a,id)).catalog.themes;
  assert.equal(themes.length,16);
  const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
  const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
  for(const theme of themes)for(const mode of ['light','dark']){
    const colors=theme[mode];
    for(const field of ['ink','ink-muted','jilan'])for(const bg of ['porcelain','surface'])assert.ok(contrast(colors[field],colors[bg])>=4.5,`${theme.id}/${mode}/${field}/${bg}`);
    assert.ok(contrast(colors.jilan,colors['on-jilan'])>=4.5,`${theme.id}/${mode}/button`);
  }
});


test('custom names are bounded plain text, preserve metric bindings, and do not rename the source channel', async t => {
 const store=new SqliteStore(':memory:');t.after(()=>store.close());
 const auth=await identities(),google=googleFixture();
 const service=new DashboardService({store,config:configuration(),fetchImpl:google.fetch,now:()=>NOW});
 const id=await authorize(service,auth.a), before=(await service.getDashboard(auth.a,id));
 const custom={...layout,name:'My weekly view',dashboardTitle:'My studio',widgets:layout.widgets.map(widget=>({...widget,title:'Custom '+widget.id}))};
 const result=await handleMcp(service,auth.a,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'update_dashboard_layout',arguments:{connectionId:id,layout:custom}}});
 assert.deepEqual(result.result.structuredContent,custom);
 assert.deepEqual((await service.getDashboard(auth.a,id)).channel,before.channel);
 assert.equal((await service.getDashboard(auth.a,id)).layout.widgets[0].metric,'subscribersGained');
 for(const value of [null,42,'x'.repeat(81),'bad\u0000name','bad\nname','<script>alert(1)</script>']) {
  for(const field of ['name','dashboardTitle'])await assert.rejects(async ()=>(await service.updateLayout(auth.a,id,{...custom,[field]:value})),{code:'INVALID_LAYOUT'});
  await assert.rejects(async ()=>(await service.updateLayout(auth.a,id,{...custom,widgets:[{...custom.widgets[0],title:value}]})),{code:'INVALID_LAYOUT'});
  assert.deepEqual((await service.getDashboard(auth.a,id)).layout,custom);
 }
 const reset={...custom,name:'',dashboardTitle:'',widgets:[{...custom.widgets[0],title:''}]};
 assert.deepEqual((await service.updateLayout(auth.a,id,reset)),reset);
 assert.equal(google.control.calls,2);
});
