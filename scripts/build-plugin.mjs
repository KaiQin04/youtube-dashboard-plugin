import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, copyFileSync, utimesSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Build an offline-ready local Plugin from explicit sources and the locked jose package. */
export async function buildPlugin({ output = join(root, 'outputs') } = {}) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const dependency = JSON.parse(readFileSync(join(root, 'node_modules/jose/package.json'), 'utf8'));
  if (dependency.version !== lock.packages['node_modules/jose'].version || dependency.version !== manifest.dependencies.jose) throw new Error('Install the exact locked dependency with npm ci --ignore-scripts before packaging.');
  const name = 'youtube-dashboard-plugin-' + manifest.version;
  output = resolve(output); mkdirSync(output, { recursive: true });
  const directory = join(output, name); mkdirSync(directory);
  const files = [];
  function copy(relative) {
    const source = join(root, relative), info = lstatSync(source);
    if (info.isSymbolicLink()) throw new Error('Package sources must not be symlinks.');
    if (info.isDirectory()) { for (const item of readdirSync(source).sort()) copy(join(relative, item)); return; }
    if (!info.isFile()) throw new Error('Invalid package source.');
    const destination = join(directory, relative);
    mkdirSync(dirname(destination), { recursive: true }); copyFileSync(source, destination);
    utimesSync(destination, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    files.push({ path: relative, sha256: createHash('sha256').update(readFileSync(source)).digest('hex') });
  }
  for (const path of [...manifest.files.map(path => path.replace(/\/$/, '')), 'package.json', 'package-lock.json', 'node_modules/jose']) copy(path);
  const archive = join(output, name + '.zip');
  execFileSync('zip', ['-q', '-X', archive, ...files.map(file => file.path)], { cwd: directory, stdio: 'pipe' });
  const checksums = join(output, name + '.checksums.json');
  const archiveSha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(checksums, JSON.stringify({ version: manifest.version, archive: name + '.zip', archiveSha256, files }, null, 2) + '\n');
  return { directory, archive, checksums, archiveSha256, sourceFiles: files.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await buildPlugin(), null, 2));
