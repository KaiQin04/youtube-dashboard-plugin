import {validIcon,MAX_ICON_LENGTH} from './branding.mjs';
import {AppError} from '../errors.mjs';
export class LayoutError extends AppError { constructor(code, message) { super(code,message); } }
import { THEMES } from './themes.mjs';
import { METRICS, REPORTS, VIDEO_COLUMNS, VIDEO_SORTS } from './catalog.mjs';
import {REPORT_FIELDS,reportById} from './report-catalog.mjs';

const metricIds = METRICS.map(item => item.id), reportIds = REPORTS.map(item => item.id);
const legacyCards = ['views', 'watchHours', 'subscribersNet', 'averageViewDuration'];
const widths = ['quarter', 'half', 'full'];
const enumString = values => ({ type: 'string', enum: values });
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const array = (items, maxItems, minItems = 1) => ({ type: 'array', items, minItems, maxItems });
const displayName = { type: 'string', maxLength: 80 };
const baseWidget = { id: { type: 'string', minLength: 1, maxLength: 48 }, kind: enumString(['metric', 'trend', 'breakdown', 'report', 'videos', 'channel', 'freshness']), width: enumString(widths) };
const widgetSchema = object({ ...baseWidget, title: displayName, metric: enumString([...new Set([...metricIds,...Object.keys(REPORT_FIELDS)])]), chart: enumString(['line', 'bar', 'table']),videoId:{type:'string',maxLength:11},
  report: enumString(reportIds), columns: array(enumString(VIDEO_COLUMNS.map(item => item.id)), 5),
  sort: enumString(VIDEO_SORTS), limit: { type: 'integer', enum: [5, 10, 20] } }, ['id', 'kind', 'width']);
const legacySchema = object({ version: { type: 'integer', enum: [1] }, theme: enumString(['light', 'dark', 'auto']),
  density: enumString(['comfortable', 'compact']), columns: enumString(['auto', 'one', 'two']),
  cards: array(enumString(legacyCards), 4), showTrend: { type: 'boolean' }, showVideos: { type: 'boolean' } });
const builderSchema = object({ name: displayName, dashboardTitle: displayName, headerName: displayName, headerSubtitle: displayName, showHeaderSubtitle: {type:'boolean'}, headerIcon: {type:'string',maxLength:MAX_ICON_LENGTH}, version: { type: 'integer', enum: [2] }, theme: enumString(THEMES.map(item => item.id)),
  mode: enumString(['light', 'dark', 'auto']), density: enumString(['comfortable', 'compact']),
  columns: enumString(['auto', 'one', 'two']), typography: enumString(['serif', 'sans']), widgets: array(widgetSchema, 16) }, ['version','theme','mode','density','columns','typography','widgets']);
export const layoutSchema = { anyOf: [builderSchema, legacySchema] };

