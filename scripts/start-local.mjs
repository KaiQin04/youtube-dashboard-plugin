import { mkdirSync, lstatSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SqliteStore } from '../src/store.mjs';
import { DashboardService } from '../src/service.mjs';
import { createWebApp } from '../src/web-app.mjs';
import { localConfiguration, startLoopback } from '../src/local-server.mjs';

// Read only the explicitly configured environment; never import another project's files.
let store, runtime;
try {
  const { config, port } = localConfiguration(process.env);
  process.umask(0o077);
  const directory = fileURLToPath(new URL('../.local/', import.meta.url));
  if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) throw new Error();
  chmodSync(directory, 0o700);
  const database = directory + '/dashboard.sqlite';
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(database + suffix) && (!lstatSync(database + suffix).isFile() || lstatSync(database + suffix).isSymbolicLink())) throw new Error();
  store = new SqliteStore(database); chmodSync(database, 0o600);
  const service = new DashboardService({ store, config });
  runtime = await startLoopback({ port, createHandler: () => createWebApp({ service, config }) });
  console.log('Local dashboard: ' + runtime.url);
  console.log('Credentials are configured on the server. Request logging is disabled.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await runtime.close(); store.close(); process.exit(0); });
} catch {
  await runtime?.close(); store?.close();
  console.error('Local startup failed. Check configuration, file permissions and port availability. No setting values are logged.');
  process.exitCode = 1;
}
