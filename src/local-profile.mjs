import { mkdirSync, lstatSync, existsSync, chmodSync, openSync, readFileSync, writeFileSync, closeSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomString } from './crypto.mjs';
import { AppError } from './errors.mjs';

export const defaultProfileDirectory = () => resolve(process.env.YTDASH_HOME || join(homedir(), '.youtube-dashboard'));
const fail = () => new AppError('LOCAL_PROFILE', 'The local profile is unavailable. Check its permissions; no setting values are logged.', 503);

/** Own-user local files are separate from the installed, replaceable plugin. */
export class LocalProfile {
  constructor(directory = defaultProfileDirectory()) {
    this.directory = resolve(directory);
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const info = lstatSync(this.directory);
      if (!info.isDirectory() || info.isSymbolicLink()) throw fail();
      chmodSync(this.directory, 0o700);
      if (!existsSync(this.path('profile.json'))) this.writeNew('profile.json', { version: 1, owner: randomString(), encryptionKey: randomString() });
      const profile = this.read('profile.json');
      if (profile.version !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(profile.owner) || !/^[A-Za-z0-9_-]{43}$/.test(profile.encryptionKey)) throw fail();
    } catch { throw fail(); }
  }
  path(name) { return join(this.directory, name); }
  check(name) {
    if (!existsSync(this.path(name))) return;
    const info = lstatSync(this.path(name));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 65536 && !name.startsWith('dashboard.sqlite')) throw fail();
    chmodSync(this.path(name), 0o600);
  }
  read(name) {
    try {
      this.check(name);
      const fd = openSync(this.path(name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { return JSON.parse(readFileSync(fd, 'utf8')); } finally { closeSync(fd); }
    } catch { throw fail(); }
  }
  writeNew(name, value) {
    try {
      const fd = openSync(this.path(name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { writeFileSync(fd, JSON.stringify(value) + '\n'); } finally { closeSync(fd); }
    } catch { throw fail(); }
  }
  configuration(origin) {
    const profile = this.read('profile.json');
    const google = existsSync(this.path('google.json')) ? this.read('google.json') : {};
    return { publicOrigin: origin, allowLoopbackHttp: true, encryptionKey: profile.encryptionKey, googleClientId: google.googleClientId, googleClientSecret: google.googleClientSecret };
  }
  saveGoogle(value) {
    if (existsSync(this.path('google.json'))) throw new AppError('ALREADY_CONFIGURED', 'Google setup is already saved. Edit your own local google.json to correct it; the encryption key must stay unchanged.', 409);
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 ||
      typeof value.googleClientId !== 'string' || !/^[A-Za-z0-9_.-]{1,256}\.apps\.googleusercontent\.com$/.test(value.googleClientId) ||
      typeof value.googleClientSecret !== 'string' || !/^[\x21-\x7e]{8,2048}$/.test(value.googleClientSecret)) throw new AppError('INVALID_CONFIGURATION', 'Enter the Web application client ID and client secret from your own Google project.');
    this.writeNew('google.json', { version: 1, ...value });
    return { configured: true, version: 1 };
  }
  owner() { return this.read('profile.json').owner; }
}
