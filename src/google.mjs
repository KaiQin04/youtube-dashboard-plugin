import { AppError } from './errors.mjs';
import { sha256 } from './crypto.mjs';
import { readJson } from './http-json.mjs';
import { isProviderBudgetError } from './provider-budget.mjs';

export const GOOGLE_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
]);
export const CHANNEL_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export { readJson };

function scopes(value) {
  const set = new Set(typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []);
  if (set.size !== GOOGLE_SCOPES.length || GOOGLE_SCOPES.some(scope => !set.has(scope))) throw new AppError('SCOPE_MISMATCH', 'Both requested YouTube read-only permissions are required.', 403);
  return GOOGLE_SCOPES.join(' ');
}

/** Fixed Google destinations only. Credentials and upstream errors never leave this adapter. */
export class GoogleClient {
  #config; #fetch;
  constructor(config, fetchImpl = globalThis.fetch) { this.#config = config; this.#fetch = fetchImpl; }
  authorizationUrl(state, verifier) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    for (const [key,value] of Object.entries({ client_id: this.#config.googleClientId, redirect_uri: this.#config.publicOrigin+'/oauth/google/callback', response_type: 'code', scope: GOOGLE_SCOPES.join(' '), state, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', code_challenge: sha256(verifier), code_challenge_method: 'S256' })) url.searchParams.set(key,value);
    return url.href;
  }
  async token(fields, previous = null) {
    let response;
    try {
      response = await this.#fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({ ...fields, client_id:this.#config.googleClientId, client_secret:this.#config.googleClientSecret }), redirect:'manual', signal:AbortSignal.timeout(15000) });
    } catch (error) { if (isProviderBudgetError(error)) throw error; throw new AppError('OAUTH_UPSTREAM_UNAVAILABLE', 'Google authorization is temporarily unavailable.', 502); }
    if (!response.ok || response.redirected) {
      let invalidGrant = false;
      try { invalidGrant = response.status === 400 && (await readJson(response,32768)).error === 'invalid_grant'; } catch {}
      await response.body?.cancel().catch(() => {});
      throw new AppError(invalidGrant ? 'REAUTH_REQUIRED' : 'OAUTH_UPSTREAM_UNAVAILABLE', invalidGrant ? 'Reconnect the Google account.' : 'Google authorization is temporarily unavailable.', invalidGrant ? 401 : 502);
    }
    const data = await readJson(response,65536);
    if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length>16384 || /[\r\n]/.test(data.access_token) || data.token_type?.toLowerCase()!=='bearer' || !Number.isFinite(data.expires_in) || data.expires_in<1 || data.expires_in>86400) throw new AppError('UPSTREAM_INVALID','Google returned invalid authorization.',502);
    const refreshToken = data.refresh_token ?? previous?.refreshToken;
    if (typeof refreshToken !== 'string' || !refreshToken || refreshToken.length>16384) throw new AppError('OFFLINE_ACCESS_REQUIRED','Reconnect to grant offline read-only access.',403);
    return { accessToken:data.access_token, refreshToken, expiresIn:data.expires_in, scope:scopes(data.scope ?? previous?.scope) };
  }
  async channels(accessToken) {
    const channels = []; const seen = new Set(); let pageToken;
    for (let page=0;page<10;page++) {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.search = new URLSearchParams({ part:'id,snippet',mine:'true',maxResults:'50',...(pageToken ? {pageToken} : {}) }).toString();
      let response;
      try { response = await this.#fetch(url,{method:'GET',headers:{Authorization:`Bearer ${accessToken}`},redirect:'manual',signal:AbortSignal.timeout(15000)}); }
      catch (error) { if (isProviderBudgetError(error)) throw error; throw new AppError('CHANNEL_CHECK_FAILED','Could not verify authorized channels.',502); }
      if (!response.ok || response.redirected) { await response.body?.cancel(); throw new AppError('CHANNEL_CHECK_FAILED','Could not verify authorized channels.',502); }
      const data = await readJson(response);
      if (!Array.isArray(data.items) || data.items.length>50) throw new AppError('UPSTREAM_INVALID','Invalid channel response.',502);
      for (const item of data.items) {
        if (!CHANNEL_PATTERN.test(item?.id ?? '') || typeof item.snippet?.title!=='string' || !item.snippet.title || item.snippet.title.length>500 || channels.some(channel=>channel.id===item.id)) throw new AppError('UPSTREAM_INVALID','Invalid channel response.',502);
        channels.push({id:item.id,title:item.snippet.title});
      }
      if (!data.nextPageToken) {
        if (!channels.length) throw new AppError('NO_CHANNEL','This Google authorization has no accessible YouTube channel.',403);
        return channels;
      }
      pageToken=data.nextPageToken;
      if (typeof pageToken!=='string' || pageToken.length>2048 || seen.has(pageToken)) throw new AppError('UPSTREAM_INVALID','Invalid channel pagination.',502);
      seen.add(pageToken);
    }
    throw new AppError('CHANNEL_LIMIT','Channel verification exceeded its bounded limit.',409);
  }
  async revoke(refreshToken) {
    try {
      const response=await this.#fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:refreshToken}),redirect:'manual',signal:AbortSignal.timeout(15000)});
      const ok=response.status===200&&!response.redirected;
      await response.body?.cancel();
      return ok;
    } catch { return false; }
  }
}
