import assert from 'node:assert/strict';

/** Simulate the owner obtaining a fresh link through trusted stdio, never a public GET. */
export async function localBrowser(runtime) {
  const opened = await runtime.rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_youtube_dashboard', arguments: {} } });
  const launch = new URL(opened.result.structuredContent.url);
  assert.equal(launch.origin, runtime.url);
  const token = new URLSearchParams(launch.hash.slice(1)).get('access');
  const response = await fetch(runtime.url + '/api/local/unlock', { method: 'POST', headers: { origin: runtime.url, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(response.status, 200);
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  const session = await (await fetch(runtime.url + '/api/session', { headers: { cookie } })).json();
  return { cookie, session };
}
