import {AppError} from './security.mjs';
import {assertDate,dateSequence} from './contracts.mjs';
import {REPORT_FIELDS,reportById} from '../dashboard/report-catalog.mjs';

const fail=()=>new AppError('INVALID_REPORT_DATA','The analytics report contains invalid data.',502);
/** Validate the entire bounded request before any token or upstream access. */
export function validateReportRequest(input) {
 const allowed=['channelId','reportId','startDate','endDate','videoId'];
 if(!input||Object.keys(input).some(key=>!allowed.includes(key)))throw new AppError('INVALID_REPORT','Unknown report argument.');
 const definition=reportById(input.reportId);
 if(!definition||!/^UC[A-Za-z0-9_-]{22}$/.test(input.channelId??''))throw new AppError('INVALID_REPORT','Unknown report or unbound channel.');
 assertDate(input.startDate);assertDate(input.endDate);
 const days=dateSequence(input.startDate,input.endDate);
 if(!days.length||days.length>31)throw new AppError('INVALID_RANGE','Reports require one to thirty-one days.');
 if(definition.video?!/^[A-Za-z0-9_-]{11}$/.test(input.videoId??''):input.videoId!==undefined)throw new AppError('INVALID_REPORT','This report requires its declared channel or single-video scope.');
 return definition;
}
function metricValue(value,id) {
 if(value===null)return null;
 const type=REPORT_FIELDS[id].type;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||(type==='count'&&!Number.isSafeInteger(value))||(type==='ratio'&&value>1)||(type==='percentage'&&value>100))throw fail();
 return value;
}
/** Normalize only declared fields; never persist provider error bodies or unknown metadata. */
export function normalizeReport(response,args,{now=()=>new Date()}={}) {
 const definition=validateReportRequest(args),limit=definition.daily?31:definition.limit??500;
 const fields=[...definition.dimensions,...definition.metrics],columns=response?.columnHeaders?.map(column=>column?.name);
 if(!Array.isArray(columns)||columns.some(column=>typeof column!=='string')||new Set(columns).size!==columns.length||fields.some(field=>!columns.includes(field)))throw fail();
 const raw=response.rows??[],seen=new Set();
 if(!Array.isArray(raw)||raw.length>limit+1)throw fail();
 const rows=raw.map(row=>{
  if(!Array.isArray(row)||row.length!==columns.length)throw fail();
  const item={};
  for(const field of definition.dimensions){
   const value=row[columns.indexOf(field)];
   if(field==='elapsedVideoTimeRatio') {if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>1)throw fail();}
   else if(field==='livestreamPosition') {if(!Number.isSafeInteger(value)||value<0)throw fail();}
   else if(typeof value!=='string'||!value.length||value.length>2048||/[\u0000-\u001f\u007f]/u.test(value))throw fail();
   if(field==='day'){assertDate(value);if(value<args.startDate||value>args.endDate)throw fail();}
   item[field]=value;
  }
  const key=JSON.stringify(definition.dimensions.map(field=>item[field]));if(seen.has(key))throw fail();seen.add(key);
  for(const metric of definition.metrics)item[metric]=metricValue(row[columns.indexOf(metric)],metric);
  return item;
 }).slice(0,limit);
 const axis=definition.dimensions[0];
 if(definition.daily)rows.sort((a,b)=>a.day.localeCompare(b.day));
 if(definition.video)rows.sort((a,b)=>a[axis]-b[axis]);
 return {...args,videoId:args.videoId??null,status:!rows.length?'empty':definition.daily&&rows.length<dateSequence(args.startDate,args.endDate).length?'partial':'available',
  rows,truncated:raw.length>limit||(Boolean(definition.limit)&&raw.length===limit),rowLimit:limit,availableThrough:definition.daily?rows.at(-1)?.day??null:null,
  observedAt:now().toISOString(),source:'YouTube Analytics API v2',timezone:'America/Los_Angeles'};
}
export async function readReport(get,args,options={}) {
 const definition=validateReportRequest(args),limit=definition.daily?31:definition.limit??500;
 const filter=definition.video?'video=='+args.videoId:definition.filter;
 const params={ids:'channel=='+args.channelId,startDate:args.startDate,endDate:args.endDate,dimensions:definition.dimensions.join(','),metrics:definition.metrics.join(','),maxResults:definition.limit??(definition.daily?31:limit+1),
  ...(definition.daily?{sort:'day'}:definition.metrics.includes('views')?{sort:'-views'}:{}),...(filter?{filters:filter}:{})};
 return normalizeReport(await get(params),args,options);
}
