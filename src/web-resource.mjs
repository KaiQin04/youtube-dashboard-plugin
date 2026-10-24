import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { panelHtml } from './panel-resource.mjs';

const branding=readFileSync(new URL('./dashboard/branding.mjs',import.meta.url),'utf8').replace(/^export /gm,'');
const host = readFileSync(new URL('./ui/web.html', import.meta.url), 'utf8');
const assets = new Map([
  ['/assets/web.js', { type: 'text/javascript; charset=utf-8', body: branding+'\n'+readFileSync(new URL('./ui/web.js', import.meta.url), 'utf8') }],
  ['/assets/web.css', { type: 'text/css; charset=utf-8', body: readFileSync(new URL('./ui/web.css', import.meta.url), 'utf8') }],
]);
const panel = panelHtml();
const script = panel.match(/<script>([\s\S]*?)<\/script>/)[1];
const digest = createHash('sha256').update(script).digest('base64');
export const hostPolicy = "default-src 'none'; script-src 'self'; style-src 'self'; img-src data:; connect-src 'self'; frame-src 'self'; form-action 'self' https://accounts.google.com; frame-ancestors 'none'; base-uri 'none'";
export const panelPolicy = `default-src 'none'; script-src 'sha256-${digest}'; style-src 'unsafe-inline'; img-src data: https://i.ytimg.com; frame-ancestors 'self'; base-uri 'none'`;
export function webResource(path, synthetic = false) {
  if (path === '/') return { body: synthetic ? host.replace('<html lang="zh-Hant">', '<html lang="zh-Hant" data-synthetic="true">') : host, type: 'text/html; charset=utf-8', policy: hostPolicy };
  if (path === '/panel') return { body: panel, type: 'text/html; charset=utf-8', policy: panelPolicy };
  return assets.get(path);
}
