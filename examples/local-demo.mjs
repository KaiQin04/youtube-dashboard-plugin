import { createServer } from 'node:http';
import { panelHtml } from '../src/panel-resource.mjs';
import { pathToFileURL } from 'node:url';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { handleMcp } from '../src/mcp.mjs';
import { identities, configuration, authorize, CHANNEL_B, NOW } from './synthetic-fixtures.mjs';
import { dashboardDemoFixture } from './dashboard-demo-data.mjs';

/** Loopback-only synthetic demo. No environment credentials, real Google requests or persistence. */
export async function startDemo({port=4317}={}) {
  const store=new SqliteStore(':memory:');const auth=await identities(),google=dashboardDemoFixture();
  const service=new DashboardService({store,config:configuration(),fetchImpl:google.fetch,now:()=>NOW});
  const a=await authorize(service,auth.a);google.control.channels=[CHANNEL_B];const b=await authorize(service,auth.b,CHANNEL_B);
  for(const [principal,id]of [[auth.a,a],[auth.b,b]])await service.refresh(principal,id,{startDate:'2026-09-23',endDate:'2026-10-20'});
  const host=`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>YouTube Dashboard — 本機合成示範</title><style>body{font:16px system-ui;background:#e7efec;color:#213b39;margin:24px auto;max-width:1000px;padding:0 16px}select{font:inherit;padding:8px}iframe{width:100%;height:780px;border:1px solid #bccfc8;border-radius:16px;background:#f3f7f6}p{line-height:1.6}</style><h1>本機合成示範</h1><p>兩個獨立測試帳號，沒有使用 Google 帳號、真實頻道資料或現有憑證。</p><label>測試帳號 <select id="tenant"><option value="a">使用者 A · Synthetic A</option><option value="b">使用者 B · Synthetic B</option></select></label><p>切換帳號後，面板只會取得該帳號自己的頻道與資料。</p><iframe id="panel" src="/panel" title="YouTube 儀表板"></iframe><script>const panel=document.getElementById('panel'),tenant=document.getElementById('tenant');tenant.onchange=()=>{panel.src='/panel?tenant='+tenant.value;};window.addEventListener('message',async event=>{if(event.source!==panel.contentWindow||event.origin!==location.origin||event.data?.jsonrpc!=='2.0')return;const request=event.data;if(!Object.hasOwn(request,'id'))return;const destination=event.source;try{let result;if(request.method==='ui/initialize')result={protocolVersion:'2026-01-26',hostInfo:{name:'local-synthetic-host',version:'1.0'},hostCapabilities:{serverTools:{}},hostContext:{theme:'light'}};else{const response=await fetch('/rpc/'+tenant.value,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});const reply=await response.json();if(reply.error){destination.postMessage(reply,location.origin);return;}result=reply.result;}destination.postMessage({jsonrpc:'2.0',id:request.id,result},location.origin);}catch{destination.postMessage({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:'Synthetic demo failure'}},location.origin);}});</script></html>`;
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    // Host/Origin checks prevent DNS rebinding or a remote page driving the loopback demo.
    const expected=`127.0.0.1:${server.address().port}`;
    if(req.headers.host!==expected||(req.headers.origin&&req.headers.origin!==`http://${expected}`)){res.writeHead(403);res.end();return;}
    try{
      const path=req.url.split('?')[0];
      if(req.method==='GET'&&path==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(host);return;}
      if(req.method==='GET'&&path==='/panel'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(panelHtml());return;}
      if(req.method==='POST'&&/^\/rpc\/[ab]$/.test(path)){
        const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>65536){res.writeHead(413);res.end();return;}chunks.push(chunk);}
        const message=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const result=await handleMcp(service,path.endsWith('/a')?auth.a:auth.b,message);
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
      }
      res.writeHead(404);res.end();
    }catch{res.writeHead(500);res.end('Synthetic demo failure');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const demo=await startDemo();console.log('Synthetic local demo: '+demo.url);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await demo.close();process.exit(0);});
}
