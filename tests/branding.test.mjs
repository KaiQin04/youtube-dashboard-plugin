import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayout,defaultLayout} from '../src/layout.mjs';
import {resolveBrand,validIcon,ICON_CHOICES} from '../src/branding.mjs';
import { resolveSubtitle } from '../src/branding.mjs';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=';
test('subtitle belongs to saved display settings and can be hidden independently',()=>{
 const layout={...defaultLayout(),headerSubtitle:'My weekly channel notes',showHeaderSubtitle:true};
 assert.deepEqual(validateLayout(layout),layout);
 assert.equal(resolveSubtitle(layout),'My weekly channel notes');
 assert.equal(resolveSubtitle({...layout,showHeaderSubtitle:false}),null);
 assert.equal(resolveSubtitle({}),'YOUR CHANNEL, YOUR WORKSPACE');
 assert.throws(()=>validateLayout({...layout,headerSubtitle:'<script>'}));
});
test('header branding is optional and preserves stored layouts',()=>{
 const original=defaultLayout();assert.deepEqual(validateLayout(original),original);
 assert.deepEqual(resolveBrand(original),{name:'YouTube Dashboard',icon:'chart'});
 assert.deepEqual(resolveBrand(original,{name:'Custom Studio',icon:'chart'}),{name:'Custom Studio',icon:'chart'});
 const custom={...original,headerName:'My Studio',headerIcon:'camera'};
 assert.deepEqual(validateLayout(custom),custom);assert.equal(resolveBrand(custom).name,'My Studio');
 for(const {id} of ICON_CHOICES)validateLayout({...original,headerIcon:id});
 assert.equal(validIcon(png),true);validateLayout({...original,headerIcon:png});
});
test('branding rejects unsafe names, remote images, SVG and oversized payloads',()=>{
 for(const headerName of ['<script>','a\u202eb','x'.repeat(81)])assert.throws(()=>validateLayout({...defaultLayout(),headerName}));
 for(const headerIcon of ['https://tracker.example/icon.png','javascript:alert(1)','data:image/svg+xml,<svg/>','data:image/png;base64,PHNjcmlwdD4=','x'.repeat(16385)]){
  assert.equal(validIcon(headerIcon),false);assert.throws(()=>validateLayout({...defaultLayout(),headerIcon}));
 }
 assert.equal(resolveBrand({headerName:'   ',headerIcon:'default'}).name,'YouTube Dashboard');
});

import {SqliteStore} from '../src/store.mjs';
import {DashboardService} from '../src/service.mjs';
import {handleMcp} from '../src/mcp.mjs';
import {identities,configuration,googleFixture,authorize,NOW} from './helpers.mjs';
test('web and MCP share branding without cross-account or cross-connection leakage',async t=>{
 const store=new SqliteStore(':memory:');t.after(()=>store.close());
 const auth=await identities(),google=googleFixture(),service=new DashboardService({store,config:configuration(),fetchImpl:google.fetch,now:()=>NOW});
 const a=await authorize(service,auth.a),a2=await authorize(service,auth.a),b=await authorize(service,auth.b),before=google.control.calls;
 const layout={...defaultLayout(),headerName:'Only A',headerIcon:png};
 (await service.updateLayout(auth.a,a,layout));
 const result=await handleMcp(service,auth.a,{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_youtube_dashboard',arguments:{connectionId:a}}});
 assert.deepEqual(result.result.structuredContent.layout,layout);
 assert.equal((await service.getDashboard(auth.a,a2)).layout.headerName,undefined);
 assert.equal((await service.getDashboard(auth.b,b)).layout.headerName,undefined);
 await assert.rejects(async ()=>(await service.updateLayout(auth.b,a,layout)),{code:'NOT_FOUND'});
 assert.equal(google.control.calls,before);
});
