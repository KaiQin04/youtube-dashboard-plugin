import { AppError } from './errors.mjs';

/** Bound actual streamed bytes before decoding JSON; portable to Workers and Node. */
export async function readJson(response, maxBytes = 2_000_000) {
  const reader = response.body?.getReader();
  if (!reader) throw new AppError('UPSTREAM_INVALID', 'The provider returned an invalid response.', 502);
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error();
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    await reader.cancel().catch(() => {});
    throw new AppError('UPSTREAM_INVALID', 'The provider returned an invalid response.', 502);
  } finally { reader.releaseLock(); }
}
