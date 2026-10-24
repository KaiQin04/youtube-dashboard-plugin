import {connectPanelHost} from '../dashboard/panel-bridge.mjs';
import {analyticsDate,addDays} from '../analytics/contracts.mjs';
import {createCustomizer} from '../dashboard/editor.mjs';
import {defaultLayout} from '../dashboard/layout.mjs';
import {renderWidgets} from '../dashboard/widgets.mjs';
import {createReportActions} from '../dashboard/report-actions.mjs';
import {bindSourceVideoInteractions,sourceVideoUrl} from '../dashboard/source-videos.mjs';

const $=id=>document.getElementById(id);
let host=null,customizer=null,data=null,layout=defaultLayout(),busy=false;
const notice=text=>{$('panel-status').textContent=text;};
const reportActions=createReportActions({getData:()=>data,getLayout:()=>layout,getRange:()=>({startDate:data?.range?.requestedStart,endDate:data?.range?.requestedEnd}),render,notice,transport:(args,refresh)=>call(refresh?'refresh_analytics_report':'get_analytics_report',args)});
function render(){
 $('panel-heading').textContent=layout.dashboardTitle?.trim()||'頻道總覽';
 $('layout-name-label').textContent=layout.name?.trim()?'版面：'+layout.name.trim():'';
 $('layout-name-label').hidden=!layout.name?.trim();
 if(!data)return;
 const range=data.range??{};
 $('panel-period').textContent=`所選 ${range.requestedStart??'—'}–${range.requestedEnd??'—'} · API 可用至 ${data.status?.completeThrough??'—'} · 非即時資料`;
 $('view').innerHTML=renderWidgets(layout,data,{start:range.start,end:range.end},{authorized:data.status.connected,reconnectRequired:!data.status.connected});
}
async function call(name,args={}){
 const reply=await host.callTool(name,args);
 if(reply?.isError)throw new Error('面板操作未完成；保留目前顯示，請稍後重試。');
 return reply.structuredContent;
}
async function read(refresh=false){
 if(busy||!host)return;busy=true;$('panel-reload').disabled=true;$('panel-refresh').disabled=true;
 try{
  if(refresh){const endDate=addDays(analyticsDate(new Date()),-1);await call('refresh_youtube_data',{startDate:addDays(endDate,-27),endDate});}
  const next=await call('get_dashboard_view',{});
  if(next.status?.mode==='demo')throw new Error('面板不顯示示範資料。');
  data=next;render();await reportActions.readSelected();
  notice(data.status?.connected?(data.status?.hasData?'已授權 · 已顯示保存資料':'已授權 · 尚未同步'):'授權尚未連接或已失效；請到站重新連接。');
  if(data.status?.hasData){const latest=await call('get_dashboard_view',{readNativeSummary:true});data=latest;render();await reportActions.readSelected();}
 }catch{notice(data?'本次讀取未完成，保留先前資料。':'尚未取得資料，請先在站連接並同步頻道。');}
 finally{busy=false;$('panel-reload').disabled=false;$('panel-refresh').disabled=false;}
}
async function ready(bridge){
 host=bridge;
 customizer=createCustomizer({getData:()=>data,onChange:next=>{layout=next;render();},onNotice:notice,onSessionExpired:()=>{data=null;$('view').replaceChildren();notice('站登入已失效，請重新登入。');},transport:async body=>{
  const reply=await host.callTool(body===undefined?'get_dashboard_preferences':'update_dashboard_preferences',body??{});
  let value=reply.structuredContent;
  if(!value&&reply.content?.[0]?.text){try{value=JSON.parse(reply.content[0].text);}catch{}}
  const code=value?.error?.code;
  return new Response(JSON.stringify(value??{}),{status:reply.isError?(code==='LAYOUT_CONFLICT'?409:code==='FORBIDDEN'?403:400):200});
 }});
 await Promise.all([customizer.load(),read()]);
 await reportActions.readSelected();
}
$('panel-reload').addEventListener('click',async()=>{await Promise.all([customizer?.load(),read()]);});
$('panel-refresh').addEventListener('click',()=>read(true));
$('view').addEventListener('click',event=>{const button=event.target.closest('[data-report-widget]');if(button)reportActions.update(button.dataset.reportWidget);});
bindSourceVideoInteractions($('view'),{
 openVideo:id=>window.openai?.openExternal?window.openai.openExternal({href:sourceVideoUrl(id),redirectUrl:false}):host?.openVideo?host.openVideo(id):Promise.reject(new Error('Link unavailable.')),
 onError:()=>notice('主機無法開啟 YouTube 連結；可在網站開啟同一支來源影片。'),
});
if(window.openai?.callTool)ready({callTool:(name,args)=>window.openai.callTool(name,args)});
else connectPanelHost({window,onResult:()=>{},onReady:ready,onError:()=>notice('面板無法連接主機，請重新開啟 Plugin。')});
