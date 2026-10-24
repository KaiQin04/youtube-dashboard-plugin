import test from 'node:test';
import assert from 'node:assert/strict';
import { createCustomizer } from '../src/dashboard/editor.mjs';
import { defaultLayout } from '../src/dashboard/layout.mjs';

test('editor construction applies display defaults without calling the host before it is initialized', async t => {
  const originalDocument = globalThis.document, originalMedia = globalThis.matchMedia;
  t.after(() => { globalThis.document = originalDocument; globalThis.matchMedia = originalMedia; });
  const element = () => ({ value: '', dataset: {}, style: { setProperty() {} }, addEventListener() {}, append() {}, replaceChildren() {}, setAttribute() {}, close() {}, reset() {} });
  const nodes = new Map();
  globalThis.document = { documentElement: element(), body: element(), querySelectorAll: () => [], createElement: () => element(), getElementById: id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  let notifications = 0, initialized = false;
  const editor = createCustomizer({ brandDefaults: { name: 'Test workspace', icon: 'chart' }, onChange: () => { assert.equal(initialized, true, 'The host is not ready during construction'); notifications++; }, onNotice() {}, onSessionExpired() {}, transport: async () => Response.json({ layout: defaultLayout(), revision: 0 }) });
  assert.equal(notifications, 0);
  initialized = true; await editor.load();
  assert.equal(notifications, 1);
});
