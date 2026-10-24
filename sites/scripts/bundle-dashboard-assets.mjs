import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PANEL_SCRIPTS } from '../core/src/panel-scripts.generated.mjs';
import { buildPanelHtml } from '../core/src/dashboard/panel-template.mjs';

const root = new URL('../core/src/', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const branding = read('dashboard/branding.mjs').replace(/^export /gm, '');
const script = PANEL_SCRIPTS.local;
const panel = buildPanelHtml({ template: read('panel.html'), styles: ['dashboard/base.css','dashboard/styles.css','dashboard/panel.css'].map(read), editor: read('dashboard/editor.html'), script });
const resources = {
  panel,
  host: read('ui/web.html'),
  javascript: branding + '\n' + read('ui/web.js'),
  css: read('ui/web.css'),
  scriptDigest: createHash('sha256').update(script).digest('base64'),
};
writeFileSync(new URL('assets.generated.json', root), JSON.stringify(resources));
console.log('Bundled dashboard assets from local source.');
