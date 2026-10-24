export const DEFAULT_BRAND = Object.freeze({ name: 'YouTube Dashboard', icon: 'chart' });

/** Host-supplied display defaults only; credentials and channel bindings are never serialized. */
export function brandDefaults(input = {}) {
  const name = typeof input.name === 'string' && input.name.trim() && input.name.length <= 80 && !/[<>\u0000-\u001f]/u.test(input.name) ? input.name.trim() : DEFAULT_BRAND.name;
  const icon = typeof input.icon === 'string' && (['chart', 'camera', 'play', 'spark', 'letter', 'none'].includes(input.icon) || input.icon.length <= 262144 && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(input.icon)) ? input.icon : DEFAULT_BRAND.icon;
  const subtitle = typeof input.subtitle === 'string' && input.subtitle.length <= 80 && !/[<>\u0000-\u001f]/u.test(input.subtitle) ? input.subtitle : undefined;
  return { name, icon, ...(subtitle !== undefined ? { subtitle } : {}) };
}
export function brandDefaultsScript(input) {
  return '<script id="dashboard-brand-defaults" type="application/json">' + JSON.stringify(brandDefaults(input)).replaceAll('<', '\\u003c') + '</script>';
}
export function getBrandDefaults(document = globalThis.document) {
  try { return brandDefaults(JSON.parse(document?.getElementById('dashboard-brand-defaults')?.textContent || '{}')); }
  catch { return { ...DEFAULT_BRAND }; }
}
