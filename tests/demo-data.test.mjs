import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemo } from '../examples/local-demo.mjs';

test('loopback demo exposes 28 coherent synthetic days and isolated complete widget data', async t => {
  const demo = await startDemo({ port: 0 });
  t.after(() => demo.close());
  async function call(tenant, name, args = {}) {
    const response = await fetch(`${demo.url}/rpc/${tenant}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
    return (await response.json()).result;
  }
  const ids = [];
  for (const tenant of ['a', 'b']) {
    const id = (await call(tenant, 'list_youtube_connections')).structuredContent.connections[0].id;
    ids.push(id);
    const data = (await call(tenant, 'get_youtube_dashboard', { connectionId: id })).structuredContent;
    assert.equal(data.daily.length, 28);
    assert.equal(data.totalVideos, 8);
    assert.equal(data.metrics.views, data.daily.reduce((sum, row) => sum + row.views, 0));
    assert.equal(data.metrics.likes, data.daily.reduce((sum, row) => sum + row.likes, 0));
    assert.equal(data.metrics.averageViewDuration, 270);
    assert.ok(data.metrics.views > 10000);
    assert.ok(data.videoTables.views.every(video => video.title.startsWith('合成示範')));
    assert.ok(Object.values(data.reports).every(report => report.status === 'available'));
    for (const preset of data.presets) {
      const saved = await call(tenant, 'update_dashboard_layout', { connectionId: id, layout: preset.layout });
      assert.equal(saved.isError, undefined);
      assert.equal(saved.structuredContent.version, 2);
    }
  }
  assert.equal((await call('b', 'get_youtube_dashboard', { connectionId: ids[0] })).structuredContent.error.code, 'NOT_FOUND');
});
