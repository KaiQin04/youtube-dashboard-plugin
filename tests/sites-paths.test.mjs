import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdtemp, mkdir, writeFile, readFile, readdir, symlink, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepareSites } from '../scripts/prepare-sites.mjs';
async function starter(target) {
  await mkdir(join(target, '.openai'), { recursive: true }); await mkdir(join(target, 'app'));
  await writeFile(join(target, '.openai/hosting.json'), '{"project_id":"synthetic"}');
  await writeFile(join(target, 'package.json'), '{"devDependencies":{"vinext":"synthetic"},"scripts":{}}');
  await writeFile(join(target, 'app/page.tsx'), 'synthetic starter page');
}

test('Sites staging rejects a parent directory writable by other OS accounts', { skip: process.platform === 'win32' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-sites-parent-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'starter'); await starter(target);
  await chmod(directory, 0o777);
  await assert.rejects(prepareSites(target), /controlled by your OS account/);
  assert.equal(await readFile(join(target, 'app/page.tsx'), 'utf8'), 'synthetic starter page');
});

test('replacing a starter marker during preparation cannot overwrite an outside file', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube-sites-race-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = join(directory, 'starter'), outside = join(directory, 'outside.json');
  await starter(target); await writeFile(outside, '{"sentinel":"unchanged"}');
  let done = false;
  const pending = prepareSites(target).catch(() => null).finally(() => { done = true; });
  const attacker = (async () => {
    while (!done) {
      try { await access(join(target, 'core')); }
      catch { continue; }
      try { await rm(join(target, 'package.json')); await symlink(outside, join(target, 'package.json')); }
      catch { /* The target may be atomically replaced while the probe runs. */ }
      break;
    }
  })();
  await Promise.all([pending, attacker]);
  assert.equal(await readFile(outside, 'utf8'), '{"sentinel":"unchanged"}');
});
async function snapshot(directory) {
  const files = {};
  async function walk(path = '') {
    for (const name of (await readdir(join(directory, path))).sort()) {
      const relative = join(path, name), info = await lstat(join(directory, relative));
      if (info.isSymbolicLink()) files[relative] = 'symlink';
      else if (info.isDirectory()) await walk(relative);
      else files[relative] = await readFile(join(directory, relative), 'utf8');
    }
  }
  await walk(); return files;
}
for (const path of ['root', 'root-parent', '.openai', '.openai/hosting.json', 'package.json', 'app', 'app/page.tsx', 'app/[[...path]]', 'core', 'scripts', 'public', 'vendor', 'db', 'drizzle', 'drizzle.config.ts', 'lib']) {
  test('Sites rejects ' + path + ' symlinks before any target/outside mutation', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'youtube-sites-links-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const target = join(directory, 'starter'), outside = join(directory, 'outside');
    await starter(target); await mkdir(outside); await writeFile(join(outside, 'sentinel'), 'unchanged');
    let selected = target;
    if (path === 'root' || path === 'root-parent') {
      await symlink(target, join(directory, 'linked'));
      selected = path === 'root' ? join(directory, 'linked') : join(directory, 'linked', 'nested');
      if (path === 'root-parent') await starter(join(target, 'nested'));
    } else {
      const destination = join(target, path); await mkdir(dirname(destination), { recursive: true });
      if (['package.json', '.openai/hosting.json', 'app/page.tsx'].includes(path)) {
        await writeFile(join(outside, 'marker'), await readFile(destination, 'utf8'));
        await rm(destination); await symlink(join(outside, 'marker'), destination);
      } else if (path === 'drizzle.config.ts') {
        await writeFile(join(outside, 'marker'), 'unchanged'); await symlink(join(outside, 'marker'), destination);
      } else {
        await rm(destination, { recursive: true, force: true }); await symlink(outside, destination);
      }
    }
    const beforeTarget = await snapshot(target), beforeOutside = await snapshot(outside);
    await assert.rejects(prepareSites(selected), /symlink/i);
    assert.deepEqual(await snapshot(target), beforeTarget); assert.deepEqual(await snapshot(outside), beforeOutside);
  });
}
