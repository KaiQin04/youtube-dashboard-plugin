import {REPORT_FIELDS,reportById,reportKey} from './report-catalog.mjs';
import {normalizeSourceVideos,sourceVideoUrl} from './source-videos.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const known=Number.isFinite;
const n=value=>known(value)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:2}).format(value):'—';
const displayValue=(value,field)=>known(value)?value*(['ratio','rewatch'].includes(field.type)?100:1):null;
const LABELS={YT_SEARCH:'YouTube 搜尋',EXT_URL:'外部來源',RELATED_VIDEO:'推薦影片',SUBSCRIBER:'首頁與訂閱動態',NO_LINK_OTHER:'直接或未知來源',NO_LINK_EMBEDDED:'外部網站嵌入',YT_OTHER_PAGE:'其他 YouTube 頁面',YT_CHANNEL:'頻道頁面',PLAYLIST:'播放清單',MOBILE:'手機',DESKTOP:'電腦',TABLET:'平板',TV:'電視',GAME_CONSOLE:'遊戲主機',UNSPECIFIED:'未指定',SUBSCRIBED:'已訂閱',UNSUBSCRIBED:'未訂閱',VIDEO_ON_DEMAND:'一般影片',SHORTS:'Shorts',LIVE_STREAM:'直播',male:'男性',female:'女性',user_specified:'使用者指定'};
export function reportMarkup(widget,data){
 const definition=reportById(widget.report),metric=widget.metric??definition.metrics[0],field=REPORT_FIELDS[metric];
 const video=data.videos?.find(video=>video.id===widget.videoId),key=reportKey({reportId:widget.report,videoId:widget.videoId||undefined});
 const report=data.reports?.[key];
 const sourceVideos=new Map(normalizeSourceVideos(report?.sourceVideos,report?.rows??[]).map(video=>[video.id,video]));
 const labelMarkup=row=>{
  if(widget.report!=='relatedVideos')return escape(row.label);
  const url=sourceVideoUrl(row.x),source=sourceVideos.get(row.x);
  if(!url)return `<span>無法辨識的影片來源 · ${escape(row.label)}</span>`;
  const image=`<span class="source-thumbnail"><span>無縮圖</span>${source?.thumbnailUrl?`<img data-source-thumbnail src="${escape(source.thumbnailUrl)}" alt="" width="160" height="90" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:''}</span>`;
  const title=source?.title??'無法取得影片資訊';
  return `<a class="source-video-link" data-source-video="${escape(row.x)}" href="${url}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${image}<span class="source-video-copy"><span class="source-video-title">${escape(title)}</span><small>${source?'在 YouTube 開啟 ↗':escape(row.x)+' · 在 YouTube 開啟 ↗'}</small></span></a>`;
 };
 const action=`<button type="button" class="button button-outline report-update" data-report-widget="${escape(widget.id)}" ${definition.video&&!widget.videoId?'disabled':''}>${definition.video?'讀取／更新此影片報表':'更新此報表'}</button>`;
 const videoLabel=definition.video?`<p class="custom-note">${escape(video?.title??(widget.videoId?'影片 '+widget.videoId:'請在「自訂介面」選擇一支已同步影片。'))}</p>`:'';
 let body='';
 if(!report||report.status==='not_synced')body='<p class="custom-empty">尚未同步此報表；選擇更新後才會查詢 Google。</p>';
 else if(report.status==='unavailable')body='<p class="custom-empty">目前無法取得這份報表。'+escape(({UPSTREAM_FORBIDDEN:'Google 拒絕此報表查詢。',UNSUPPORTED_REPORT:'此查詢組合暫不受支援。',UPSTREAM_RATE_LIMITED:'Google 暫時限制查詢頻率。'})[report.code]??'請稍後重試。')+'</p>';
 else if(report.status==='empty')body='<p class="custom-empty">API 未提供這段期間的資料，可能未達資料門檻；不代表零。</p>';
 else{
  const axis=definition.dimensions[0],rows=(report.rows??[]).map(row=>({label:definition.dimensions.map(dimension=>LABELS[row[dimension]]??row[dimension]).join(' / '),value:displayValue(row[metric],field),x:row[axis]}));
  if(widget.chart==='line'){
   const maximum=Math.max(1,...rows.filter(row=>known(row.value)).map(row=>row.value)),minimum=0;
   const xValues=definition.daily?rows.map(row=>Date.parse(row.x)):rows.map(row=>Number(row.x));
   const start=definition.daily?Date.parse(report.startDate):axis==='elapsedVideoTimeRatio'?0:Math.min(...xValues),end=definition.daily?Date.parse(report.endDate):axis==='elapsedVideoTimeRatio'?1:Math.max(...xValues);
   const x=value=>54+(value-start)/Math.max(end-start,axis==='elapsedVideoTimeRatio'?1:.001)*530,y=value=>170-(value-minimum)/maximum*140;
   let points=[],marks='',last=null;
   const flush=()=>{if(points.length>1)marks+=`<polyline points="${points.join(' ')}" class="series"/>`;points=[];};
   rows.forEach((row,index)=>{const current=xValues[index];if(!known(row.value)||(definition.daily&&last!==null&&current-last>86400000))flush();last=current;if(!known(row.value))return;
    points.push(`${x(current)},${y(row.value)}`);marks+=`<circle class="dot" cx="${x(current)}" cy="${y(row.value)}" r="2.5"><title>${escape(row.label)} · ${n(row.value)} ${escape(field.unit)}</title></circle>`;
   });flush();
   const ticks=[0,.5,1].map(ratio=>`<line x1="54" x2="588" y1="${y(maximum*ratio)}" y2="${y(maximum*ratio)}" class="grid"/><text x="46" y="${y(maximum*ratio)+4}" text-anchor="end">${n(maximum*ratio)}</text>`).join('');
   const axisNote=axis==='elapsedVideoTimeRatio'?'影片進度 0–100%'+(known(video?.durationSeconds)?` · 長度 ${n(video.durationSeconds)} 秒`:''):definition.daily?'日期 · '+report.startDate+'–'+report.endDate:'直播時間位置（分鐘）';
   body=`<figure><svg class="custom-chart" viewBox="0 0 610 220" role="img" aria-label="${escape(field.label)}">${ticks}${marks}<text x="310" y="205" text-anchor="middle">${escape(axisNote)}</text></svg><figcaption>${escape(field.label)}（${escape(field.unit)}）${axis==='elapsedVideoTimeRatio'?' · 重看可能使觀看留存超過 100%。':''}</figcaption></figure>`;
  }else if(widget.chart==='table'){
   body=`<div class="custom-table-scroll"><table class="custom-table"><thead><tr><th scope="col">${definition.daily?'日期':widget.report==='relatedVideos'?'來源影片':'分類'}</th>${definition.metrics.map(id=>`<th scope="col">${escape(REPORT_FIELDS[id].label)}（${escape(REPORT_FIELDS[id].unit)}）</th>`).join('')}</tr></thead><tbody>${report.rows.map((row,index)=>`<tr><th scope="row">${labelMarkup(rows[index])}</th>${definition.metrics.map(id=>`<td>${n(displayValue(row[id],REPORT_FIELDS[id]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }else{
   const sorted=[...rows].sort((a,b)=>known(a.value)&&known(b.value)?b.value-a.value:known(a.value)?-1:1),maximum=Math.max(1,...rows.filter(row=>known(row.value)).map(row=>row.value));
   body=`<ol class="report-bars${widget.report==='relatedVideos'?' report-source-videos':''}">${sorted.slice(0,20).map(row=>`<li><span class="report-label">${labelMarkup(row)}</span><strong>${n(row.value)} <small>${escape(field.unit)}</small></strong><span class="report-bar-track" aria-hidden="true"><i style="width:${known(row.value)?row.value/maximum*100:0}%"></i></span></li>`).join('')}</ol>${sorted.length>20?'<p class="custom-note">顯示前 20 項；切換表格可查看全部已回傳分類。</p>':''}`;
  }
 }
 const notes=report&&report.status!=='not_synced'?`<p class="custom-note">查詢 ${escape(report.startDate)}–${escape(report.endDate)} · ${report.availableThrough?'最後回傳資料日 '+escape(report.availableThrough):'API 尚未提供確切截止日'}${report.observedAt?' · 讀取於 '+escape(new Date(report.observedAt).toLocaleString('zh-TW')):''}</p>`:'';
 const warning=(report?.refreshError?'<p class="custom-note report-warning">本次更新未完成，保留先前成功資料。</p>':'')+(report?.truncated?'<p class="custom-note report-warning">已達回傳上限；這是部分分類資料，不能當作完整清單或總計。</p>':'');
 const sourceNote=widget.report==='relatedVideos'&&report?.rows?.length?'<p class="custom-note">這些影片曾帶來推薦流量，可能來自其他頻道。'+(report.sourceMetadataStatus!=='available'?'部分影片資訊未提供；可能已刪除、設為私人或暫時查詢失敗。':'')+'</p>':'';
 return videoLabel+body+sourceNote+notes+warning+'<p class="custom-note">「—」不代表零。隱私門檻、資料延遲及未回傳分類可能影響涵蓋率；分類加總不取代頻道總計。</p>'+action;
}
