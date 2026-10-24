import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeSnapshotAdapter } from '../src/analytics/youtube.mjs';
import { validateLayout, defaultLayout } from '../src/layout.mjs';

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa';

test('one layout contract preserves report, retention and source-video blocks', () => {
  const layout = { ...defaultLayout(), headerName: 'Synthetic workspace', widgets: [
    { id: 'sources', kind: 'report', report: 'relatedVideos', metric: 'views', chart: 'bar', width: 'half' },
    { id: 'retention', kind: 'report', report: 'retention', metric: 'audienceWatchRatio', chart: 'line', videoId: 'abcdefghijk', width: 'full' },
  ] };
  assert.deepEqual(validateLayout(layout), layout);
  assert.throws(() => validateLayout({ ...layout, widgets: [{ ...layout.widgets[1], videoId: '<script>' }] }), { code: 'INVALID_LAYOUT' });
  assert.throws(() => validateLayout({ ...layout, widgets: [] }), error => error.code === 'INVALID_LAYOUT' && error.message.includes('supported display settings'));
});

test('the shared adapter reads advanced source reports without changing the owning channel', async () => {
  const requests = [];
  const adapter = new YouTubeSnapshotAdapter({ channelId, tokenStore: { getAccessToken: async () => 'synthetic-access' }, fetchImpl: async input => {
    const url = new URL(input); requests.push(url);
    if (url.pathname === '/v2/reports') return Response.json({ columnHeaders: ['insightTrafficSourceDetail', 'views', 'engagedViews', 'estimatedMinutesWatched'].map(name => ({ name })), rows: [['abcdefghijk', 12, 10, 24]] });
    assert.equal(url.pathname, '/youtube/v3/videos');
    assert.equal(url.searchParams.get('id'), 'abcdefghijk');
    return Response.json({ items: [{ id: 'abcdefghijk', snippet: { title: 'Synthetic source', thumbnails: { medium: { url: 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg' } } } }] });
  } });
  const report = await adapter.readDashboardReport({ reportId: 'relatedVideos', startDate: '2026-10-20', endDate: '2026-10-20' });
  assert.equal(report.sourceVideos[0].title, 'Synthetic source');
  assert.equal(report.sourceVideos[0].thumbnailUrl, 'https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg');
  assert.equal(requests[0].searchParams.get('ids'), 'channel==' + channelId);
  assert.equal(adapter.channelId, channelId);
});

test('compatibility OAuth reads an existing encrypted grant without rewriting it or contacting Google', async () => {
  const { OAuthService } = await import('../src/compat/oauth.mjs');
  const { encryptToken, GOOGLE_SCOPES } = await import('../src/compat/security.mjs');
  const config = { allowedAppUserId: 'synthetic-owner', channelId, clientId: 'synthetic-client', clientSecret: 'synthetic-secret', tokenEncryptionKey: 'A'.repeat(43), publicOrigin: 'https://owner.example', redirectUri: 'https://owner.example/oauth/google/callback', grantContextPrefix: 'legacy-v1' };
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32), 'AES-GCM', false, ['encrypt']);
  const iv = new Uint8Array(12); crypto.getRandomValues(iv);
  const value = { accessToken: 'synthetic-saved-access', refreshToken: 'synthetic-saved-refresh', expiresAt: 999999, scope: GOOGLE_SCOPES.join(' ') };
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('legacy-v1:synthetic-owner:' + channelId) }, key, new TextEncoder().encode(JSON.stringify(value)));
  const envelope = JSON.stringify({ v: 1, iv: Buffer.from(iv).toString('base64url'), data: Buffer.from(encrypted).toString('base64url') });
  let writes = 0;
  const store = { readGrant: async (owner, channel) => owner === config.allowedAppUserId && channel === channelId ? envelope : null, saveGrant: async () => { writes++; } };
  const service = new OAuthService({ config, store, now: () => 1000, fetchImpl: () => { throw new Error('No network allowed'); } });
  assert.equal(await service.getAccessToken(channelId), value.accessToken);
  assert.equal(writes, 0);
  assert.equal(await store.readGrant(config.allowedAppUserId, channelId), envelope);
  await assert.rejects(service.getAccessToken('UCbbbbbbbbbbbbbbbbbbbbbb'));
  const other = new OAuthService({ config: { ...config, grantContextPrefix: 'different-v1' }, store, now: () => 1000 });
  await assert.rejects(other.getAccessToken(channelId), { code: 'TOKEN_DECRYPTION_FAILED' });
  assert.equal(writes, 0);
  assert.equal(typeof encryptToken, 'function');
});
