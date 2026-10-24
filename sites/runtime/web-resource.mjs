import assets from './assets.generated.json' with { type: 'json' };

export const hostPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src data: https://i.ytimg.com; connect-src 'self'; frame-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'";
export const panelPolicy = `default-src 'none'; script-src 'sha256-${assets.scriptDigest}'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; base-uri 'none'`;
export function webResource(path, synthetic = false) {
  if (path === '/') return { body: synthetic ? assets.host.replace('<html lang="zh-Hant">', '<html lang="zh-Hant" data-synthetic="true">') : assets.host, type: 'text/html; charset=utf-8', policy: hostPolicy };
  if (path === '/panel') return { body: assets.panel, type: 'text/html; charset=utf-8', policy: panelPolicy };
  if (path === '/assets/web.js') return { body: assets.javascript, type: 'text/javascript; charset=utf-8' };
  if (path === '/assets/web.css') return { body: assets.css, type: 'text/css; charset=utf-8' };
}
