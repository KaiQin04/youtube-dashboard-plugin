import { createServer } from 'node:http';
import { AppError } from './errors.mjs';
import { applicationOrigin } from './origin.mjs';
import { Vault } from './crypto.mjs';

/** Parse explicitly supplied local settings without returning them in diagnostics. */
export function localConfiguration(env) {
  try {
    const config = { publicOrigin: env.PUBLIC_ORIGIN, allowLoopbackHttp: true,
      googleLoginClientId: env.GOOGLE_LOGIN_CLIENT_ID, googleLoginClientSecret: env.GOOGLE_LOGIN_CLIENT_SECRET,
      googleClientId: env.GOOGLE_CLIENT_ID, googleClientSecret: env.GOOGLE_CLIENT_SECRET, encryptionKey: env.TOKEN_ENCRYPTION_KEY };
    const { url, local } = applicationOrigin(config);
    if (!local || Number(url.port) < 1024 || [config.googleLoginClientId, config.googleLoginClientSecret, config.googleClientId, config.googleClientSecret].some(value => typeof value !== 'string' || !value.trim())) throw new Error();
    new Vault(config.encryptionKey);
    return { config, port: Number(url.port) };
  } catch { throw new AppError('LOCAL_CONFIGURATION', 'Complete the independent local configuration; no setting values are logged.', 503); }
}

/** Loopback-only HTTP adapter. It never logs requests, cookies, queries or provider errors. */
export async function startLoopback({ port = 4318, createHandler }) {
  let handler, origin;
  const server = createServer({ requestTimeout: 30000, headersTimeout: 10000, keepAliveTimeout: 5000, maxHeaderSize: 32768 }, async (incoming, outgoing) => {
    outgoing.setHeader('Cache-Control', 'no-store'); outgoing.setHeader('Referrer-Policy', 'no-referrer'); outgoing.setHeader('X-Content-Type-Options', 'nosniff');
    const deny = status => { outgoing.writeHead(status); outgoing.end(); incoming.resume(); };
    if (incoming.headers.host !== new URL(origin).host || incoming.headers.origin && incoming.headers.origin !== origin || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) { deny(403); return; }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of incoming) { size += chunk.length; if (size > 65536) { deny(413); return; } chunks.push(chunk); }
      const method = incoming.method;
      const request = new Request(origin + incoming.url, { method, headers: incoming.headers, ...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) });
      const response = await handler(request);
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) if (key !== 'set-cookie') outgoing.setHeader(key, value);
      const cookies = response.headers.getSetCookie(); if (cookies.length) outgoing.setHeader('Set-Cookie', cookies);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch { if (!outgoing.headersSent) outgoing.writeHead(500); outgoing.end('Local request failed.'); }
  });
  server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  try { handler = createHandler(origin); } catch (error) { server.close(); throw error; }
  return { url: origin, close: () => new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }) };
}
