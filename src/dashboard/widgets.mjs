import {METRICS,VIDEO_COLUMNS} from './catalog.mjs';
import {reportById} from './report-catalog.mjs';
import {reportMarkup} from './report-widgets.mjs';

export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const finite=Number.isFinite;
const number=(value,digits=0)=>finite(value)?new Intl.NumberFormat('zh-TW',{maximumFractionDigits:digits}).format(value):'—';
const time=value=>finite(value)?`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`:'—';
const metricSpec=id=>METRICS.find(item=>item.id===id);
export function widgetTitle(widget){return widget.title?.trim()||(['report','breakdown'].includes(widget.kind)?reportById(widget.report).label:widget.kind==='metric'?metricSpec(widget.metric).label:widget.kind==='trend'?metricSpec(widget.metric).label+' · 每日趨勢':{videos:'影片成效',channel:'頻道資訊',freshness:'資料新鮮度'}[widget.kind]);}
function valueFor(row,id){if(id==='watchHours')return finite(row.watchMinutes)?row.watchMinutes/60:null;if(id==='averageViewDuration')return row.averageViewDurationSeconds??null;return row[id]??null;}
const period=range=>`${range.start??'—'}–${range.end??'—'}${range.clamped?' · 部分期間':''}`;
const details=entries=>'<dl class="custom-details">'+entries.map(([label,value])=>`<dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd>`).join('')+'</dl>';

function metricMarkup(widget,data,range){
 const spec=metricSpec(widget.metric);
 const hasData=data.status?.hasData||data.status?.mode==='real'||data.status?.mode==='demo';
 const value=widget.metric==='videoCount'?(hasData?data.videos.length:null):valueFor(data.summary??{},widget.metric);
 const formatted=widget.metric==='averageViewDuration'?time(value):widget.metric==='subscribersNet'&&value>0?'+'+number(value):number(value,spec.decimals);
 return `<div class="custom-value">${formatted}<span>${widget.metric==='averageViewDuration'?'分:秒':escapeHTML(spec.unit)}</span></div><p class="custom-note">${escapeHTML(spec.label)}${widget.metric==='averageViewDuration'?' · API 原生':''} · ${escapeHTML(widget.metric==='videoCount'?'目前已同步清單':period(range))}</p><p class="custom-note">${finite(value)?escapeHTML(spec.note):'尚無可用資料，不代表零。'}</p>`;
}

function trendMarkup(widget,data,range){
 const spec=metricSpec(widget.metric),days=(data.daily??[]).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date));
 const byDate=new Map(days.map(row=>[row.date,row]));
 const first=range.start??days[0]?.date,last=range.end??days.at(-1)?.date,rows=[];
 for(let at=Date.parse(first),end=Date.parse(last);Number.isFinite(at)&&at<=end&&rows.length<366;at+=86400000){const date=new Date(at).toISOString().slice(0,10);rows.push({date,value:valueFor(byDate.get(date)??{},widget.metric)});}
 const known=rows.filter(row=>finite(row.value));
 if(!known.length)return '<p class="custom-empty">這段期間尚無可繪製的每日資料。</p>';
 const minimum=Math.min(0,...known.map(row=>row.value)),maximum=Math.max(1,...known.map(row=>row.value));
 const y=value=>172-(value-minimum)/(maximum-minimum)*144,x=index=>56+(index+.5)*528/rows.length;
 const grid=[0,.5,1].map(ratio=>{const value=minimum+(maximum-minimum)*ratio,at=y(value);return `<line x1="56" x2="590" y1="${at}" y2="${at}" class="grid"/><text x="48" y="${at+4}" text-anchor="end">${number(value,spec.decimals)}</text>`;}).join('');
 let marks='',points=[];
 const flush=()=>{if(points.length>1)marks+=`<polyline points="${points.join(' ')}" class="series"/>`;points=[];};
 rows.forEach((row,index)=>{
  if(!finite(row.value)){flush();return;}
  const tooltip=`<title>${escapeHTML(row.date)} · ${number(row.value,spec.decimals)} ${escapeHTML(spec.unit)}</title>`;
  if(widget.chart==='bar'){const width=Math.max(1,Math.min(36,528/rows.length-3));marks+=`<rect x="${x(index)-width/2}" y="${Math.min(y(row.value),y(0))}" width="${width}" height="${Math.abs(y(row.value)-y(0))}" class="bar">${tooltip}</rect>`;}
  else{points.push(`${x(index)},${y(row.value)}`);marks+=`<circle cx="${x(index)}" cy="${y(row.value)}" r="2.5" class="dot">${tooltip}</circle>`;}
 });flush();
 const labels=[...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])].map(i=>`<text x="${x(i)}" y="203" text-anchor="middle">${rows[i].date.slice(5)}</text>`).join('');
 const caption=`${spec.label}（${spec.unit}） · ${period(range)} · ${known.length} 天有值；缺漏不連線、不補零。`;
 return `<figure><svg class="custom-chart" viewBox="0 0 610 220" role="img" aria-label="${escapeHTML(caption)}">${grid}<line x1="56" x2="590" y1="${y(0)}" y2="${y(0)}" class="axis"/>${marks}${labels}</svg><figcaption>${escapeHTML(caption)}</figcaption></figure>`;
}

