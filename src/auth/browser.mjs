import { applicationOrigin } from '../origin.mjs';
import { AppError } from '../errors.mjs';
import { randomString, sha256 } from '../crypto.mjs';
import { readJson } from '../google.mjs';
import { createGoogleIdentityVerifier } from './identity.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export function readCookie(request, name) {
  const raw = request.headers.get('cookie') ?? '';
  if (raw.length > 32768) return null;
  const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  return values.length === 1 ? values[0].slice(name.length + 1) : null;
}

/** Bounded single-process sessions. Restart logs browsers out without losing tenant-owned data. */
export class BrowserAuth {
  #config; #local; #prefix; #fetch; #verify; #now; #states = new Map(); #sessions = new Map(); #grants = new Map();
  constructor({ config, fetchImpl = globalThis.fetch, loginJwks, now = () => Date.now() }) {
    if (!config.googleLoginClientId || !config.googleLoginClientSecret) throw new AppError('LOGIN_CONFIGURATION', 'Configure independent Google login credentials on the server.', 503);
    const {url, local} = applicationOrigin(config); this.#local = local; this.#prefix = local ? `ytd-local-${url.port}-` : '__Host-ytd-';
    this.#config = config; this.#fetch = fetchImpl; this.#now = now;
    this.#verify = createGoogleIdentityVerifier({ clientId: config.googleLoginClientId, jwks: loginJwks, now });
  }
  get sessionName() { return this.#prefix + 'session'; }
  loginName(state) { return this.#prefix + 'login-' + state.slice(0, 16); }
  cookie(name, value, seconds) { return `${name}=${value}; Path=/; HttpOnly;${this.#local ? '' : ' Secure;'} SameSite=Lax; Max-Age=${seconds}`; }
  #prune() {
    for (const [key, value] of this.#states) if (value.expires <= this.#now()) this.#states.delete(key);
    for (const [key, value] of this.#sessions) if (value.expires <= this.#now() || value.idle <= this.#now()) { value.active = false; this.#sessions.delete(key); }
    for (const [key, value] of this.#grants) if (value.expires <= this.#now() || !value.session.active) this.#grants.delete(key);
  }
  session(request, required = true) {
    this.#prune();
    const token = readCookie(request, this.sessionName), key = TOKEN.test(token ?? '') ? sha256(token) : '';
    const entry = this.#sessions.get(key);
    if (!entry && required) throw new AppError('LOGIN_REQUIRED', 'Sign in before accessing your dashboard.', 401);
    if (entry) entry.idle = this.#now() + 1800000;
    return entry;
  }
  requireCsrf(request, session) {
    if (request.headers.get('origin') !== this.#config.publicOrigin || request.headers.get('x-csrf-token') !== session.csrf) throw new AppError('CSRF_REJECTED', 'Reload the page before continuing.', 403);
  }
  begin(request) {
    this.#prune();
    if (this.#states.size >= 1000) throw new AppError('LOGIN_BUSY', 'Try signing in again later.', 429);
    const state = randomString(), browserNonce = randomString(), nonce = randomString(), verifier = randomString(48);
    this.#states.set(sha256(state), { browserHash: sha256(browserNonce), nonce, verifier, expires: this.#now() + 600000, previous: this.session(request, false) });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({ client_id: this.#config.googleLoginClientId, redirect_uri: this.#config.publicOrigin + '/auth/google/callback',
      response_type: 'code', scope: 'openid', prompt: 'select_account', include_granted_scopes: 'false', state, nonce, code_challenge: sha256(verifier), code_challenge_method: 'S256' }).toString();
    return { location: url.href, cookie: this.cookie(this.loginName(state), browserNonce, 600) };
  }
  async complete(request) {
    this.#prune(); const url = new URL(request.url), state = url.searchParams.get('state');
    if (url.origin + url.pathname !== this.#config.publicOrigin + '/auth/google/callback' || url.hash || url.searchParams.getAll('state').length !== 1 || !TOKEN.test(state ?? '')) throw new AppError('INVALID_STATE', 'Login expired. Start again.');
    const record = this.#states.get(sha256(state)), browserNonce = readCookie(request, this.loginName(state));
    if (!record || !TOKEN.test(browserNonce ?? '') || sha256(browserNonce) !== record.browserHash || (record.previous && this.session(request, false) !== record.previous)) throw new AppError('INVALID_STATE', 'Login expired. Start again.');
    this.#states.delete(sha256(state));
    if (url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1 || !url.searchParams.get('code') || url.searchParams.get('code').length > 8192) throw new AppError('LOGIN_CANCELLED', 'Google login was not completed.');
    let response;
    try { response = await this.#fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, redirect: 'manual', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ grant_type: 'authorization_code', code: url.searchParams.get('code'), code_verifier: record.verifier,
        redirect_uri: this.#config.publicOrigin + '/auth/google/callback', client_id: this.#config.googleLoginClientId, client_secret: this.#config.googleLoginClientSecret }) }); }
    catch { throw new AppError('LOGIN_UNAVAILABLE', 'Google login is temporarily unavailable.', 502); }
    if (!response.ok || response.redirected) { await response.body?.cancel(); throw new AppError('LOGIN_UNAVAILABLE', 'Google login is temporarily unavailable.', 502); }
    const data = await readJson(response, 65536), principal = await this.#verify(data.id_token, record.nonce);
    if (record.expires <= this.#now() || record.previous && !record.previous.active) throw new AppError('INVALID_STATE', 'Login expired. Start again.');
    this.#prune();
    if (this.#sessions.size >= 1000) throw new AppError('LOGIN_BUSY', 'Try signing in again later.', 429);
    this.logout(request);
    const token = randomString(), key = sha256(token);
    this.#sessions.set(key, { key, principal, csrf: randomString(), active: true, expires: this.#now() + 28800000, idle: this.#now() + 1800000 });
    return { cookies: [this.cookie(this.sessionName, token, 28800), this.cookie(this.loginName(state), '', 0)] };
  }
  logout(request) {
    const session = this.session(request, false);
    if (session) { session.active = false; this.#sessions.delete(session.key); }
    return this.cookie(this.sessionName, '', 0);
  }
  bindGoogle(session, start) {
    this.#prune();
    if (!session.active || this.#grants.size >= 1000) throw new AppError('LOGIN_REQUIRED', 'Sign in again before connecting YouTube.', 401);
    const state = new URL(start.authorizationUrl).searchParams.get('state');
    this.#grants.set(sha256(state), { session, browserNonce: start.browserNonce, expires: this.#now() + 600000 });
  }
  consumeGoogle(request, session) {
    this.#prune(); const url = new URL(request.url), state = url.searchParams.get('state');
    if (url.searchParams.getAll('state').length !== 1 || !TOKEN.test(state ?? '')) throw new AppError('INVALID_STATE', 'Authorization expired. Start again.');
    const grant = this.#grants.get(sha256(state));
    if (!grant || grant.session !== session) throw new AppError('INVALID_STATE', 'Authorization belongs to a different browser session.');
    this.#grants.delete(sha256(state));
    return grant;
  }
}
