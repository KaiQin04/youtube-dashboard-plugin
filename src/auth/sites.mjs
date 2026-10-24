import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../errors.mjs';
import { createSitesPrincipal, requirePrincipal } from './identity.mjs';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const SITES_SIGN_IN = '/signin-with-chatgpt?return_to=%2F';
export const SITES_SIGN_OUT = '/signout-with-chatgpt?return_to=%2F';

/** Stateless user-bound CSRF and OAuth cookies; Sites owns authentication sessions. */
export class SitesAuth {
  #origin;
  #key;

  constructor(config) {
    this.#origin = config.publicOrigin;
    this.#key = TOKEN.test(config.encryptionKey ?? '') ? Buffer.from(config.encryptionKey, 'base64url') : null;
  }

  principal(verifiedIdentity) {
    if (!verifiedIdentity?.userId) throw new AppError('LOGIN_REQUIRED', 'Sign in with ChatGPT before accessing your dashboard.', 401);
    return createSitesPrincipal(verifiedIdentity.userId, this.#origin);
  }

  csrf(principal) {
    const userId = requirePrincipal(principal, 'dashboard:read');
    if (!this.#key) return null;
    return createHmac('sha256', this.#key).update(JSON.stringify(['youtube-dashboard-sites-csrf-v1', this.#origin, userId])).digest('base64url');
  }

  requireCsrf(request, principal) {
    const expected = this.csrf(principal), supplied = request.headers.get('x-csrf-token');
    if (!expected) throw new AppError('CONFIGURATION', 'YouTube connection setup is not complete.', 503);
    if (request.headers.get('origin') !== this.#origin || request.headers.get('sec-fetch-site') === 'cross-site' || !TOKEN.test(supplied ?? '') || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new AppError('CSRF_REJECTED', 'Reload the page before continuing.', 403);
  }

  oauthCookie(state, nonce, maxAge = 600) {
    if (!TOKEN.test(state) || maxAge !== 0 && !TOKEN.test(nonce ?? '')) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
    return `__Host-ytd-sites-oauth-${state}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  }

  callbackNonce(request, state) {
    if (!TOKEN.test(state ?? '')) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
    const raw = request.headers.get('cookie') ?? '', name = '__Host-ytd-sites-oauth-' + state + '=';
    if (raw.length > 32768) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
    const values = raw.split(';').map(value => value.trim()).filter(value => value.startsWith(name));
    const value = values.length === 1 ? values[0].slice(name.length) : '';
    if (!TOKEN.test(value)) throw new AppError('INVALID_STATE', 'Invalid or expired authorization state.');
    return value;
  }
}
