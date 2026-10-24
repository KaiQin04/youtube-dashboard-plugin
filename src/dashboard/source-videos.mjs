/** Canonical public-video links and bounded metadata shared by storage and UI. */
export const validSourceVideoId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id);
export const sourceVideoUrl=id=>validSourceVideoId(id)?'https://www.youtube.com/watch?v='+id:null;
export function safeSourceThumbnail(value,id){
 if(!validSourceVideoId(id)||typeof value!=='string')return null;
 const prefix='https://i.ytimg.com/';
 return value.startsWith(prefix)&&new RegExp('^https://i\\.ytimg\\.com/vi(?:_webp)?/'+id+'/(?:default|mqdefault|hqdefault|sddefault|maxresdefault)\\.(?:jpg|webp)$').test(value)?value:null;
}
export function normalizeSourceVideos(items,rows){
 const ids=new Set(rows.map(row=>row.insightTrafficSourceDetail).filter(validSourceVideoId)),seen=new Set();
 return (Array.isArray(items)?items:[]).slice(0,25).flatMap(item=>{
  if(!item||!ids.has(item.id)||seen.has(item.id)||typeof item.title!=='string'||!item.title.trim()||item.title.length>500||/[\u0000-\u001f\u007f]/u.test(item.title))return [];
  seen.add(item.id);return [{id:item.id,title:item.title.trim(),thumbnailUrl:safeSourceThumbnail(item.thumbnailUrl,item.id)}];
 });
}
/** Website follows ordinary anchors; embedded panels delegate links to their host. */
export function bindSourceVideoInteractions(root,{openVideo,onError=()=>{}}={}){
 root.addEventListener('error',event=>{
  if(event.target?.matches?.('img[data-source-thumbnail]'))event.target.hidden=true;
 },true);
 if(openVideo)root.addEventListener('click',event=>{
  const link=event.target.closest('[data-source-video]');
  if(!link)return;
  event.preventDefault();
  const id=link.dataset.sourceVideo;if(!validSourceVideoId(id)){onError();return;}
  Promise.resolve().then(()=>openVideo(id)).catch(onError);
 });
}
