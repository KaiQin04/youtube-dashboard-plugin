import { readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const defaultSource = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const ownerPanelModule = html => '// Generated from the shared dashboard core. Do not edit.\nexport const DASHBOARD_PANEL_HTML=' + JSON.stringify(html) + ';\n';

/** Install source-derived artifacts only; never opens runtime settings or databases. */
export async function syncOwnerSite({ target, sourceRoot = defaultSource, sourceCommit, brand, check = false }) {
  target = resolve(target); sourceRoot = resolve(sourceRoot);
  if (lstatSync(target).isSymbolicLink()) throw new Error('Target symlink is not allowed.');
  target = realpathSync(target);
  function preflight(path, kind = 'file') {
    const parts = path.split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) throw new Error('Invalid generated manifest path.');
    let current = target;
    for (let i = 0; i < parts.length; i++) {
      current = join(current, parts[i]);
      const info = lstatSync(current, { throwIfNoEntry: false });
      if (!info) continue;
      if (info.isSymbolicLink()) throw new Error('Target symlink is not allowed: ' + path);
      if (i < parts.length - 1 || kind === 'directory') {
        if (!info.isDirectory()) throw new Error('Expected generated directory: ' + path);
      } else if (!info.isFile()) throw new Error('Expected generated file: ' + path);
    }
  }
  for (const path of ['package.json', 'lib/analytics/handler.mjs', 'dashboard-core.lock.json']) preflight(path);
  const targetManifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  if (!targetManifest.devDependencies?.vinext || !existsSync(join(target, 'lib/analytics/handler.mjs'))) throw new Error('Choose an existing owner-site source checkout.');
  const source = new Map();
  function collect(directory) {
    for (const name of readdirSync(join(sourceRoot, directory)).sort()) {
      const path = directory + '/' + name, info = lstatSync(join(sourceRoot, path));
      if (info.isSymbolicLink()) throw new Error('Shared source cannot contain symlinks.');
      if (info.isDirectory()) collect(path);
      else if (info.isFile() && /\.(?:mjs|js|html|css|json)$/.test(name)) source.set(path, readFileSync(join(sourceRoot, path)));
      else throw new Error('Unexpected shared source file.');
    }
  }
  collect('src');
  source.set('sync-owner-site.mjs', readFileSync(new URL(import.meta.url)));
  const sourceTreeSha256 = digest([...source].map(([path, bytes]) => path + ':' + digest(bytes)).join('\n'));
  const lockPath = join(target, 'dashboard-core.lock.json');
  const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
  sourceCommit ??= previous?.sourceTreeSha256 === sourceTreeSha256 ? previous.sourceCommit : null;
  const outputs = new Map(), text = (path, value) => outputs.set(path, Buffer.from(value));
  for (const [path, bytes] of source) outputs.set('vendor/youtube-dashboard-core/' + path, bytes);
  const vendor = '../../vendor/youtube-dashboard-core/src/';
  const direct = {
    contracts: 'analytics/contracts.mjs', metrics: 'analytics/metrics.mjs', repository: 'analytics/repository.mjs',
    'native-summary': 'analytics/native-summary.mjs', freshness: 'analytics/freshness.mjs', comments: 'analytics/comments.mjs',
    reports: 'analytics/reports.mjs', security: 'compat/security.mjs', 'layout-store': 'compat/layout-store.mjs',
    'report-store': 'compat/report-store.mjs', 'report-service': 'compat/report-service.mjs', layout: 'dashboard/layout.mjs',
    'panel-bridge': 'dashboard/panel-bridge.mjs',
  };
  for (const [name, path] of Object.entries(direct)) text('lib/analytics/' + name + '.mjs', '// Generated adapter; edit the shared core.\nexport * from \'' + vendor + path + '\';\n');
  text('lib/analytics/storage.mjs', `export {normalizeCoverage} from '${vendor}analytics/storage.mjs';\nexport {D1Store} from '${vendor}compat/owner-store.mjs';\n`);
  text('lib/analytics/youtube.mjs', `import {YouTubeSnapshotAdapter as CoreAdapter} from '${vendor}analytics/youtube.mjs';\nexport {DAILY_METRICS,boundedSyncRange,parseDailyReport,parseDuration} from '${vendor}analytics/youtube.mjs';\nexport class YouTubeSnapshotAdapter extends CoreAdapter {constructor(options){super({refreshOnUnauthorized:true,unauthorizedCode:'UPSTREAM_UNAUTHORIZED',...options});}}\n`);
  text('lib/analytics/oauth.mjs', `import {OAuthService as CoreOAuth} from '${vendor}compat/oauth.mjs';\nimport {SITE_SETTINGS} from '../../settings/dashboard.mjs';\nexport class OAuthService extends CoreOAuth {constructor(options){super({...options,config:{grantContextPrefix:SITE_SETTINGS.grantContextPrefix,...options.config}});}}\n`);
  text('lib/analytics/export.mjs', `import {createAnalyticsExport as coreExport} from '${vendor}analytics/export.mjs';\nexport * from '${vendor}analytics/export.mjs';\nimport {SITE_SETTINGS} from '../../settings/dashboard.mjs';\nexport const createAnalyticsExport=(snapshot,options,settings)=>coreExport(snapshot,options,{filenamePrefix:SITE_SETTINGS.exportPrefix,...settings});\n`);
  text('lib/analytics/brand.mjs', "export {PLUGIN_ICON,PRIVATE_BRAND} from '../../settings/dashboard.mjs';\n");
  text('lib/analytics/panel-bridge.mjs', `import {connectPanelHost as connect} from '${vendor}dashboard/panel-bridge.mjs';\nimport {SITE_SETTINGS} from '../../settings/dashboard.mjs';\nexport const connectPanelHost=options=>connect({requestPrefix:SITE_SETTINGS.panelRequestPrefix,...options});\n`);
  text('lib/analytics/dashboard-panel-client.mjs', "import '../../vendor/youtube-dashboard-core/src/ui/owner-panel.js';\n");
  for (const [path, bytes] of source) {
    if (path.startsWith('src/dashboard/') || ['src/errors.mjs', 'src/dashboard-catalog.mjs', 'src/themes.mjs'].includes(path)) outputs.set('public/analytics/core/' + path.slice(4), bytes);
  }
  for (const name of ['branding','themes','catalog','layout','widgets','editor','report-catalog','report-widgets','report-actions','source-videos']) text('public/analytics/customization/' + name + '.mjs', '// Generated browser adapter.\nexport * from \'../core/dashboard/' + name + '.mjs\';\n');
  const { brandDefaults, brandDefaultsScript } = await import(pathToFileURL(join(sourceRoot, 'src/dashboard/brand-default.mjs')));
  text('public/analytics/customization/brand-default.mjs', 'export const PRIVATE_BRAND=' + JSON.stringify(brandDefaults(brand)) + ';\n');
  for (const [destination, path] of [
    ['public/analytics/customization/styles.css','src/dashboard/styles.css'],
    ['public/analytics/customization/layout-http.mjs','src/hosted/layout-http.mjs'],
    ['public/analytics/styles.css','src/dashboard/base.css'],
    ['public/analytics/app.js','src/hosted/site.js'],
  ]) outputs.set(destination, source.get(path));
  text('public/analytics/index.html', source.get('src/hosted/site.html').toString().replace('<!-- BRAND_DEFAULTS -->', () => brandDefaultsScript(brand)).replace('<!-- EDITOR -->', () => source.get('src/dashboard/editor.html').toString()));
  const { panelHtml } = await import(pathToFileURL(join(sourceRoot, 'src/panel-resource.mjs')));
  text('lib/analytics/dashboard-panel.generated.mjs', ownerPanelModule(panelHtml({ kind: 'owner', brand })));
  text('scripts/build-dashboard-panel.mjs', `import {readFileSync} from 'node:fs';\nimport {fileURLToPath} from 'node:url';\nimport {syncOwnerSite,ownerPanelModule} from '../vendor/youtube-dashboard-core/sync-owner-site.mjs';\nimport {panelHtml} from '../vendor/youtube-dashboard-core/src/panel-resource.mjs';\nimport {PRIVATE_BRAND} from '../settings/dashboard.mjs';\nexport async function buildDashboardPanel(){return ownerPanelModule(panelHtml({kind:'owner',brand:PRIVATE_BRAND}));}\nif(process.argv[1]===fileURLToPath(import.meta.url)){await syncOwnerSite({sourceRoot:fileURLToPath(new URL('../vendor/youtube-dashboard-core/',import.meta.url)),target:fileURLToPath(new URL('../',import.meta.url)),brand:PRIVATE_BRAND,check:process.argv.includes('--check')});console.log('Shared dashboard source verified or generated.');}\n`);
  const files = [...outputs].map(([path, bytes]) => ({ path, sha256: digest(bytes) }));
  // Validate every destination before the first write; never follow existing links.
  for (const path of outputs.keys()) preflight(path);
  function managed(directory) {
    preflight(directory, 'directory');
    if (!existsSync(join(target, directory))) return;
    for (const name of readdirSync(join(target, directory))) {
      const path = directory + '/' + name, info = lstatSync(join(target, path));
      if (info.isSymbolicLink()) throw new Error('Target symlink is not allowed: ' + path);
      if (info.isDirectory()) managed(path);
      else if (!info.isFile() || !outputs.has(path)) throw new Error('Stale or extra generated asset: ' + path);
    }
  }
  for (const directory of ['vendor/youtube-dashboard-core', 'public/analytics/core', 'public/analytics/customization']) managed(directory);
  for (const entry of previous?.files ?? []) {
    preflight(entry.path);
    if (!outputs.has(entry.path) && existsSync(join(target, entry.path))) throw new Error('Stale generated asset: ' + entry.path);
  }
  if (check) {
    if (!previous || previous.sourceTreeSha256 !== sourceTreeSha256) throw new Error('Shared core source drift.');
    if (previous.files?.length !== files.length || previous.files.some(entry => !outputs.has(entry.path) || digest(outputs.get(entry.path)) !== entry.sha256)) throw new Error('Generated manifest drift.');
    for (const { path, sha256 } of files) if (!existsSync(join(target, path)) || digest(readFileSync(join(target, path))) !== sha256) throw new Error('Generated dashboard drift: ' + path);
    return { verified: true, files: files.length, sourceTreeSha256 };
  }
  for (const [path, bytes] of outputs) { mkdirSync(dirname(join(target, path)), { recursive: true }); writeFileSync(join(target, path), bytes); }
  const manifest = { version: 1, sourceRepository: 'https://github.com/KaiQin04/youtube-dashboard-plugin', sourceCommit, sourceTreeSha256, files };
  writeFileSync(lockPath, JSON.stringify(manifest, null, 2) + '\n');
  return { integrated: true, files: files.length, sourceTreeSha256 };
}