export function defaultLayout() {
  return { version: 2, theme: 'cold-porcelain', mode: 'light', density: 'comfortable', columns: 'auto', typography: 'serif', widgets: [
    ...legacyCards.map(metric => ({ id: metric, kind: 'metric', metric, width: 'quarter' })),
    { id: 'trend', kind: 'trend', metric: 'views', chart: 'line', width: 'full' },
    { id: 'videos', kind: 'videos', columns: ['views', 'watchHours', 'publishedAt'], sort: 'views', limit: 10, width: 'full' },
  ] };
}
function matches(schema, value) {
  if (schema.type === 'object') return value && !Array.isArray(value) && typeof value === 'object' &&
    schema.required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && matches(schema.properties[key], value[key]));
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every(item => matches(schema.items, item));
  if (schema.type === 'integer') return Number.isSafeInteger(value) && schema.enum.includes(value);
  if (schema.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? 128) && (!schema.enum || schema.enum.includes(value));
}
function invalid() { throw new LayoutError('INVALID_LAYOUT', 'Use supported display settings with one to sixteen valid widgets.'); }
/** v1 remains accepted, but every read/write returns the canonical v2 builder format. */
export function validateLayout(input) {
  if (input?.version === 1) {
    if (!matches(legacySchema, input) || new Set(input.cards).size !== input.cards.length) invalid();
    const layout = { ...defaultLayout(), mode: input.theme, density: input.density, columns: input.columns,
      widgets: input.cards.map(metric => ({ id: metric, kind: 'metric', metric, width: 'quarter' })) };
    if (input.showTrend) layout.widgets.push({ id: 'trend', kind: 'trend', metric: 'views', chart: 'bar', width: 'full' });
    if (input.showVideos) layout.widgets.push({ id: 'videos', kind: 'videos', columns: ['views'], sort: 'views', limit: 20, width: 'full' });
    return layout;
  }
  if (!matches(builderSchema, input) || new Set(input.widgets.map(item => item.id)).size !== input.widgets.length) invalid();
  if(input.headerIcon!==undefined&&!validIcon(input.headerIcon))invalid();
  for (const value of [input.headerName, input.headerSubtitle, input.name, input.dashboardTitle, ...input.widgets.map(widget => widget.title)]) {
    if (value !== undefined && (typeof value !== 'string' || value.length > 80 || /[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))) invalid();
  }
  for (const widget of input.widgets) {
    if (!/^[A-Za-z0-9_-]{1,48}$/.test(widget.id)) invalid();
    const extras = { metric: ['metric'], trend: ['metric', 'chart'], breakdown: ['report', 'chart'], report:['report','metric','chart',...(widget.videoId!==undefined?['videoId']:[])],videos: ['columns', 'sort', 'limit'], channel: [], freshness: [] }[widget.kind];
    const keys = ['id', 'kind', 'width', ...extras];
    if (Object.keys(widget).filter(key => key !== 'title').length !== keys.length || keys.some(key => !Object.hasOwn(widget, key))) invalid();
    if (widget.kind === 'trend' && (!METRICS.find(item => item.id === widget.metric)?.trend || !['line', 'bar'].includes(widget.chart))) invalid();
    if (widget.kind==='metric'&&!metricIds.includes(widget.metric))invalid();
    if (widget.kind==='report'){
     const report=reportById(widget.report);if(!report?.metrics.includes(widget.metric))invalid();
     if(widget.chart==='line'&&!report.daily&&!report.video)invalid();
     if(widget.videoId!==undefined&&(!report.video||(widget.videoId!==''&&!/^[A-Za-z0-9_-]{11}$/.test(widget.videoId))))invalid();
    }
    if (widget.kind === 'breakdown' && !['bar', 'table'].includes(widget.chart)) invalid();
    if (widget.kind === 'videos' && new Set(widget.columns).size !== widget.columns.length) invalid();
  }
  return structuredClone(input);
}
export function loadLayout(raw) { return raw ? validateLayout(JSON.parse(raw)) : defaultLayout(); }

export function layoutPresets() {
 const metric = key => ({id:key,kind:'metric',metric:key,width:'quarter'});
 const trend = key => ({id:key+'-trend',kind:'trend',metric:key,chart:'line',width:'full'});
 return [
  {id:'overview',label:'頻道總覽',layout:defaultLayout()},
  {id:'growth',label:'訂閱成長',layout:{...defaultLayout(),widgets:[metric('subscribersNet'),metric('subscribersGained'),metric('subscribersLost'),metric('views'),trend('subscribersNet')]}},
  {id:'content',label:'內容成效',layout:{...defaultLayout(),widgets:[metric('views'),metric('engagedViews'),metric('watchHours'),metric('averageViewDuration'),trend('views'),{id:'videos',kind:'videos',columns:['views','watchHours','subscribersNet'],sort:'views',limit:10,width:'full'}]}},
  {id:'minimal',label:'精簡數字',layout:{...defaultLayout(),density:'compact',widgets:defaultLayout().widgets.filter(w=>w.kind==='metric')}},
  {id:'audience',label:'流量與觀眾',layout:{...defaultLayout(),widgets:['trafficSources','countries','devices','contentTypes','subscriptionStatus','demographics'].map(id=>({id,kind:'report',report:id,metric:reportById(id).metrics[0],chart:'bar',width:'half'}))}},
  {id:'engagement',label:'互動與留存',layout:{...defaultLayout(),widgets:[{id:'engagement',kind:'report',report:'engagement',metric:'likes',chart:'line',width:'full'},{id:'sharing',kind:'report',report:'sharingServices',metric:'shares',chart:'bar',width:'half'},{id:'cards',kind:'report',report:'cards',metric:'cardClicks',chart:'line',width:'half'},{id:'retention',kind:'report',report:'retention',metric:'audienceWatchRatio',chart:'line',videoId:'',width:'full'}]}},
 ];
}
