import { readFileSync } from 'node:fs';
import { PANEL_SCRIPTS } from './panel-scripts.generated.mjs';
import { buildPanelHtml } from './dashboard/panel-template.mjs';

/** Shared shell, editor and widgets; only transport and private display defaults vary. */
export function panelHtml({ kind = 'local', brand } = {}) {
  if (!Object.hasOwn(PANEL_SCRIPTS, kind)) throw new Error('Unknown dashboard transport');
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  return buildPanelHtml({ template: read('./panel.html'), styles: ['./dashboard/base.css', './dashboard/styles.css', './dashboard/panel.css'].map(read), editor: read('./dashboard/editor.html'), script: PANEL_SCRIPTS[kind], kind, brand });
}
