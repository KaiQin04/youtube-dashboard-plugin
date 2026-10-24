import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareSites } from '../scripts/prepare-sites.mjs';

test('Sites preparation preserves hosting identity and secrets while bundling current shared UI', async () => {
  const target = await mkdtemp(join(tmpdir(), 'youtube-sites-template-'));
  try {
    await mkdir(join(target, '.openai'));
    await mkdir(join(target, 'app'));
    await writeFile(join(target, '.openai/hosting.json'), JSON.stringify({ project_id: 'synthetic-project', d1: null, r2: null }));
    await writeFile(join(target, 'package.json'), JSON.stringify({ scripts: {}, devDependencies: { vinext: 'synthetic-version' } }));
    await writeFile(join(target, 'app/page.tsx'), 'export default function Page() { return null; }');
    await writeFile(join(target, '.dev.vars'), 'SYNTHETIC_VALUE=unchanged');
    await prepareSites(target);
    const hosting = JSON.parse(await readFile(join(target, '.openai/hosting.json'), 'utf8'));
    assert.equal(hosting.project_id, 'synthetic-project');
    assert.equal(hosting.d1, 'DB');
    assert.deepEqual(hosting.capabilities, ['mcp']);
    assert.equal(await readFile(join(target, '.dev.vars'), 'utf8'), 'SYNTHETIC_VALUE=unchanged');
    await assert.rejects(access(join(target, 'app/page.tsx')));
    await access(join(target, 'app/[[...path]]/route.ts'));
    await access(join(target, 'drizzle/0000_remarkable_mach_iv.sql'));
    await assert.rejects(access(join(target, 'core/.env.local')));
    const manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.scripts.prebuild, 'node scripts/bundle-dashboard-assets.mjs');
    execFileSync(process.execPath, ['scripts/bundle-dashboard-assets.mjs'], { cwd: target, stdio: 'pipe' });
    const assets = JSON.parse(await readFile(join(target, 'core/src/assets.generated.json'), 'utf8'));
    const source = await readFile(new URL('../src/ui/web.js', import.meta.url), 'utf8');
    assert.ok(assets.javascript.endsWith(source));
    assert.match(assets.panel, /<script>/);
    assert.doesNotMatch(await readFile(join(target, 'core/src/web-resource.mjs'), 'utf8'), /node:fs/);
    await assert.rejects(prepareSites(target), /fresh Sites starter/);
  } finally { await rm(target, { recursive: true, force: true }); }
});

test('Sites preparation rejects a non-starter target before changing any files', async () => {
  const target = await mkdtemp(join(tmpdir(), 'youtube-sites-nonstarter-'));
  try {
    await writeFile(join(target, 'package.json'), '{"name":"other-project"}');
    await assert.rejects(prepareSites(target), /fresh Sites starter/);
    assert.equal(await readFile(join(target, 'package.json'), 'utf8'), '{"name":"other-project"}');
    await assert.rejects(access(join(target, 'core')));
  } finally { await rm(target, { recursive: true, force: true }); }
});
