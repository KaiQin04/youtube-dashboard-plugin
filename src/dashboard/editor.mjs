import {applyBrand,bindBrandEditor} from './branding.mjs';
import {getBrandDefaults} from './brand-default.mjs';
import {THEMES} from './themes.mjs';
import {METRICS,VIDEO_COLUMNS,VIDEO_SORTS} from './catalog.mjs';
import {defaultLayout,validateLayout,layoutPresets} from './layout.mjs';
import {widgetTitle} from './widgets.mjs';
import {REPORTS,REPORT_FIELDS,REPORT_LIMITATIONS,reportById} from './report-catalog.mjs';

/** Preference editor owns only display state; Google requests stay in the dashboard. */
export function createCustomizer({onChange,onNotice,onSessionExpired,transport,getData=()=>({}),brandDefaults=getBrandDefaults(document)}) {
 const $=id=>document.getElementById(id),media=matchMedia('(prefers-color-scheme: dark)');
 const dialog=$('layout-dialog'),presets=layoutPresets();
 let saved=defaultLayout(),draft=null,revision=0,ready=false,saving=false,sequence=0,generation=0;
 const node=(tag,text,cls)=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(cls)item.className=cls;return item;};
 const message=(text,error=false)=>{$('layout-message').textContent=text;$('layout-message').dataset.error=String(error);};
 const mode=layout=>layout.mode==='auto'?(media.matches?'dark':'light'):layout.mode;
 function apply(layout,notify=true){
  applyBrand(document,layout,brandDefaults);
  const actualMode=mode(layout),theme=THEMES.find(item=>item.id===layout.theme)??THEMES[0],colors=theme[actualMode],root=document.documentElement;
  root.dataset.theme=actualMode;root.dataset.skin=theme.id;root.style.colorScheme=actualMode;
  const aliases={porcelain:'porcelain',surface:'surface',sunken:'surface-sunken',ink:'ink',muted:'ink-muted',line:'line','line-strong':'line-strong',jilan:'jilan','jilan-soft':'jilan-soft','on-jilan':'on-jilan',alert:'alert'};
  for(const[key,value]of Object.entries(colors))root.style.setProperty('--'+key,value);
  for(const[key,source]of Object.entries(aliases))root.style.setProperty('--cp-'+key,colors[source]);
  root.style.setProperty('--heading-font',layout.typography==='sans'?'var(--font-sans)':'var(--font-serif)');
  document.body.dataset.density=layout.density;
  if(notify)onChange(layout);
 }
 function preview(){apply(draft);$('layout-preview-notice').hidden=false;message('正在預覽，變更尚未儲存。');}
 function close(){if(saving)return;draft=null;brandEditor.load(saved);dialog.close();$('layout-preview-notice').hidden=true;apply(saved);$('customize-button').focus();}
 function themeGallery(){
  $('theme-grid').replaceChildren();
  for(const theme of THEMES){
   const button=node('button',undefined,'theme-choice');button.type='button';button.setAttribute('aria-label',theme.label);button.setAttribute('aria-pressed',String(draft.theme===theme.id));
   const swatch=node('span',undefined,'theme-swatch'),colors=theme[mode(draft)];swatch.style.background=colors.porcelain;swatch.setAttribute('aria-hidden','true');
   for(const key of ['jilan','data-2','data-3']){const chip=node('i');chip.style.background=colors[key];swatch.append(chip);}
   button.append(swatch,node('span',theme.label));button.addEventListener('click',()=>{draft.theme=theme.id;themeGallery();preview();$('theme-grid').querySelector('[aria-pressed=true]')?.focus();});$('theme-grid').append(button);
  }
 }
 function field(label,control){const wrap=node('div',undefined,'custom-field'),id='layout-option-'+(++sequence),title=node('label',label);control.id=id;title.htmlFor=id;wrap.append(title,control);return wrap;}
 function textField(label,value,placeholder,change){const input=node('input');input.type='text';input.maxLength=80;input.value=value??'';input.placeholder=placeholder;input.addEventListener('input',()=>change(input.value));return field(label,input);}
 function selectField(label,items,value,change){const select=node('select');for(const item of items){const option=node('option',item.label);option.value=item.id;select.append(option);}select.value=String(value);select.addEventListener('change',()=>change(select.value));return field(label,select);}
 function changed(){ $('layout-preset').value='custom';preview(); }
 function widgetList(focusIndex){
  $('widget-list').replaceChildren();$('widget-count').textContent=`${draft.widgets.length} / 16 個區塊`;$('add-widget-button').disabled=draft.widgets.length>=16;
  draft.widgets.forEach((widget,index)=>{
   const item=node('li',undefined,'widget-editor'),head=node('div',undefined,'widget-editor-heading'),title=node('strong',widgetTitle(widget)),actions=node('div',undefined,'widget-actions');
   head.append(node('span',String(index+1).padStart(2,'0'),'widget-index'),title);
   for(const[label,delta]of [['上移',-1],['下移',1],['移除',0]]){
    const button=node('button',label,'button button-outline');button.type='button';button.setAttribute('aria-label',`${label}區塊 ${index+1} ${widgetTitle(widget)}`);button.disabled=delta?index+delta<0||index+delta>=draft.widgets.length:draft.widgets.length===1;
    button.addEventListener('click',()=>{if(delta)[draft.widgets[index],draft.widgets[index+delta]]=[draft.widgets[index+delta],draft.widgets[index]];else draft.widgets.splice(index,1);widgetList(Math.max(0,index+delta));changed();});actions.append(button);
   }
   head.append(actions);const details=node('details'),options=node('div',undefined,'widget-options');details.append(node('summary','設定名稱、資料與大小'),options);
   options.append(textField('區塊名稱',widget.title,'留白使用指標名稱',value=>{widget.title=value;title.textContent=widgetTitle(widget);changed();}));
   options.append(selectField('區塊寬度',[{id:'quarter',label:'小 · 四分之一'},{id:'half',label:'中 · 半寬'},{id:'full',label:'大 · 滿寬'}],widget.width,value=>{widget.width=value;changed();}));
   if(['metric','trend'].includes(widget.kind))options.append(selectField('資料指標',METRICS.filter(m=>widget.kind==='metric'||m.trend),widget.metric,value=>{widget.metric=value;title.textContent=widgetTitle(widget);changed();}));
   if(widget.kind==='trend')options.append(selectField('圖表樣式',[{id:'line',label:'折線圖'},{id:'bar',label:'長條圖'}],widget.chart,value=>{widget.chart=value;changed();}));
   if(widget.kind==='report'){
    const report=reportById(widget.report);
    options.append(selectField('資料報表',REPORTS,widget.report,value=>{widget.report=value;const next=reportById(value);widget.metric=next.metrics[0];widget.chart=next.video||next.daily?'line':'bar';delete widget.videoId;if(next.video)widget.videoId='';widgetList(index);changed();}));
    options.append(selectField('圖表指標',report.metrics.map(id=>REPORT_FIELDS[id]),widget.metric,value=>{widget.metric=value;changed();}));
    options.append(selectField('呈現方式',[...(report.daily||report.video?[{id:'line',label:'折線圖'}]:[]),{id:'bar',label:'長條圖'},{id:'table',label:'全部指標表格'}],widget.chart,value=>{widget.chart=value;changed();}));
    if(report.video){
     const videos=getData()?.videos??[];
     options.append(selectField('指定影片',[{id:'',label:'選擇已同步的影片'},...videos.map(video=>({id:video.id,label:video.title||video.id}))],widget.videoId??'',value=>{widget.videoId=value;changed();}));
     options.append(node('p','儲存版面後，按區塊的「讀取／更新此影片報表」。不會自動逐支查詢。','custom-note'));
    }
   }
   if(widget.kind==='videos'){
    options.append(selectField('排序依據',VIDEO_SORTS.map(id=>VIDEO_COLUMNS.find(c=>c.id===id)),widget.sort,value=>{widget.sort=value;changed();}));
    options.append(selectField('顯示筆數',[5,10,20].map(id=>({id:String(id),label:id+' 支'})),widget.limit,value=>{widget.limit=Number(value);changed();}));
    const columns=node('fieldset',undefined,'column-options');columns.append(node('legend','影片欄位（最多 5 個）'));
    for(const column of VIDEO_COLUMNS){const label=node('label'),input=node('input');input.type='checkbox';input.checked=widget.columns.includes(column.id);input.setAttribute('aria-label','影片欄位 '+column.label);input.addEventListener('change',()=>{
     if((input.checked&&widget.columns.length>=5)||(!input.checked&&widget.columns.length===1)){input.checked=!input.checked;message('影片表格需保留 1 至 5 個資料欄位。',true);return;}
     widget.columns=input.checked?[...widget.columns,column.id]:widget.columns.filter(id=>id!==column.id);changed();
    });label.append(input,document.createTextNode(column.label));columns.append(label);}options.append(columns);
   }
   item.append(head,details);$('widget-list').append(item);
  });
  if(focusIndex!==undefined)$('widget-list').children[Math.min(focusIndex,draft.widgets.length-1)]?.querySelector('summary')?.focus();
 }
 const brandEditor=bindBrandEditor({document,getDraft:()=>draft,onChange:preview,onError:text=>message(text,true),onBusy:value=>{$('save-layout').disabled=value;}});
 function loadDraft(layout){draft=structuredClone(layout);brandEditor.load(draft);$('dashboard-title').value=draft.dashboardTitle??'';$('layout-name-input').value=draft.name??'';for(const key of ['mode','density','columns','typography'])$('layout-'+key).value=draft[key];themeGallery();widgetList();preview();}
 function switchTab(tab){for(const name of ['appearance','widgets','sources']){$('editor-'+name).hidden=name!==tab;$('tab-'+name).setAttribute('aria-pressed',String(name===tab));}}
 function addOptions(){
  for(const[label,items]of [['指標數字',METRICS.map(m=>({id:'metric:'+m.id,label:m.label}))],['每日趨勢',METRICS.filter(m=>m.trend).map(m=>({id:'trend:'+m.id,label:m.label}))],['YouTube 分析報表',REPORTS.map(report=>({id:'report:'+report.id,label:report.label}))],['表格與資訊',[{id:'videos',label:'影片成效'},{id:'channel',label:'頻道資訊'},{id:'freshness',label:'資料新鮮度'}]]]){
   const group=node('optgroup');group.label=label;for(const item of items){const option=node('option',item.label);option.value=item.id;group.append(option);}$('add-widget').append(group);
  }
  for(const item of [{id:'custom',label:'保留目前組合'},...presets]){const option=node('option',item.label);option.value=item.id;$('layout-preset').append(option);}
  for(const metric of METRICS)$('layout-data-catalog').append(node('li',metric.label+'：'+metric.note));
  for(const report of REPORTS)$('layout-data-catalog').append(node('li',report.label+'：'+report.metrics.map(id=>REPORT_FIELDS[id].label).join('、')+(report.video?'。選定單支影片後載入。':'。更新最近 28 天時同步。')));
  for(const item of REPORT_LIMITATIONS)$('report-limitations')?.append(node('li',item.label+'：'+item.note));
 }
 function invalidate(){generation++;ready=false;draft=null;saved=defaultLayout();revision=0;dialog.close();$('layout-form').reset();$('widget-list').replaceChildren();$('layout-preview-notice').hidden=true;apply(saved);}
 async function request(body){
  const response=await transport(body);
  if([401,403].includes(response.status)){invalidate();onSessionExpired();throw new Error('工作台登入已失效，請重新登入網站。');}
  const value=await response.json();
  if(!response.ok)throw new Error(value.error?.code==='LAYOUT_CONFLICT'?'其他分頁已儲存新設定。請取消並重新整理後再編輯。':value.error?.code==='INVALID_LAYOUT'?'名稱不可含 HTML 或控制字元，且不得超過 80 字。':'設定暫時無法儲存，請稍後重試。');
  return {layout:validateLayout(value.layout),revision:value.revision};
 }
 async function load(){const before=generation;try{const value=await request();if(before!==generation)return;saved=value.layout;revision=value.revision;ready=true;apply(saved);}catch{if(before===generation)onNotice('外觀設定暫時無法讀取，先顯示預設介面；資料載入不受影響。');}}
 $('customize-button').addEventListener('click',async()=>{if(!ready)await load();if(!ready)return;loadDraft(saved);switchTab('appearance');dialog.showModal();});
 for(const[id,key]of [['dashboard-title','dashboardTitle'],['layout-name-input','name']])$(id).addEventListener('input',()=>{draft[key]=$(id).value;preview();});
 for(const key of ['mode','density','columns','typography'])$('layout-'+key).addEventListener('change',()=>{draft[key]=$('layout-'+key).value;if(key==='mode')themeGallery();preview();});
 for(const tab of ['appearance','widgets','sources'])$('tab-'+tab).addEventListener('click',()=>switchTab(tab));
 $('add-widget-button').addEventListener('click',()=>{if(draft.widgets.length>=16)return;const[kind,metric]=$('add-widget').value.split(':');const widget={id:'w'+Date.now().toString(36)+(++sequence),kind,width:kind==='metric'?'quarter':'half'};
  if(kind==='metric')Object.assign(widget,{metric});if(kind==='trend')Object.assign(widget,{metric,chart:'line',width:'full'});if(kind==='videos')Object.assign(widget,{columns:['views','watchHours','publishedAt'],sort:'views',limit:10,width:'full'});
  if(kind==='report'){const report=reportById(metric);Object.assign(widget,{report:metric,metric:report.metrics[0],chart:report.video||report.daily?'line':'bar',width:report.video||report.daily?'full':'half',...(report.video?{videoId:''}:{})});}
  draft.widgets.push(widget);widgetList(draft.widgets.length-1);changed();
 });
 $('layout-preset').addEventListener('change',()=>{const preset=presets.find(p=>p.id===$('layout-preset').value);if(!preset)return;loadDraft({...draft,widgets:structuredClone(preset.layout.widgets)});});
 $('reset-layout').addEventListener('click',()=>loadDraft(defaultLayout()));
 $('cancel-layout').addEventListener('click',close);$('close-layout').addEventListener('click',close);dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('layout-form').addEventListener('submit',async event=>{
  event.preventDefault();if(saving||brandEditor.pending||!draft)return;
  let validated;try{validated=validateLayout(draft);}catch{message('請檢查名稱與區塊設定。名稱不可含 HTML 或控制字元，最多 80 字。',true);return;}
  const before=generation;saving=true;$('layout-fields').disabled=true;for(const id of ['save-layout','cancel-layout','close-layout','reset-layout'])$(id).disabled=true;message('正在儲存…');
  try{const value=await request({layout:validated,revision});if(before!==generation)return;saved=value.layout;revision=value.revision;saving=false;close();onNotice('介面已儲存 · 僅套用這個頻道');}catch(error){message(error.message,true);}finally{saving=false;$('layout-fields').disabled=false;for(const id of ['save-layout','cancel-layout','close-layout','reset-layout'])$(id).disabled=false;}
 });
 media.addEventListener('change',()=>{apply(draft??saved);if(draft)themeGallery();});
 apply(saved,false);
 addOptions();
 return {load,invalidate};
}
