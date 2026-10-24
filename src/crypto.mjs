import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { AppError } from './errors.mjs';

export const randomString = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = value => createHash('sha256').update(value).digest('base64url');

/** Authenticated encryption binds every payload to a tenant, connection and purpose. */
export class Vault {
  #key;
  constructor(key) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) throw new AppError('CONFIGURATION', 'A server-only 256-bit encryption key is required.', 503);
    this.#key = Buffer.from(key, 'base64url');
    if (this.#key.length !== 32) throw new AppError('CONFIGURATION', 'A server-only 256-bit encryption key is required.', 503);
  }
  seal(value, context) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(['dashboard-v1', ...context])));
    const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return JSON.stringify({ v: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), data: data.toString('base64url') });
  }
  open(value, context) {
    try {
      const envelope = JSON.parse(value);
      if (envelope.v !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(envelope.iv, 'base64url'));
      decipher.setAAD(Buffer.from(JSON.stringify(['dashboard-v1', ...context])));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64url')), decipher.final()]).toString('utf8'));
    } catch { throw new AppError('STORED_AUTHORIZATION_INVALID', 'Stored authorization could not be verified.', 503); }
  }
}
