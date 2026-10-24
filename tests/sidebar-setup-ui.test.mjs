import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function sidebar(setupUrl) {
  const nodes = new Map(); let ready;
  const node = () => ({ hidden: true, value: '', options: [], addEventListener() {}, replaceChildren() {}, append() {} });
  const context = {
    URL, Response, window: {}, location: { href: 'https://panel.example/' },
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    defaultLayout: () => ({}), createCustomizer: () => ({}), createReportActions: () => ({}), bindSourceVideoInteractions() {},
    connectPanelHost({ onReady }) { ready = onReady({ callTool: async () => ({ structuredContent: { setupUrl, connections: [], configurationReady: false } }) }); },
  };
  const source = (await readFile(new URL('../src/ui/panel.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  runInNewContext(source, context); await ready;
  return nodes.get('setup-link');
}

test('sidebar exposes a valid local one-time setup link', async () => {
  const url = 'http://127.0.0.1:4318/#access=' + 'a'.repeat(43);
  const link = await sidebar(url);
  assert.equal(link?.hidden, false); assert.equal(link.href, url);
});

test('sidebar rejects foreign destinations and malformed capability fragments', async () => {
  for (const url of ['https://foreign.example/', 'http://127.0.0.1:4318/?access=guess', 'http://user@127.0.0.1:4318/', 'http://127.0.0.1:4318/#access=short', 'http://127.0.0.1:4318/#access=' + 'a'.repeat(43) + '&access=' + 'b'.repeat(43)]) {
    assert.notEqual((await sidebar(url))?.hidden, false);
  }
});
