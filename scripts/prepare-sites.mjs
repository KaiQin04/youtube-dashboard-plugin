import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, parse, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const overlays = ['app', 'db', 'drizzle', 'drizzle.config.ts', 'lib', 'scripts', 'public', 'vendor'];

async function linkSafeRoot(directory) {
  let current = parse(directory).root;
  for (const part of directory.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    // macOS system temp aliases are root-owned, outside the selected starter.
    if (process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && info.uid === 0 && info.isSymbolicLink()) { current = await realpath(current); continue; }
    if (info.isSymbolicLink()) throw new Error('Sites target symlink is not allowed.');
    if (!info.isDirectory()) throw new Error('Choose a fresh Sites starter directory.');
    if (process.getuid && (info.uid !== process.getuid() && info.uid !== 0 || info.mode & 0o022 && !(info.uid === 0 && info.mode & 0o1000))) throw new Error('Choose a Sites starter under directories controlled by your OS account.');
  }
  return current;
}

async function preflight(root, path) {
  const destination = resolve(root, path);
  if (relative(root, destination).startsWith('..')) throw new Error('Invalid Sites path.');
  let current = root;
  for (const part of relative(root, destination).split(sep)) {
    current = join(current, part);
    let info;
    try { info = await lstat(current); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('Sites source or target symlink is not allowed.');
  }
  const info = await lstat(destination);
  if (info.isDirectory()) {
    for (const name of await readdir(destination)) await preflight(root, join(path, name));
  } else if (!info.isFile()) throw new Error('Invalid Sites file.');
}

async function preflightTarget(target) {
  for (const path of ['.openai/hosting.json', 'package.json', 'app/page.tsx', 'core', ...overlays]) await preflight(target, path);
}

async function starterSettings(target) {
  let hosting, manifest;
  try {
    hosting = JSON.parse(await readFile(join(target, '.openai/hosting.json'), 'utf8'));
    manifest = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'));
    await access(join(target, 'app/page.tsx'));
  } catch { throw new Error('Choose a fresh Sites starter checkout.'); }
  if (!manifest.devDependencies?.vinext || manifest.scripts?.prebuild) {
    throw new Error('Choose a fresh Sites starter checkout without a prebuild override.');
  }
  try { await access(join(target, 'core')); throw new Error('Choose a fresh Sites starter checkout without an existing core directory.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { hosting, manifest };
}

async function applySites(target) {
  await preflightTarget(target);
  for (const path of ['src', ...overlays.map(path => join('sites', path)), 'sites/runtime']) await preflight(sourceRoot, path);
  const { hosting, manifest } = await starterSettings(target);
  await mkdir(join(target, 'core'), { recursive: true });
  await cp(join(sourceRoot, 'src'), join(target, 'core/src'), { recursive: true });
  for (const path of overlays) await cp(join(sourceRoot, 'sites', path), join(target, path), { recursive: true });
  for (const file of ['panel-resource.mjs', 'web-resource.mjs']) {
    await cp(join(sourceRoot, 'sites/runtime', file), join(target, 'core/src', file));
  }
  await rm(join(target, 'app/page.tsx'));
  hosting.d1 = 'DB';
  hosting.capabilities = [...new Set([...(hosting.capabilities ?? []), 'mcp'])];
  manifest.dependencies = { ...manifest.dependencies, jose: '6.2.13' };
  manifest.scripts = { ...manifest.scripts, prebuild: 'node scripts/bundle-dashboard-assets.mjs' };
  await writeFile(join(target, '.openai/hosting.json'), JSON.stringify(hosting, null, 2) + '\n');
  await writeFile(join(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { prepared: true };
}

/** Prepare in an operator-owned tree; never write through paths in the supplied starter. */
export async function prepareSites(directory) {
  const target = await linkSafeRoot(resolve(directory));
  await preflightTarget(target);
  await starterSettings(target);
  const staging = await mkdtemp(join(dirname(target), '.youtube-sites-'));
  const prepared = join(staging, 'prepared'), backup = join(staging, 'original');
  let preserveBackup = false;
  try {
    // Copy links as links, then reject all managed links inside the private staging tree.
    await cp(target, prepared, { recursive: true, dereference: false });
    const result = await applySites(prepared);
    await linkSafeRoot(target);
    await preflightTarget(target);
    await rename(target, backup);
    try { await rename(prepared, target); }
    catch (error) {
      try { await rename(backup, target); }
      catch { preserveBackup = true; throw new Error('Sites installation stopped; the original starter is preserved in ' + staging); }
      throw error;
    }
    return result;
  } finally {
    if (!preserveBackup) await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-sites.mjs /absolute/path/to/fresh-sites-checkout');
  await prepareSites(process.argv[2]);
  console.log('Prepared dashboard source. Run the official Sites dependency installer and build workflow.');
}
