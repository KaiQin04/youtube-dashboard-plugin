import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';

test('clean stdio installation exposes setup and the shared panel without Google credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-stdio-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ['scripts/local-plugin.mjs', '--stdio', '--data-dir', directory, '--port', '0'], { cwd: new URL('../', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  let output = '', diagnostics = '';
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { diagnostics += chunk; });
  for (const request of [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_local_setup_status', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'ui://youtube-dashboard/panel-v2.html' } },
  ]) child.stdin.write(JSON.stringify(request) + '\n');
  child.stdin.end();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, diagnostics);
  const replies = output.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3, 4]);
  assert.equal(replies[0].result.protocolVersion, '2025-11-25');
  assert.ok(replies[1].result.tools.some(tool => tool.name === 'open_youtube_dashboard'));
  assert.equal(replies[2].result.structuredContent.configurationReady, false);
  assert.deepEqual(replies[2].result.structuredContent.settings.map(setting => setting.configured), [false, false]);
  assert.match(replies[3].result.contents[0].text, /data-brand-name/);
  assert.doesNotMatch(output, /"encryptionKey"|"googleClientSecret"|"owner"/);
});
