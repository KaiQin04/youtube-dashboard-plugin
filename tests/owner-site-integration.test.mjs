import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

test('owner-site integration pins the shared core, preserves runtime files and detects generated drift', async t => {
  const { syncOwnerSite } = await import('../scripts/sync-owner-site.mjs');
  const target = await mkdtemp(join(tmpdir(), 'youtube-owner-integration-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await mkdir(join(target, 'lib/analytics'), { recursive: true });
  await mkdir(join(target, 'settings'), { recursive: true });
  await writeFile(join(target, 'package.json'), JSON.stringify({ type: 'module', private: true, devDependencies: { vinext: '1.0.0-beta.5' } }));
  await writeFile(join(target, 'lib/analytics/handler.mjs'), 'export function handleAnalytics() {}\n');
  await writeFile(join(target, 'settings/dashboard.mjs'), "export const SITE_SETTINGS={grantContextPrefix:'legacy-v1',exportPrefix:'custom'};\n");
  await writeFile(join(target, '.env.local'), 'synthetic-private-fixture-do-not-copy');
  const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
  const options = { sourceRoot, target, sourceCommit: 'a'.repeat(40), brand: { name: 'My test channel', icon: 'chart' } };
  await syncOwnerSite(options);
  assert.equal(await readFile(join(target, '.env.local'), 'utf8'), 'synthetic-private-fixture-do-not-copy');
  const layout = await import(pathToFileURL(join(target, 'lib/analytics/layout.mjs')));
  const core = await import(pathToFileURL(join(target, 'vendor/youtube-dashboard-core/src/dashboard/layout.mjs')));
  assert.equal(layout.validateLayout, core.validateLayout);
  const page = await readFile(join(target, 'public/analytics/index.html'), 'utf8');
  assert.match(page, /My test channel/);
  assert.doesNotMatch(page, /synthetic-private-fixture/);
  const manifest = JSON.parse(await readFile(join(target, 'dashboard-core.lock.json'), 'utf8'));
  assert.equal(manifest.sourceCommit, 'a'.repeat(40));
  assert.equal(manifest.sourceRepository, 'https://github.com/KaiQin04/youtube-dashboard-plugin');
  assert.ok(manifest.files.every(file => !file.path.includes('.env')));
  await syncOwnerSite({ ...options, check: true });
  await writeFile(join(target, 'lib/analytics/contracts.mjs'), '// hand-edited copy\n');
  await assert.rejects(syncOwnerSite({ ...options, check: true }), /drift/i);
});

async function ownerFixture(t) {
  const target = await mkdtemp(join(tmpdir(), 'youtube-owner-boundary-'));
  t.after(() => rm(target, { recursive: true, force: true }));
  await mkdir(join(target, 'lib/analytics'), { recursive: true });
  await writeFile(join(target, 'package.json'), JSON.stringify({ type: 'module', devDependencies: { vinext: '1.0.0-beta.5' } }));
  await writeFile(join(target, 'lib/analytics/handler.mjs'), '// synthetic handler\n');
  return target;
}

test('owner integration preflights symlink ancestors and files before any writes', async t => {
  const { syncOwnerSite } = await import('../scripts/sync-owner-site.mjs');
  const { symlink, readdir } = await import('node:fs/promises');
  const target = await ownerFixture(t), outside = await mkdtemp(join(tmpdir(), 'youtube-owner-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(target, 'vendor'));
  await assert.rejects(syncOwnerSite({ target }), /symlink/i);
  assert.deepEqual(await readdir(outside), []);
  assert.deepEqual(await readdir(join(target, 'lib/analytics')), ['handler.mjs']);
  await rm(join(target, 'vendor'));
  await writeFile(join(outside, 'sentinel.mjs'), '// preserve\n');
  await symlink(join(outside, 'sentinel.mjs'), join(target, 'lib/analytics/contracts.mjs'));
  await assert.rejects(syncOwnerSite({ target }), /symlink/i);
  assert.equal(await readFile(join(outside, 'sentinel.mjs'), 'utf8'), '// preserve\n');
  assert.equal((await readdir(target)).includes('vendor'), false);
});

test('owner integration rejects extra and retired generated assets without deleting them', async t => {
  const { syncOwnerSite } = await import('../scripts/sync-owner-site.mjs');
  const target = await ownerFixture(t); await syncOwnerSite({ target });
  const extra = join(target, 'public/analytics/core/retired-asset.js');
  await writeFile(extra, '// retired\n');
  await assert.rejects(syncOwnerSite({ target, check: true }), /stale|extra/i);
  await assert.rejects(syncOwnerSite({ target }), /stale|extra/i);
  assert.equal(await readFile(extra, 'utf8'), '// retired\n');
  await rm(extra);
  const lockPath = join(target, 'dashboard-core.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  lock.files.push({ path: 'lib/analytics/retired.generated.mjs', sha256: '0'.repeat(64) });
  await writeFile(lockPath, JSON.stringify(lock));
  await writeFile(join(target, 'lib/analytics/retired.generated.mjs'), '// retired\n');
  await assert.rejects(syncOwnerSite({ target, check: true }), /stale|extra|manifest/i);
  await assert.rejects(syncOwnerSite({ target }), /stale|extra/i);
  assert.equal(await readFile(join(target, 'lib/analytics/retired.generated.mjs'), 'utf8'), '// retired\n');
});
