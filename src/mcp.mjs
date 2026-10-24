import { panelHtml } from './panel-resource.mjs';
import { AppError, safeError } from './errors.mjs';
import { layoutSchema } from './layout.mjs';
import { requirePrincipal } from './auth/identity.mjs';
import { REPORTS as REPORT_DEFINITIONS } from './dashboard/report-catalog.mjs';

export const PANEL_URI='ui://youtube-dashboard/panel-v5.html';
const html=panelHtml();
const string={type:'string',minLength:1,maxLength:128};
function tool(name,title,description,properties,required,write=false,destructive=false){return {name,title,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:destructive,openWorldHint:false},securitySchemes:[{type:'oauth2',scopes:[write?'dashboard:manage':'dashboard:read']}]};}
export const TOOLS=[
 tool('list_youtube_connections','已連接的頻道','列出目前使用者的 YouTube 連線與授權／同步狀態。',{},[]),
 tool('get_analytics_report','已保存的分析報表','只讀取此連線的已保存報表，不查詢 Google。',{connectionId:string,reportId:{type:'string',enum:REPORT_DEFINITIONS.map(report=>report.id)},startDate:string,endDate:string,videoId:{type:'string',minLength:11,maxLength:11}},['connectionId','reportId','startDate','endDate']),
 tool('refresh_analytics_report','更新分析報表','更新此使用者已授權頻道的一份唯讀報表；影片報表須選擇已同步影片。',{connectionId:string,reportId:{type:'string',enum:REPORT_DEFINITIONS.map(report=>report.id)},startDate:string,endDate:string,videoId:{type:'string',minLength:11,maxLength:11}},['connectionId','reportId','startDate','endDate'],true),
 {...tool('get_youtube_dashboard','YouTube 儀表板','讀取所選連線的快照與可用日期，不觸發更新。',{connectionId:string},['connectionId']),_meta:{ui:{resourceUri:PANEL_URI},'openai/outputTemplate':PANEL_URI,'openai/widgetAccessible':true}},
 tool('update_dashboard_layout','儲存儀表板版面','只更新目前使用者與所選頻道的顯示偏好；不改動 Google 授權或資料。',{connectionId:string,layout:layoutSchema},['connectionId','layout'],true),
 tool('select_youtube_channel','選擇授權頻道','從該次 Google 授權已驗證的頻道清單中選擇一個頻道。',{connectionId:string,channelId:string},['connectionId','channelId'],true),
 tool('refresh_youtube_data','更新頻道資料','更新使用者自己的快照。預設最近 28 個完整太平洋日期，最多 31 天；有 15 分鐘冷卻與 500 支影片上限。',{connectionId:string,startDate:string,endDate:string},['connectionId'],true),
 tool('export_youtube_data','匯出分析資料','匯出已同步快照為 CSV 或 JSON；最多 31 天與 20 支影片，含資料範圍及缺漏資訊。',{connectionId:string,startDate:string,endDate:string,table:{enum:['channel_daily','video_daily','videos'],type:'string'},format:{enum:['csv','json'],type:'string'},videoIds:{type:'array',items:string,maxItems:20,minItems:1}},['connectionId','startDate','endDate','table','format']),
 tool('disconnect_youtube','移除頻道連線','刪除該連線保存的資料並嘗試撤銷 Google 授權。Google 撤銷可能影響同一應用程式的其他授權；須先取得使用者明確確認。',{connectionId:string,confirmed:{type:'boolean'}},['connectionId','confirmed'],true,true),
];

// Sites supplies its own authenticated transport; no independent OAuth issuer is advertised.
export const SITES_TOOLS = [
 ...TOOLS.map(original => { const definition={...original}; delete definition.securitySchemes; return definition; }),
 {name:'open_youtube_dashboard',title:'開啟儀表板與授權設定',description:'開啟此網站，使用 ChatGPT 登入後授權自己的 YouTube 頻道；所有 Google 憑證只在網站伺服器處理。',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},
];

