/** Workers-native security primitives. No Node APIs, key generation or credential logging. */
import { AppError } from '../errors.mjs';
export { AppError };
export const GOOGLE_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]);
export function requireOwner(identity, config) {
  if (!config?.allowedAppUserId || !/^UC[A-Za-z0-9_-]{22}$/.test(config?.channelId ?? '')) throw new AppError('NOT_CONFIGURED','Owner and channel binding are not configured.',503);
  if (!identity?.verified || identity.subject!==config.allowedAppUserId) throw new AppError('FORBIDDEN','Only the configured owner may use this operation.',403);
  return config.channelId;
}
export function validatedCallback(config) {
  let origin, callback;
  try { origin=new URL(config.publicOrigin); callback=new URL(config.redirectUri); } catch { throw new AppError('INVALID_CALLBACK','An exact HTTPS callback must be configured.',503); }
  if (origin.protocol!=='https:' || origin.pathname!=='/' || origin.search || origin.hash || origin.username || origin.password || callback.origin!==origin.origin || callback.pathname!=='/oauth/google/callback' || callback.search || callback.hash || callback.username || callback.password) throw new AppError('INVALID_CALLBACK','Callback must use the configured HTTPS origin and /oauth/google/callback.',503);
  return callback.href;
}
export function safeError(error) { return {error:{code:error instanceof AppError?error.code:'INTERNAL_ERROR',message:error instanceof AppError?error.message:'The request could not be completed safely.'}}; }
export function randomString(bytes=32) { const v=new Uint8Array(bytes); crypto.getRandomValues(v); return base64url(v); }
export function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,''); }
function decode(value) { if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error('Invalid encoding');return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0)); }
export async function sha256(value) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))); }
async function key(value) { try { const bytes=decode(value); if(bytes.length!==32)throw new Error();return await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']); }catch{throw new AppError('TOKEN_KEY_NOT_CONFIGURED','A server-only 256-bit encryption key is required.',503);} }
export async function encryptToken(value, secret, context) {
  if(typeof context!=='string'||!context)throw new AppError('TOKEN_CONTEXT','Token binding context is required.',503);
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},await key(secret),new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({v:1,iv:base64url(iv),data:base64url(new Uint8Array(ciphertext))});
}
export async function decryptToken(value, secret, context) {
  const k=await key(secret);
  try { const e=JSON.parse(value);if(e.v!==1)throw new Error();const iv=decode(e.iv);if(iv.length!==12)throw new Error();const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},k,decode(e.data));return JSON.parse(new TextDecoder().decode(plain)); }
  catch{throw new AppError('TOKEN_DECRYPTION_FAILED','Stored authorization could not be verified. Reconnect securely.',503);}
}
export function validateGrantedScopes(scope) {
  if(typeof scope!=='string')throw new AppError('INVALID_SCOPE','Google did not confirm the requested read-only scopes.',403);
  const values=new Set(scope.split(/\s+/).filter(Boolean));
  if(values.size!==GOOGLE_SCOPES.length||GOOGLE_SCOPES.some(x=>!values.has(x)))throw new AppError('INVALID_SCOPE','Authorization must contain exactly the two read-only YouTube scopes.',403);
  return [...values].sort().join(' ');
}
