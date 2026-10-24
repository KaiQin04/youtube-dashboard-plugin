import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startLocalWorkspace } from '../src/local-workspace.mjs';
import { localBrowser } from './local-browser.mjs';

const call = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-sidebar-'));
  const runtime = await startLocalWorkspace({ directory, port: 0, fetchImpl: () => { throw new Error('Opening a panel must not query Google'); } });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  return runtime;
}

test('sidebar and conversation entrypoints open the shared panel without a channel or Google setup', async t => {
  const runtime = await workspace(t);
  const listed = await runtime.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const entrypoint = listed.result.tools.find(tool => tool.name === 'open_youtube_dashboard');
  assert.deepEqual(entrypoint._meta?.['openai/ui']?.entrypoints, [{ type: 'global' }, { type: 'thread' }]);
  assert.deepEqual(entrypoint.inputSchema.required, []);
  assert.deepEqual(entrypoint.inputSchema.properties, {});
  assert.equal(entrypoint.annotations.readOnlyHint, true);
  const opened = await runtime.rpc(call(entrypoint.name));
  assert.equal(opened.result.isError, undefined);
  assert.equal(new URL(opened.result.structuredContent.url).origin, runtime.url);
  assert.equal(opened.result.structuredContent.configurationReady, false);
  const resource = await runtime.rpc({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: entrypoint._meta.ui.resourceUri } });
  assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app');
  const { cookie } = await localBrowser(runtime);
  const browserPanel = await fetch(runtime.url + '/panel', { headers: { cookie } });
  assert.equal(await browserPanel.text(), resource.result.contents[0].text);
  assert.equal((await runtime.rpc(call(entrypoint.name, { connectionId: 'not-needed' }))).result.isError, true);
});

test('an empty sidebar can explain setup before and after client configuration without accessing Google', async t => {
  const runtime = await workspace(t);
  const before = await runtime.rpc(call('list_youtube_connections'));
  assert.equal(before.result.isError, undefined);
  assert.deepEqual(before.result.structuredContent.connections, []);
  assert.equal(before.result.structuredContent.configurationReady, false);
  assert.equal(new URL(before.result.structuredContent.setupUrl).origin, runtime.url);
  assert.equal((await runtime.rpc(call('list_youtube_connections', { owner: 'someone-else' }))).result.isError, true);
  const { cookie } = await localBrowser(runtime);
  const session = await (await fetch(runtime.url + '/api/session', { headers: { cookie } })).json();
  const saved = await fetch(runtime.url + '/api/local/config', { method: 'POST', headers: { cookie, origin: runtime.url, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ googleClientId: 'synthetic-sidebar.apps.googleusercontent.com', googleClientSecret: 'synthetic-sidebar-secret' }) });
  assert.equal(saved.status, 200);
  const after = await runtime.rpc(call('list_youtube_connections'));
  assert.deepEqual(after.result.structuredContent.connections, []);
  assert.equal(after.result.structuredContent.configurationReady, true);
  assert.equal(new URL(after.result.structuredContent.setupUrl).origin, runtime.url);
  const reopened = (await runtime.rpc(call('open_youtube_dashboard'))).result.structuredContent;
  assert.equal(new URL(reopened.url).origin, runtime.url);
  assert.equal(reopened.configurationReady, true);
  assert.deepEqual((await runtime.rpc(call('get_local_setup_status'))).result.structuredContent.settings.map(item => item.configured), [true, true]);
});
