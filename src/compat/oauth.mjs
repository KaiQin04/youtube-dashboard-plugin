import {AppError,requireOwner,validatedCallback,GOOGLE_SCOPES,validateGrantedScopes,randomString,sha256,encryptToken,decryptToken} from './security.mjs';
const TOKEN_URL='https://oauth2.googleapis.com/token';
/** Google authorization is separate from Sites sign-in. Only server code calls this service. */
export class OAuthService {
 constructor({config,store,fetchImpl=globalThis.fetch.bind(globalThis),now=()=>Date.now()}) {Object.assign(this,{config,store,fetch:fetchImpl,now});}
 context() {return `${this.config.grantContextPrefix ?? 'channel-v1'}:${this.config.allowedAppUserId}:${this.config.channelId}`;}
 assertConfig(identity) {requireOwner(identity,this.config);validatedCallback(this.config);if(!this.config.clientId||!this.config.clientSecret||!this.config.tokenEncryptionKey||!this.store)throw new AppError('OAUTH_NOT_CONFIGURED','Google OAuth credentials and encrypted storage must be configured securely.',503);}
 async begin({identity,browserNonce}) {
  this.assertConfig(identity);if(typeof browserNonce!=='string'||browserNonce.length<32||browserNonce.length>256)throw new AppError('INVALID_BROWSER_SESSION','A secure browser session is required.');
  const state=randomString(),verifier=randomString(48),redirectUri=validatedCallback(this.config);
  await this.store.putState({stateHash:await sha256(state),ownerId:identity.subject,channelId:this.config.channelId,browserHash:await sha256(browserNonce),expiresAt:this.now()+600000,encryptedPayload:await encryptToken({verifier,redirectUri},this.config.tokenEncryptionKey,this.context())});
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for(const [k,v] of Object.entries({client_id:this.config.clientId,redirect_uri:redirectUri,response_type:'code',scope:GOOGLE_SCOPES.join(' '),state,access_type:'offline',prompt:'consent',include_granted_scopes:'false',code_challenge:await sha256(verifier),code_challenge_method:'S256'}))url.searchParams.set(k,v);
  return {authorizationUrl:url.href,expiresInSeconds:600};
 }
 async requestToken(fields) {
  // Workers supports manual redirects; reject non-2xx without forwarding secrets.
  let response;
  try {response=await this.fetch(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams({...fields,client_id:this.config.clientId,client_secret:this.config.clientSecret}),redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw new AppError('OAUTH_UPSTREAM_UNAVAILABLE','Google authorization service is unavailable.',502);}
  if(!response.ok||response.redirected){
   // Only a rejected refresh grant establishes that stored authorization expired.
   // Provider descriptions are never included in client errors or logs.
   if(!response.redirected&&[400,401].includes(response.status)){
    let failure;try{failure=await response.json();}catch{}
    if(failure?.error==='invalid_grant'&&fields.grant_type==='refresh_token')throw new AppError('REAUTH_REQUIRED','Google rejected the saved authorization. Reconnect the channel owner account.',503);
    if(failure?.error==='invalid_client')throw new AppError('OAUTH_CONFIGURATION_ERROR','Google rejected the application configuration. Contact the site administrator.',503);
   }
   throw new AppError('OAUTH_UPSTREAM_UNAVAILABLE','Google authorization service is unavailable. Try again later.',502);
  }
  let data;try{data=await response.json();}catch{throw new AppError('INVALID_TOKEN_RESPONSE','Google returned an invalid authorization response.',502);}
  if(typeof data.access_token!=='string'||!data.access_token||data.access_token.length>16384||String(data.token_type).toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<1||data.expires_in>86400)throw new AppError('INVALID_TOKEN_RESPONSE','Google returned an invalid authorization response.',502);
  return data;
 }
 async verifyChannel(accessToken) {
  let pageToken;
  for(let i=0;i<10;i++){
   const url=new URL('https://www.googleapis.com/youtube/v3/channels');for(const [k,v]of Object.entries({part:'id,snippet',mine:'true',maxResults:'50',...(pageToken?{pageToken}:{})}))url.searchParams.set(k,v);
   let response;try{response=await this.fetch(url,{method:'GET',headers:{Authorization:`Bearer ${accessToken}`,Accept:'application/json'},redirect:'manual',signal:AbortSignal.timeout(15000)});}catch{throw new AppError('CHANNEL_CHECK_FAILED','Could not verify the authorized YouTube channel.',502);}
   if(!response.ok||response.redirected)throw new AppError('CHANNEL_CHECK_FAILED','Could not verify the authorized YouTube channel.',502);
   let data;try{data=await response.json();}catch{throw new AppError('CHANNEL_CHECK_FAILED','Invalid channel verification response.',502);}
   const match=data.items?.find(x=>x.id===this.config.channelId);if(match)return {id:match.id,title:typeof match.snippet?.title==='string'?match.snippet.title:match.id};
   if(!data.nextPageToken)break;if(typeof data.nextPageToken!=='string'||data.nextPageToken.length>512)break;pageToken=data.nextPageToken;
  }
  throw new AppError('CHANNEL_MISMATCH','This Google authorization does not include the configured channel. Studio manager access is not assumed sufficient.',403);
 }
 async complete({identity,browserNonce,callbackUrl}) {
  this.assertConfig(identity);
  let url;try{url=new URL(callbackUrl);}catch{throw new AppError('INVALID_CALLBACK','Invalid OAuth callback.');}
  if(url.origin+url.pathname!==validatedCallback(this.config)||url.hash||url.username||url.password||url.searchParams.getAll('state').length!==1)throw new AppError('INVALID_CALLBACK','Invalid OAuth callback.');
  const state=url.searchParams.get('state');if(!/^[A-Za-z0-9_-]{43}$/.test(state??''))throw new AppError('INVALID_STATE','OAuth state is invalid.');
  // A single atomic DELETE RETURNING prevents callback replay across isolates.
  const pending=await this.store.consumeState(await sha256(state));
  if(!pending||pending.expires_at<=this.now()||pending.owner_id!==identity.subject||pending.channel_id!==this.config.channelId||typeof browserNonce!=='string'||pending.browser_hash!==await sha256(browserNonce))throw new AppError('INVALID_STATE','OAuth state expired, was replayed, or belongs to another browser.');
  if(url.searchParams.get('error')||url.searchParams.getAll('code').length!==1||!url.searchParams.get('code')||url.searchParams.get('code').length>8192)throw new AppError('AUTHORIZATION_NOT_COMPLETED','Google authorization was not completed.');
  const payload=await decryptToken(pending.encrypted_payload,this.config.tokenEncryptionKey,this.context());
  if(payload.redirectUri!==validatedCallback(this.config))throw new AppError('INVALID_CALLBACK','Stored callback does not match configuration.');
  const token=await this.requestToken({grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:payload.verifier,redirect_uri:payload.redirectUri});
  const scope=validateGrantedScopes(token.scope);
  if(typeof token.refresh_token!=='string'||!token.refresh_token||token.refresh_token.length>16384)throw new AppError('OFFLINE_ACCESS_REQUIRED','Google did not grant offline read-only access. Reconnect securely.',403);
  const channel=await this.verifyChannel(token.access_token);
  const grant={accessToken:token.access_token,refreshToken:token.refresh_token,expiresAt:this.now()+token.expires_in*1000,scope};
  await this.store.saveGrant(identity.subject,this.config.channelId,await encryptToken(grant,this.config.tokenEncryptionKey,this.context()));
  return {connected:true,channel,scopes:GOOGLE_SCOPES};
 }
 async getAccessToken(channelId,{forceRefresh=false}={}) {
  this.assertConfig({verified:true,subject:this.config.allowedAppUserId});
  if(channelId!==this.config.channelId)throw new AppError('CHANNEL_MISMATCH','Token cannot be used for another channel.',403);
  const encrypted=await this.store.readGrant(this.config.allowedAppUserId,channelId);if(!encrypted)throw new AppError('OAUTH_NOT_CONNECTED','Connect the channel owner Google account first.',503);
  const grant=await decryptToken(encrypted,this.config.tokenEncryptionKey,this.context());validateGrantedScopes(grant.scope);
  if(!forceRefresh&&grant.expiresAt>this.now()+60000)return grant.accessToken;
  if(typeof grant.refreshToken!=='string'||!grant.refreshToken)throw new AppError('REAUTH_REQUIRED','Reconnect the channel owner Google account.',503);
  const token=await this.requestToken({grant_type:'refresh_token',refresh_token:grant.refreshToken});
  const scope=validateGrantedScopes(token.scope??grant.scope);
  // Recheck the fixed channel before persisting a refreshed authorization.
  await this.verifyChannel(token.access_token);
  const refreshToken=token.refresh_token??grant.refreshToken;
  if(typeof refreshToken!=='string'||!refreshToken||refreshToken.length>16384)throw new AppError('INVALID_TOKEN_RESPONSE','Invalid refreshed authorization.',502);
  await this.store.saveGrant(this.config.allowedAppUserId,channelId,await encryptToken({accessToken:token.access_token,refreshToken,expiresAt:this.now()+token.expires_in*1000,scope},this.config.tokenEncryptionKey,this.context()));
  return token.access_token;
 }
}
