import assets from './assets.generated.json' with { type: 'json' };
/** Build-time bundled resource; no filesystem access in the Worker. */
export function panelHtml() { return assets.panel; }
