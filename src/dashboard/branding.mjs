/** Shared display-only branding. Never accepts remote image URLs or markup. */
export const ICON_CHOICES = Object.freeze([
 {id:'default',label:'使用預設'}, {id:'chart',label:'分析圖表'},
 {id:'camera',label:'攝影機'}, {id:'play',label:'播放'},
 {id:'spark',label:'星芒'}, {id:'letter',label:'名稱首字'}, {id:'none',label:'不顯示圖標'},
]);
export const MAX_ICON_LENGTH = 16384;
const paths={chart:'M4 20V10h4v10M10 20V4h4v16M16 20v-8h4v8',camera:'M3 6h12v12H3zM15 10l6-4v12l-6-4',play:'M8 4l12 8-12 8z',spark:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z'};
/** A small PNG container with no text, animation or unrelated trailing payload. */
export function validIcon(value) {
 if(ICON_CHOICES.some(item=>item.id===value))return true;
 if(typeof value!=='string'||value.length>MAX_ICON_LENGTH||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
 try{
  const raw=atob(value.slice(22));if(raw.length<45||raw.slice(0,8)!=='\x89PNG\r\n\x1a\n')return false;
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer);
  let offset=8,header=false,pixels=false;
  while(offset+12<=bytes.length){
   const size=view.getUint32(offset),type=raw.slice(offset+4,offset+8);
   if(size>bytes.length-offset-12)return false;
   if(!header){
    if(type!=='IHDR'||size!==13)return false;
    const width=view.getUint32(offset+8),height=view.getUint32(offset+12);
    if(width<1||height<1||width>128||height>128)return false;
    header=true;
   }else if(type==='IHDR')return false;
   if(!['IHDR','IDAT','IEND','PLTE','tRNS','sRGB','gAMA','cHRM','pHYs'].includes(type))return false;
   if(type==='IDAT')pixels=true;
   offset+=size+12;
   if(type==='IEND')return size===0&&pixels&&offset===bytes.length;
  }
 }catch{}
 return false;
}
export function resolveBrand(layout={},defaults={name:'YouTube Dashboard',icon:'chart'}) {
 const name=typeof layout.headerName==='string'&&layout.headerName.trim()?layout.headerName.trim():defaults.name;
 const chosen=layout.headerIcon;
 return {name,icon:chosen&&chosen!=='default'&&validIcon(chosen)?chosen:defaults.icon};
}
export function resolveSubtitle(layout={},defaults={}) {
 if(layout.showHeaderSubtitle===false)return null;
 return layout.headerSubtitle?.trim()||defaults.subtitle||'YOUR CHANNEL, YOUR WORKSPACE';
}
export function applyBrand(document,layout,defaults) {
 const brand=resolveBrand(layout,defaults);
 for(const item of document.querySelectorAll('[data-brand-name]')){item.textContent=brand.name;item.title=brand.name;}
 for(const item of document.querySelectorAll('[data-brand-subtitle]')){const text=resolveSubtitle(layout,defaults);item.hidden=text===null;item.textContent=text??'';}
 for(const item of document.querySelectorAll('[data-brand-link]'))item.setAttribute('aria-label',brand.name+' 首頁');
 for(const target of document.querySelectorAll('[data-brand-icon]')){
  target.replaceChildren();target.hidden=brand.icon==='none';target.setAttribute('aria-hidden','true');
  if(brand.icon.startsWith('data:image/png;base64,')){
   const image=document.createElement('img');image.src=brand.icon;image.alt='';image.width=36;image.height=36;
   image.addEventListener('error',()=>{target.textContent=Array.from(brand.name)[0]??'Y';},{once:true});target.append(image);
  }else if(brand.icon!=='none'){
   if(brand.icon==='letter')target.textContent=Array.from(brand.name)[0]??'Y';
   else{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linejoin','round');path.setAttribute('d',paths[brand.icon]??paths.chart);svg.append(path);target.append(svg);}
  }
 }
 document.title=brand.name==='YouTube Dashboard'?brand.name:brand.name+' · YouTube Dashboard';
 return brand;
}
/** Browser-local resize removes metadata; only the resulting small PNG is saved. */
export async function prepareIcon(file) {
 if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>2*1024*1024)throw new Error('請選擇 2 MB 以內的 PNG、JPEG 或 WebP 圖片。');
 const bitmap=await createImageBitmap(file,{resizeWidth:96,resizeHeight:96,resizeQuality:'high'});
 try{
  for(const size of [96,64,48]){
   const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
   canvas.getContext('2d').drawImage(bitmap,0,0,size,size);
   const result=canvas.toDataURL('image/png');if(validIcon(result))return result;
  }
 }finally{bitmap.close();}
 throw new Error('圖片無法轉換成小型圖標，請改用較簡單的圖片。');
}
export function bindBrandEditor({document,getDraft,onChange,onError,onBusy=()=>{}}) {
 const name=document.getElementById('header-name'),select=document.getElementById('header-icon'),upload=document.getElementById('header-image');
 const subtitle=document.getElementById('header-subtitle'),showSubtitle=document.getElementById('show-header-subtitle');
 subtitle?.addEventListener('input',()=>{if(getDraft()){getDraft().headerSubtitle=subtitle.value;onChange();}});
 showSubtitle?.addEventListener('change',()=>{if(getDraft()){getDraft().showHeaderSubtitle=showSubtitle.checked;onChange();}});
 for(const choice of ICON_CHOICES){const option=document.createElement('option');option.value=choice.id;option.textContent=choice.label;select.append(option);}
 const custom=document.createElement('option');custom.value='custom';custom.textContent='自訂圖片';custom.hidden=true;select.append(custom);
 name.addEventListener('input',()=>{if(getDraft()){getDraft().headerName=name.value;onChange();}});
 select.addEventListener('change',()=>{if(getDraft()&&select.value!=='custom'){getDraft().headerIcon=select.value;onChange();}});
 let generation=0,pending=false;
 upload.addEventListener('change',async()=>{
  const draft=getDraft(),before=++generation,file=upload.files?.[0];if(!draft||!file)return;
  pending=true;onBusy(true);
  try{const image=await prepareIcon(file);if(before!==generation||getDraft()!==draft)return;draft.headerIcon=image;custom.hidden=false;select.value='custom';onChange();}
  catch{if(before===generation&&getDraft()===draft)onError('圖片無法使用；請選擇 2 MB 以內的 PNG、JPEG 或 WebP。');}
  finally{upload.value='';if(before===generation){pending=false;onBusy(false);}}
 });
 return {get pending(){return pending;},load(layout){generation++;pending=false;onBusy(false);name.value=layout.headerName??'';if(subtitle)subtitle.value=layout.headerSubtitle??'';if(showSubtitle)showSubtitle.checked=layout.showHeaderSubtitle!==false;const uploaded=layout.headerIcon?.startsWith('data:');custom.hidden=!uploaded;select.value=uploaded?'custom':layout.headerIcon??'default';upload.value='';}};
}