function validate(schema,value){
 if(schema.anyOf){for(const candidate of schema.anyOf){try{validate(candidate,value);return;}catch{}}throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');}
 if(schema.type==='integer'){if(!Number.isSafeInteger(value)||schema.enum&&!schema.enum.includes(value))throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');return;}
 if(schema.type==='object'){if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).some(key=>!Object.hasOwn(schema.properties,key))||schema.required.some(key=>!Object.hasOwn(value,key)))throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');for(const key of Object.keys(value))validate(schema.properties[key],value[key]);}
 else if(schema.type==='string'){if(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??128)||(schema.enum&&!schema.enum.includes(value)))throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');}
 else if(schema.type==='array'){if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems)throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');for(const item of value)validate(schema.items,item);}
 else if(schema.type==='boolean'&&typeof value!=='boolean')throw new AppError('INVALID_ARGUMENTS','Invalid tool arguments.');
}

/** Stateless JSON responses over Streamable HTTP; the HTTP boundary owns authentication. */
export async function handleMcp(service,principal,message,options={}){
 if(!message||Array.isArray(message)||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw new AppError('INVALID_RPC','Invalid JSON-RPC request.');
 const {method,params={}}=message;
 if(!Object.hasOwn(message,'id')){if(method==='notifications/initialized')return null;throw new AppError('INVALID_RPC','Unknown notification.');}
 const reply=result=>({jsonrpc:'2.0',id:message.id,result});
 const metadata=result=>({...result,resultType:'complete',ttlMs:0,cacheScope:'private'});
 const tools=options.sites?SITES_TOOLS:TOOLS;
 if(method==='initialize')return reply({protocolVersion:['2026-07-28','2025-11-25','2025-06-18'].includes(params.protocolVersion)?params.protocolVersion:'2025-11-25',capabilities:{tools:{},resources:{}},serverInfo:{name:'youtube-dashboard',version:'0.3.1'}});
 if(method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{},resources:{}},serverInfo:{name:'youtube-dashboard',version:'0.3.1'}});
 if(method==='ping')return reply({});
 if(method==='tools/list')return reply(metadata({tools}));
 if(method==='resources/list')return reply(metadata({resources:[{uri:PANEL_URI,name:'youtube-dashboard',mimeType:'text/html;profile=mcp-app'}]}));
 if(method==='resources/templates/list')return reply(metadata({resourceTemplates:[]}));
 if(method==='resources/read'){
   if(![PANEL_URI,'ui://youtube-dashboard/panel-v4.html','ui://youtube-dashboard/panel-v3.html','ui://youtube-dashboard/panel-v2.html','ui://youtube-dashboard/panel-v1.html'].includes(params.uri))return {jsonrpc:'2.0',id:message.id,error:{code:-32602,message:'Unknown resource'}};
   return reply(metadata({contents:[{uri:params.uri,mimeType:'text/html;profile=mcp-app',text:html,_meta:{ui:{csp:{connectDomains:[],resourceDomains:['https://i.ytimg.com'],frameDomains:[]}},'openai/widgetCSP':{connect_domains:[],resource_domains:['https://i.ytimg.com']}}}]}));
 }
 if(method!=='tools/call')return {jsonrpc:'2.0',id:message.id,error:{code:-32601,message:'Method not found'}};
 try{
   if(options.sites)requirePrincipal(principal,'dashboard:read');
   const definition=tools.find(tool=>tool.name===params.name);if(!definition)throw new AppError('UNKNOWN_TOOL','Unknown tool.');
   const args=params.arguments??{};validate(definition.inputSchema,args);let result;
   if(options.sites&&params.name==='open_youtube_dashboard')result={url:options.publicOrigin+'/',configurationReady:options.readiness?.ready===true,requiresYouTubeAuthorization:true};
   else if(options.sites&&options.readiness?.ready!==true){
     if(params.name!=='list_youtube_connections')throw new AppError('CONFIGURATION','YouTube connection setup is not complete.',503);
     result={connections:[],configurationReady:false,readiness:options.readiness};
   }
   else if(params.name==='list_youtube_connections')result={connections:await service.listConnections(principal)};
   else if(params.name==='get_youtube_dashboard')result=await service.getDashboard(principal,args.connectionId);
   else if(params.name==='get_analytics_report'||params.name==='refresh_analytics_report'){const {connectionId,...request}=args;result=await service[params.name==='get_analytics_report'?'getReport':'refreshReport'](principal,connectionId,request);}
   else if(params.name==='update_dashboard_layout')result=await service.updateLayout(principal,args.connectionId,args.layout);
   else if(params.name==='select_youtube_channel')result=await service.selectChannel(principal,args.connectionId,args.channelId);
   else if(params.name==='refresh_youtube_data'){if(Boolean(args.startDate)!==Boolean(args.endDate))throw new AppError('INVALID_ARGUMENTS','Provide both dates or neither.');await service.refresh(principal,args.connectionId,args.startDate?{startDate:args.startDate,endDate:args.endDate}:undefined);result=await service.getDashboard(principal,args.connectionId);}
   else if(params.name==='export_youtube_data'){const {connectionId,...exportOptions}=args;result=await service.exportData(principal,connectionId,exportOptions);}
   else if(params.name==='disconnect_youtube'){if(args.confirmed!==true)throw new AppError('CONFIRMATION_REQUIRED','Confirm removal of this connection first.');result=await service.disconnect(principal,args.connectionId);}
   return reply({structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]});
 }catch(error){const result=safeError(error);return reply({isError:true,structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}]});}
}
