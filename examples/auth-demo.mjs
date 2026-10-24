import { pathToFileURL } from 'node:url';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { createWebApp } from '../src/web-app.mjs';
import { startLoopback } from '../src/local-server.mjs';
import { randomString } from '../src/crypto.mjs';
import { browserFixture } from './browser-fixtures.mjs';
import { configuration } from './synthetic-fixtures.mjs';

/** Complete browser onboarding with a visibly synthetic provider; never uses environment settings. */
export async function startAuthDemo({ port = 4319 } = {}) {
  const store = new SqliteStore(':memory:'), provider = await browserFixture(), pending = new Map();
  const runtime = await startLoopback({ port, createHandler: origin => {
    const config = { ...configuration(), publicOrigin: origin, allowLoopbackHttp: true, googleLoginClientId: 'synthetic-login-client', googleLoginClientSecret: 'synthetic-login-secret' };
    const service = new DashboardService({ store, config, fetchImpl: provider.fetch, now: () => provider.control.now });
    const app = createWebApp({ service, config, loginJwks: provider.jwks, fetchImpl: provider.fetch, now: () => provider.control.now, synthetic: true });
    function redirectProvider(url) {
      for (const [id, record] of pending) if (record.expires < Date.now()) pending.delete(id);
      if (pending.size >= 100) throw new Error('Synthetic provider busy');
      const id = randomString(); pending.set(id, { url, expires: Date.now() + 600000 });
      return origin + '/_demo/authorize?request=' + id;
    }
    return async request => {
      const url = new URL(request.url);
      if (url.pathname === '/_demo/authorize') {
        const id = url.searchParams.get('request'), record = pending.get(id);
        if (!record || record.expires < Date.now()) return new Response('Synthetic flow expired.', { status: 400 });
        const purpose = new URL(record.url).searchParams.get('scope') === 'openid' ? '登入工作台' : '授權 YouTube 頻道';
        if (request.method === 'GET') {
          const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/web.css"><title>本機合成提供者</title><div class="demo">本機合成提供者 · 這不是 Google 登入頁</div><main class="shell"><section class="welcome"><div><span class="eyebrow">SYNTHETIC AUTHORIZATION</span><h1>${purpose}</h1><p>選擇測試帳號。此流程會在本機驗證 state、PKCE、簽章與帳號隔離，不會聯絡 Google。</p><form method="post"><div class="connection-actions"><button type="submit" name="account" value="a" class="primary">測試帳號 A</button><button type="submit" name="account" value="b" class="primary">測試帳號 B</button><button type="submit" name="account" value="cancel">取消</button></div></form></div></section></main></html>`;
          return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" } });
        }
        if (request.method === 'POST' && request.headers.get('origin') === origin) {
          const account = new URLSearchParams(await request.text()).get('account');
          if (!['a', 'b', 'cancel'].includes(account)) return new Response(null, { status: 400 });
          pending.delete(id);
          return new Response(null, { status: 303, headers: { Location: provider.authorize(record.url, { account, cancel: account === 'cancel' }), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
        }
        return new Response(null, { status: 405 });
      }
      const response = await app(request);
      if (url.pathname === '/auth/login' && response.status === 303) {
        const headers = new Headers(response.headers); headers.set('Location', redirectProvider(headers.get('Location')));
        return new Response(null, { status: 303, headers });
      }
      if (url.pathname === '/oauth/google/start' && response.ok) {
        const value = await response.json(); value.authorizationUrl = redirectProvider(value.authorizationUrl);
        return Response.json(value, { headers: response.headers });
      }
      return response;
    };
  } });
  return { url: runtime.url, close: async () => { await runtime.close(); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = await startAuthDemo(); console.log('Synthetic onboarding demo: ' + demo.url);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await demo.close(); process.exit(0); });
}
