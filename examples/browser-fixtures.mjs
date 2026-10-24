import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { randomString, sha256 } from '../src/crypto.mjs';
import { dashboardDemoFixture } from './dashboard-demo-data.mjs';
import { CHANNEL_A, CHANNEL_B, NOW } from './synthetic-fixtures.mjs';

/** Synthetic Google boundary; it never opens a network connection. */
export async function browserFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(publicKey), kid: 'browser-fixture' }] };
  const youtube = dashboardDemoFixture(), codes = new Map();
  const control = { now: NOW, claims: {}, failLogin: false, loginExchanges: 0 };
  function authorize(input, { account = 'a', cancel = false } = {}) {
    const url = new URL(input), params = url.searchParams;
    if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Unexpected synthetic authorization endpoint');
    const callback = new URL(params.get('redirect_uri'));
    callback.searchParams.set('state', params.get('state'));
    if (cancel) callback.searchParams.set('error', 'access_denied');
    else {
      const code = randomString();
      codes.set(code, { account, nonce: params.get('nonce'), challenge: params.get('code_challenge'), clientId: params.get('client_id'), redirect: params.get('redirect_uri'), login: params.get('scope') === 'openid' });
      callback.searchParams.set('code', code);
    }
    return callback.href;
  }
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    if (url.origin === 'https://oauth2.googleapis.com' && url.pathname === '/token' && options.body?.get('grant_type') === 'authorization_code') {
      const record = codes.get(options.body.get('code'));
      codes.delete(options.body.get('code'));
      if (!record || record.clientId !== options.body.get('client_id') || record.redirect !== options.body.get('redirect_uri') || sha256(options.body.get('code_verifier') ?? '') !== record.challenge) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      if (record.login) {
        control.loginExchanges++;
        if (control.failLogin) return new Response('synthetic-provider-private-diagnostic', { status: 503 });
        const claims = { iss: 'https://accounts.google.com', sub: 'synthetic-user-' + record.account, aud: record.clientId, nonce: record.nonce, iat: Math.floor(control.now / 1000), exp: Math.floor(control.now / 1000) + 3600, ...control.claims };
        return Response.json({ id_token: await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'browser-fixture' }).sign(privateKey), token_type: 'Bearer', access_token: randomString(), expires_in: 3600 });
      }
      youtube.control.channels = [record.account === 'a' ? CHANNEL_A : CHANNEL_B];
    }
    return youtube.fetch(input, options);
  };
  return { jwks, fetch, authorize, control };
}
