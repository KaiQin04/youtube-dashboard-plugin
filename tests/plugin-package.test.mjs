import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { buildPlugin } from '../scripts/build-plugin.mjs';

test('the downloadable Plugin contains the shared core, locked dependency and setup skill without runtime data', async t => {
  const output = await mkdtemp(join(tmpdir(), 'youtube-package-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const result = await buildPlugin({ output });
  execFileSync('unzip', ['-tq', result.archive], { stdio: 'pipe' });
  const manifest = JSON.parse(await readFile(join(result.directory, 'plugin.json'), 'utf8'));
  assert.equal(manifest.extensions['com.openai'].onboardingSkill, './skills/setup/SKILL.md');
  const mcp = JSON.parse(await readFile(join(result.directory, 'mcp.json'), 'utf8'));
  assert.equal(mcp.mcpServers['youtube-dashboard'].type, 'stdio');
  assert.equal(mcp.mcpServers['youtube-dashboard'].args[0], '${PLUGIN_ROOT}/scripts/local-plugin.mjs');
  assert.equal(await readFile(join(result.directory, 'src/panel.html'), 'utf8'), await readFile(new URL('../src/panel.html', import.meta.url), 'utf8'));
  await access(join(result.directory, 'node_modules/jose/package.json'));
  await access(join(result.directory, 'skills/setup/SKILL.md'));
  await access(join(result.directory, 'README.en.md'));
  for (const path of ['.env.local', '.local', 'profile.json', 'google.json', 'dashboard.sqlite', '.git']) await assert.rejects(access(join(result.directory, path)));
  const checksums = JSON.parse(await readFile(result.checksums, 'utf8'));
  assert.match(checksums.archiveSha256, /^[a-f0-9]{64}$/);
  assert.ok(checksums.files.some(file => file.path === 'src/panel.html'));
  const profile = await mkdtemp(join(tmpdir(), 'youtube-package-sidebar-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'open_youtube_dashboard', arguments: {} } },
  ];
  const outputText = execFileSync(process.execPath, ['scripts/local-plugin.mjs', '--stdio', '--data-dir', profile, '--port', '0'], { cwd: result.directory, input: requests.map(request => JSON.stringify(request) + '\n').join(''), encoding: 'utf8', timeout: 10000 });
  const [tools, opened] = outputText.trim().split('\n').map(line => JSON.parse(line));
  const entrypoint = tools.result.tools.find(tool => tool.name === 'open_youtube_dashboard');
  assert.deepEqual(entrypoint._meta['openai/ui'].entrypoints, [{ type: 'global' }, { type: 'thread' }]);
  assert.equal(entrypoint._meta.ui.resourceUri, 'ui://youtube-dashboard/panel-v5.html');
  assert.equal(opened.result.isError, undefined);
  assert.equal(opened.result.structuredContent.configurationReady, false);
  assert.match(opened.result.structuredContent.url, /^http:\/\/127\.0\.0\.1:\d+\/#access=[A-Za-z0-9_-]{43}$/);
});
