import { brandDefaultsScript } from './brand-default.mjs';

/** One HTML assembler for Node, Sites build assets and the existing-site adapter. */
export function buildPanelHtml({ template, styles, editor, script, kind = 'local', brand }) {
  return template
    .replace('<!-- PANEL_STYLE -->', () => '<style>' + styles.join('\n') + '</style>')
    .replace('<!-- BRAND_DEFAULTS -->', () => brandDefaultsScript(brand))
    .replace('<!-- EDITOR -->', () => editor)
    .replace('<!-- CONNECTION_VISIBILITY -->', kind === 'owner' ? 'hidden' : '')
    .replace('<!-- PANEL_SCRIPT -->', () => '<script>' + script.replaceAll('</script', '<\\/script') + '</script>');
}
