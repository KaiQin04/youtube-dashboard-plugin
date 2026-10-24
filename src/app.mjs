import { AppError, safeError } from './errors.mjs';
import { requirePrincipal } from './auth/identity.mjs';
import { handleMcp } from './mcp.mjs';

const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'"};
function json(value,status=200,extra={}){return Response.json(value,{status,headers:{...headers,...extra}});}
async function body(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError('INVALID_BODY','Use application/json.',415);
 const reader=request.body?.getReader();if(!reader)throw new AppError('INVALID_BODY','A JSON body is required.');let size=0;const chunks=[];
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw new Error();chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 catch{await reader.cancel().catch(()=>{});throw new AppError('INVALID_BODY','Invalid or oversized JSON body.');}finally{reader.releaseLock();}
}
const cookieName=state=>'__Host-ytd-oauth-'+state.slice(0,16);
function cookie(request,name){const values=(request.headers.get('cookie')??'').split(';').map(value=>value.trim()).filter(value=>value.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):null;}

/** An embeddable Fetch handler. A production reverse proxy must preserve HTTPS and suppress query/token logs. */
export function createApp({service,authenticate,publicOrigin,issuer}){
 return async request=>{
  try{
   const url=new URL(request.url);
   if(url.origin!==publicOrigin)throw new AppError('INVALID_HOST','Unknown service origin.',403);
   const origin=request.headers.get('origin');if(origin&&origin!==publicOrigin)throw new AppError('INVALID_ORIGIN','Cross-origin requests are not allowed.',403);
   if(request.method==='GET'&&url.pathname==='/.well-known/oauth-protected-resource')return json({resource:publicOrigin+'/mcp',authorization_servers:[issuer],scopes_supported:['dashboard:read','dashboard:manage']});
   if(request.method==='GET'&&url.pathname==='/connected')return new Response('Google authorization received. Return to the plugin to choose a verified channel.',{headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
   if(request.method==='GET'&&url.pathname==='/oauth/google/callback'){
    const state=url.searchParams.get('state');if(!/^[A-Za-z0-9_-]{43}$/.test(state??''))throw new AppError('INVALID_STATE','Invalid authorization state.');
    await service.completeGoogle({callbackUrl:url.href,browserNonce:cookie(request,cookieName(state))});
    return new Response(null,{status:303,headers:{...headers,Location:'/connected','Set-Cookie':cookieName(state)+'=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'}});
   }
   const principal=await authenticate(request);requirePrincipal(principal,'dashboard:read');
   if(request.method==='POST'&&url.pathname==='/oauth/google/start'){
    const start=await service.beginGoogle(principal);const state=new URL(start.authorizationUrl).searchParams.get('state');
    return json({connectionId:start.connectionId,authorizationUrl:start.authorizationUrl,expiresInSeconds:start.expiresInSeconds},200,{'Set-Cookie':cookieName(state)+'='+start.browserNonce+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});
   }
   if(url.pathname==='/mcp'){
    if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'Use POST for this stateless MCP endpoint.'}},405,{Allow:'POST'});
    const result=await handleMcp(service,principal,await body(request));return result===null?new Response(null,{status:202,headers}):json(result);
   }
   if(request.method==='GET'&&url.pathname==='/api/connections')return json({connections:await service.listConnections(principal)});
   const match=/^\/api\/connections\/([A-Za-z0-9_-]{43})(?:\/(data|channel|sync|disconnect))?$/.exec(url.pathname);
   if(match){
    const [,id,action]=match;
    if(request.method==='GET'&&!action)return json(await service.getConnection(principal,id));
    if(request.method==='GET'&&action==='data')return json(await service.getDashboard(principal,id));
    if(request.method==='POST'){
     const args=await body(request);
     if(!args||typeof args!=='object'||Array.isArray(args))throw new AppError('INVALID_ARGUMENTS','Expected an object.');
     if(action==='channel'){if(Object.keys(args).some(key=>key!=='channelId'))throw new AppError('INVALID_ARGUMENTS','Unexpected field.');return json(await service.selectChannel(principal,id,args.channelId));}
     if(action==='sync')return json(await service.refresh(principal,id,Object.keys(args).length?args:undefined));
     if(action==='disconnect'){if(args.confirmed!==true||Object.keys(args).some(key=>key!=='confirmed'))throw new AppError('CONFIRMATION_REQUIRED','Confirm removal first.');return json(await service.disconnect(principal,id));}
    }
   }
   return json({error:{code:'NOT_FOUND',message:'Route not found.'}},404);
  }catch(error){return json(safeError(error),error instanceof AppError?error.status:500,error instanceof AppError&&error.status===401?{'WWW-Authenticate':`Bearer resource_metadata="${publicOrigin}/.well-known/oauth-protected-resource"`}:{});}
 };
}
