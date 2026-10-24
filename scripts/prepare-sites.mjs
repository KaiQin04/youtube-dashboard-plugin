import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
const overlays = ['app', 'db', 'drizzle', 'drizzle.config.ts', 'lib', 'scripts', 'public', 'vendor'];

/** Apply this dashboard to a fresh official Sites Vinext starter. */
export async function prepareSites(directory) {
  const target = resolve(directory);
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-sites.mjs /absolute/path/to/fresh-sites-checkout');
  await prepareSites(process.argv[2]);
  console.log('Prepared dashboard source. Run the official Sites dependency installer and build workflow.');
}
