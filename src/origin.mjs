import { AppError } from './errors.mjs';

/** HTTP is allowed only through an explicit opt-in on numeric IPv4 loopback. */
export function applicationOrigin(config) {
  let url;
  try { url = new URL(config.publicOrigin); } catch { throw new AppError('CONFIGURATION', 'Configure an exact application origin.', 503); }
  const local = config.allowLoopbackHttp === true && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port);
  if ((!local && url.protocol !== 'https:') || url.origin !== config.publicOrigin || url.username || url.password) throw new AppError('CONFIGURATION', 'Configure HTTPS, or explicitly enable numeric loopback HTTP for local use.', 503);
  return { url, local };
}