function videosMarkup(widget,data,range){
 const rows=[...(data.videos??[])].sort((a,b)=>{
  if(widget.sort==='publishedAt')return String(b.publishedAt??'').localeCompare(String(a.publishedAt??''));
  const left=valueFor(a,widget.sort),right=valueFor(b,widget.sort);
  if(!finite(left)||!finite(right))return finite(left)?-1:finite(right)?1:0;
  return right-left;
 }).slice(0,widget.limit);
 const header=widget.columns.map(id=>`<th scope="col">${escapeHTML(VIDEO_COLUMNS.find(column=>column.id===id).label)}</th>`).join('');
 const body=rows.map(row=>`<tr><th scope="row">${escapeHTML(row.title||'未命名影片')}</th>${widget.columns.map(id=>`<td>${id==='publishedAt'?escapeHTML(row.publishedAt?.slice(0,10)??'—'):id==='durationSeconds'?number(row.durationSeconds):number(valueFor(row,id),id==='watchHours'?1:0)}</td>`).join('')}</tr>`).join('');
 return `<div class="custom-table-scroll"><table class="custom-table"><thead><tr><th scope="col">影片</th>${header}</tr></thead><tbody>${body||`<tr><td colspan="${widget.columns.length+1}">尚無影片資料。</td></tr>`}</tbody></table></div><p class="custom-note">${escapeHTML(period(range))} · 顯示 ${rows.length} / ${data.videos?.length??0} 支。影片訂閱採觀看頁歸因，不能加總成頻道訂閱數。</p>`;
}

/** Render display-only widgets over existing verified data. Never initiates API access. */
export function renderWidgets(layout,data,range,{authorized=null,reconnectRequired=false}={}){
 return `<div class="custom-dashboard" data-columns="${escapeHTML(layout.columns)}">${layout.widgets.map(widget=>{
  const body=['report','breakdown'].includes(widget.kind)?reportMarkup(widget,data):widget.kind==='metric'?metricMarkup(widget,data,range):widget.kind==='trend'?trendMarkup(widget,data,range):widget.kind==='videos'?videosMarkup(widget,data,range):widget.kind==='channel'?details([['頻道',data.status?.channel?.title??'YouTube Dashboard'],['頻道 ID',data.status?.boundChannelId??data.status?.channel?.id??'—'],['Google 授權',reconnectRequired?'需要重新連接':authorized===null?'正在確認':authorized?'已授權（已保存）':'尚未授權']]):details([['API 資料截至',data.status?.completeThrough??'—'],['最後同步時間',data.status?.lastSyncedAt?new Date(data.status.lastSyncedAt).toLocaleString('zh-TW'):'尚未同步'],['分析時區','America/Los_Angeles'],['資料限制','非即時資料；可能延遲或修訂']]);
  return `<section class="custom-widget" data-width="${escapeHTML(widget.width)}" data-widget="${escapeHTML(widget.id)}" aria-label="${escapeHTML(widgetTitle(widget))}"><h2>${escapeHTML(widgetTitle(widget))}</h2>${body}</section>`;
 }).join('')}</div>`;
}
