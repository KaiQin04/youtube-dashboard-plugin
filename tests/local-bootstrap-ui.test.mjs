import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';

test('local UI clears its launch fragment before exchanging it and loading the session', async () => {
  const events = [], nodes = new Map(), token = 'a'.repeat(43);
  const location = new URL('http://127.0.0.1:4318/#access=' + token);
  const node = () => ({ hidden: false, checked: false, textContent: '', addEventListener() {}, replaceChildren() {} });
  nodes.set('notice', node());
  const context = {
    URL, URLSearchParams, location, applyBrand() {},
    document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); } },
    window: { addEventListener() {} },
    history: { replaceState(_state, _title, path) { events.push('clear'); location.href = new URL(path, location).href; } },
    async fetch(path, options) {
      events.push(path);
      assert.equal(location.hash, '');
      if (path === '/api/local/unlock') {
        assert.equal(JSON.parse(options.body).token, token);
        return Response.json({});
      }
      if (path === '/api/session') return Response.json({ authenticated: true, configurationReady: false, csrfToken: 'synthetic' });
      if (path === '/api/connections') return Response.json({ connections: [] });
      throw new Error('Unexpected UI request.');
    },
  };
  runInNewContext(await readFile(new URL('../src/ui/local.js', import.meta.url), 'utf8'), context);
  for (let turn = 0; turn < 10; turn++) await setImmediate();
  assert.deepEqual(events, ['clear', '/api/local/unlock', '/api/session', '/api/connections']);
  assert.equal(nodes.get('notice').textContent, '');
  assert.equal(nodes.get('connections').textContent, 'No connected channels yet.');
});
