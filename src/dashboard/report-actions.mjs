import {reportById,reportKey} from './report-catalog.mjs';
/** Shared controller for website HTTP and host-mediated Plugin tools. */
export function createReportActions({getData,getLayout,getRange,transport,render,notice}) {
 const busy=new Set();
 async function update(widgetId){
  const widget=getLayout().widgets.find(widget=>widget.id===widgetId),data=getData();
  if(!widget||widget.kind!=='report'||!data)return;
  const definition=reportById(widget.report),range=getRange();
  if(definition.video&&!widget.videoId){notice('請在自訂介面選擇已同步影片。');return;}
  const args={reportId:widget.report,startDate:range.startDate,endDate:range.endDate,...(definition.video?{videoId:widget.videoId}:{})},key=reportKey(args);
  if(busy.has(key))return;busy.add(key);notice('正在讀取 '+definition.label+'…');
  try{
   const result=await transport(args,true);
   if(getData()!==data)return;
   data.reports??={};data.reports[key]=result;render();
   notice(result.refreshError?'本次更新未完成，保留先前成功資料。':result.status==='unavailable'?'這份報表暫時無法取得，其他資料不受影響。':result.status==='empty'?'API 尚未提供這份報表的資料。':'報表已更新 · '+definition.label);
  }catch{notice('報表更新未完成，保留目前資料。');}finally{busy.delete(key);}
 }
 async function readSelected(){
  const data=getData();if(!data)return;const range=getRange(),seen=new Set();
  for(const widget of getLayout().widgets){
   if(widget.kind!=='report'||!widget.videoId)continue;
   const args={reportId:widget.report,videoId:widget.videoId,startDate:range.startDate,endDate:range.endDate},key=reportKey(args);
   if(seen.has(key))continue;seen.add(key);
   try{const result=await transport(args,false);if(getData()!==data)return;data.reports??={};data.reports[key]=result;}catch{}
  }
  if(getData()===data)render();
 }
 return {update,readSelected};
}
