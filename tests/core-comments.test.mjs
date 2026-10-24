import test from 'node:test';
import assert from 'node:assert/strict';
import { YouTubeCommentsReader } from '../src/analytics/comments.mjs';
import { safeError } from '../src/analytics/security.mjs';

const channelId = 'UCaaaaaaaaaaaaaaaaaaaaaa', otherChannel = 'UCbbbbbbbbbbbbbbbbbbbbbb', videoId = 'abcdefghijk';
const NOW = new Date('2026-10-23T02:00:00Z');
const SECRET = 'test-token-never-public';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const metadata = { items: [{ id: videoId, snippet: { channelId } }] };
function comment(id, parentId = null, extra = {}) {
  return { id, snippet: { videoId, ...(parentId ? { parentId } : {}), textDisplay: `Plain text ${id}`, publishedAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T01:00:00Z', likeCount: 2, authorDisplayName: 'private-author-name', authorChannelId: { value: 'private-author-channel' }, authorChannelUrl: 'https://author.example/profile', authorProfileImageUrl: 'https://author.example/avatar', ...extra } };
}
function thread(id, totalReplyCount = 0, extra = {}) {
  return { id: `thread_${id}`, snippet: { videoId, channelId, totalReplyCount, topLevelComment: comment(id), ...extra }, replies: { comments: [comment('embedded_reply_must_not_be_used', id)] } };
}
function fixture({ videos = metadata, threads = [{ items: [thread('top_1', 2)] }], replies = { top_1: [{ items: [comment('reply_1', 'top_1')], nextPageToken: 'reply_page_2' }, { items: [comment('reply_2', 'top_1')] }] }, config = {}, fetchOverride, tokenStore } = {}) {
  const calls = [], tokens = [], indices = new Map();
  const reader = new YouTubeCommentsReader({ channelId, now: () => NOW, ...config, tokenStore: tokenStore ?? { getAccessToken: async id => { tokens.push(id); return SECRET; } }, fetchImpl: async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    if (fetchOverride) return fetchOverride(url, options, calls.length);
    if (url.pathname.endsWith('/videos')) return videos instanceof Response ? videos : json(videos);
    const parentId = url.searchParams.get('parentId');
    const key = parentId ?? 'threads';
    const index = indices.get(key) ?? 0; indices.set(key, index + 1);
    const result = parentId ? replies[parentId]?.[index] : threads[index];
    assert.notEqual(result, undefined, `Unexpected request ${url.pathname} ${key} ${index}`);
    return result instanceof Response ? result : json(result);
  } });
  return { reader, calls, tokens };
}

test('fully paginates separate replies and thread pages, omitting author metadata and embedded replies', async () => {
  const { reader, calls, tokens } = fixture({ threads: [{ items: [thread('top_1', 2)], nextPageToken: 'threads_page_2' }, { items: [thread('top_2')] }] });
  const result = await reader.fetchComments({ videoId });
  assert.deepEqual(result.comments.map(c => c.id), ['top_1', 'reply_1', 'reply_2', 'top_2']);
  assert.deepEqual(Object.keys(result.comments[0]).sort(), ['id', 'likeCount', 'parentId', 'publishedAt', 'text', 'updatedAt']);
  assert.equal(result.comments[1].parentId, 'top_1');
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.allAvailablePublicCommentsFetched, true);
  assert.equal(result.coverage.truncated, false);
  assert.equal(result.coverage.requestsMade, 5);
  assert.equal(result.coverage.threadPagesFetched, 2);
  assert.equal(result.coverage.replyPagesFetched, 2);
  assert.equal(result.coverage.topLevelCommentsReturned, 2);
  assert.equal(result.coverage.repliesReturned, 2);
  assert.equal(result.continuation.nextThreadPageToken, null);
  assert.deepEqual(result.continuation.pendingReplies, []);
  assert.deepEqual(tokens, [channelId]);
  assert.equal(calls[0].url.pathname, '/youtube/v3/videos');
  assert.equal(calls[3].url.searchParams.get('pageToken'), 'reply_page_2');
  assert.equal(calls[4].url.searchParams.get('pageToken'), 'threads_page_2');
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://www.googleapis.com');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual'); assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, `Bearer ${SECRET}`);
    assert.ok(!url.href.includes(SECRET));
    assert.ok(!url.searchParams.get('fields').includes('author'));
    if (!url.pathname.endsWith('/videos')) assert.equal(url.searchParams.get('textFormat'), 'plainText');
    if (url.pathname.endsWith('/commentThreads')) { assert.equal(url.searchParams.get('moderationStatus'), 'published'); assert.equal(url.searchParams.get('maxResults'), '100'); }
  }
  const serialized = JSON.stringify(result);
  for (const secret of [SECRET, 'private-author-name', 'private-author-channel', 'author.example', 'embedded_reply_must_not_be_used']) assert.ok(!serialized.includes(secret));
});

test('global request cap includes video verification and exposes interrupted reply continuation', async () => {
  const { reader, calls } = fixture({ config: { maxRequests: 3 }, threads: [{ items: [thread('top_1', 2)], nextPageToken: 'threads_page_2' }] });
  const result = await reader.fetchComments({ videoId });
  assert.equal(calls.length, 3);
  assert.equal(result.comments.length, 2);
  assert.equal(result.coverage.allAvailablePublicCommentsFetched, false);
  assert.equal(result.coverage.repliesForSelectedThreadsComplete, false);
  assert.deepEqual(result.coverage.reasons, ['request_limit']);
  assert.equal(result.continuation.nextThreadPageToken, 'threads_page_2');
  assert.deepEqual(result.continuation.pendingReplies, [{ parentId: 'top_1', pageToken: 'reply_page_2', started: true }]);
});

test('global comment cap counts both tops and replies and bounds each requested page', async () => {
  const { reader, calls } = fixture({ config: { maxComments: 2 } });
  const result = await reader.fetchComments({ videoId });
  assert.equal(result.comments.length, 2);
  assert.equal(calls[1].url.searchParams.get('maxResults'), '2');
  assert.equal(calls[2].url.searchParams.get('maxResults'), '1');
  assert.equal(result.coverage.threadPaginationComplete, true);
  assert.equal(result.coverage.status, 'partial');
  assert.deepEqual(result.coverage.reasons, ['comment_limit']);
  assert.equal(result.continuation.pendingReplies[0].pageToken, 'reply_page_2');
});

test('aggregate returned text has a hard UTF-8 byte ceiling with explicit per-comment truncation', async () => {
  const { reader, calls } = fixture({ config: { maxTextBytes: 5 }, threads: [{ items: [thread('top_1', 2, { topLevelComment: comment('top_1', null, { textDisplay: '😊😊 secret tail' }) })], nextPageToken: 'more_threads' }] });
  const result = await reader.fetchComments({ videoId });
  assert.equal(calls.length, 2);
  assert.equal(result.comments[0].text, '😊');
  assert.equal(result.comments[0].textTruncated, true);
  assert.equal(result.coverage.returnedTextBytes, 4);
  assert.equal(result.coverage.textTruncatedCommentCount, 1);
  assert.equal(result.coverage.textComplete, false);
  assert.equal(result.coverage.status, 'partial');
  assert.equal(result.coverage.allAvailablePublicCommentsFetched, false);
  assert.deepEqual(result.coverage.reasons, ['text_byte_limit']);
  assert.equal(result.continuation.restartRequired, true);
  assert.deepEqual(result.continuation.pendingReplies, [{ parentId: 'top_1', pageToken: null, started: false }]);
  assert.ok(!JSON.stringify(result).includes('secret tail'));
  const many = Array.from({ length: 20 }, (_, i) => thread(`top_${i}`, 0, { topLevelComment: comment(`top_${i}`, null, { textDisplay: '中'.repeat(10000) }) }));
  const big = await fixture({ threads: [{ items: many, nextPageToken: 'next_page' }] }).reader.fetchComments({ videoId });
  assert.equal(big.coverage.limits.maxComments, 200);
  assert.equal(big.coverage.limits.maxTextBytes, 262144);
  assert.ok(big.comments.reduce((sum, c) => sum + new TextEncoder().encode(c.text).byteLength, 0) <= 262144);
  assert.ok(big.comments.some(c => c.textTruncated));
  assert.equal(big.coverage.allAvailablePublicCommentsFetched, false);
  assert.equal(big.comments.length, 20);
  assert.throws(() => fixture({ config: { maxTextBytes: 262145 } }));
});

test('cap before any reply page retains all unstarted reply parent IDs', async () => {
  const { reader, calls } = fixture({ config: { maxComments: 2 }, threads: [{ items: [thread('top_1', 1), thread('top_2', 1)] }] });
  const result = await reader.fetchComments({ videoId });
  assert.equal(calls.length, 2);
  assert.deepEqual(result.continuation.pendingReplies, [{ parentId: 'top_1', pageToken: null, started: false }, { parentId: 'top_2', pageToken: null, started: false }]);
  assert.equal(result.coverage.repliesForSelectedThreadsComplete, false);
});

test('thread-page cap does not skip pagination for selected replies', async () => {
  const { reader, calls } = fixture({ config: { maxThreadPages: 1 }, threads: [{ items: [thread('top_1', 2)], nextPageToken: 'threads_page_2' }] });
  const result = await reader.fetchComments({ videoId });
  assert.equal(calls.length, 4);
  assert.equal(result.coverage.repliesForSelectedThreadsComplete, true);
  assert.equal(result.coverage.allAvailablePublicCommentsFetched, false);
  assert.deepEqual(result.coverage.reasons, ['thread_page_limit']);
  assert.equal(result.continuation.nextThreadPageToken, 'threads_page_2');
});

test('an exactly full final result can be complete; empty published results are not disabled', async () => {
  const full = await fixture({ config: { maxComments: 1 }, threads: [{ items: [thread('top_1')] }] }).reader.fetchComments({ videoId });
  assert.equal(full.coverage.allAvailablePublicCommentsFetched, true);
  assert.deepEqual(full.coverage.reasons, []);
  const empty = await fixture({ threads: [{ items: [] }] }).reader.fetchComments({ videoId });
  assert.deepEqual(empty.comments, []);
  assert.equal(empty.coverage.commentsDisabled, false);
  assert.equal(empty.coverage.allAvailablePublicCommentsFetched, true);
});

test('commentsDisabled is explicit unavailability, never a falsely complete empty dataset', async () => {
  const { reader, calls } = fixture({ threads: [json({ error: { message: SECRET, errors: [{ reason: 'commentsDisabled', message: SECRET }] } }, 403)] });
  const result = await reader.fetchComments({ videoId });
  assert.equal(calls.length, 2);
  assert.equal(result.coverage.status, 'disabled');
  assert.equal(result.coverage.commentsDisabled, true);
  assert.equal(result.coverage.allAvailablePublicCommentsFetched, false);
  assert.deepEqual(result.coverage.reasons, ['comments_disabled']);
  assert.ok(!JSON.stringify(result).includes(SECRET));
});

test('foreign and unavailable videos never trigger comment requests', async () => {
  const foreign = fixture({ videos: { items: [{ id: videoId, snippet: { channelId: otherChannel } }] } });
  await assert.rejects(foreign.reader.fetchComments({ videoId }), e => e.code === 'CHANNEL_MISMATCH');
  assert.equal(foreign.calls.length, 1);
  const missing = fixture({ videos: { items: [] } });
  await assert.rejects(missing.reader.fetchComments({ videoId }), e => e.code === 'VIDEO_UNAVAILABLE');
  assert.equal(missing.calls.length, 1);
});

test('channel, video and limit validation fail before token retrieval or external calls', async () => {
  const { reader, calls, tokens } = fixture();
  for (const args of [{ videoId, channelId: otherChannel }, { videoId: 'https://evil.example' }, { videoId, maxComments: 1001 }, { videoId, maxRequests: 21 }, { videoId, maxThreadPages: 6 }, { videoId, maxComments: 0 }, { videoId, maxRequests: 1 }]) await assert.rejects(reader.fetchComments(args));
  assert.equal(calls.length, 0); assert.equal(tokens.length, 0);
  for (const config of [{ maxComments: 5001 }, { maxRequests: 51 }, { maxThreadPages: 21 }]) assert.throws(() => fixture({ config }));
});

test('reply-count races, non-public content and unseen remaining replies cannot be called complete', async () => {
  const changed = await fixture({ replies: { top_1: [{ items: [comment('reply_1', 'top_1')] }] } }).reader.fetchComments({ videoId });
  assert.equal(changed.coverage.allAvailablePublicCommentsFetched, false);
  assert.deepEqual(changed.coverage.reasons, ['reply_count_changed']);
  assert.equal(changed.continuation.restartRequired, true);
  const hidden = await fixture({ replies: { top_1: [{ items: [comment('reply_1', 'top_1'), comment('hidden_reply', 'top_1', { moderationStatus: 'heldForReview', textDisplay: 'private-moderation-text' })] }] } }).reader.fetchComments({ videoId });
  assert.equal(hidden.coverage.allAvailablePublicCommentsFetched, false);
  assert.equal(hidden.coverage.excludedNonPublic, 1);
  assert.ok(!JSON.stringify(hidden).includes('private-moderation-text'));
  assert.ok(!JSON.stringify(hidden).includes('hidden_reply'));
});

test('foreign thread metadata, wrong reply parent, oversized pages and repeated cursors fail closed', async () => {
  const invalid = [
    { threads: [{ items: [thread('top_1', 0, { channelId: otherChannel })] }] },
    { replies: { top_1: [{ items: [comment('reply_1', 'another_parent')] }] } },
    { threads: [{ items: [thread('top_1')], nextPageToken: 'loop' }, { items: [], nextPageToken: 'loop' }] },
    { replies: { top_1: [{ items: [comment('reply_1', 'top_1')], nextPageToken: 'loop' }, { items: [], nextPageToken: 'loop' }] } },
    { threads: [{ items: [thread('top_1'), thread('top_1')] }] },
    { config: { maxComments: 1 }, threads: [{ items: [thread('top_1'), thread('top_2')] }] },
    { threads: [{ items: [thread('top_1', 0, { topLevelComment: comment('top_1', null, { likeCount: -1 }) })] }] },
  ];
  for (const options of invalid) await assert.rejects(fixture(options).reader.fetchComments({ videoId }), e => e.code === 'INVALID_UPSTREAM_DATA');
});

test('network, token, HTTP, redirects and malformed response errors never expose upstream secrets', async () => {
  const failures = [
    async () => { throw Error(SECRET); },
    async () => new Response(SECRET, { status: 401 }),
    async () => new Response(SECRET, { status: 403 }),
    async () => new Response(SECRET, { status: 429 }),
    async () => new Response(SECRET, { status: 302 }),
    async () => new Response(`malformed-${SECRET}`),
    async () => ({ redirected: true, ok: true, text: async () => SECRET }),
    async () => new Response('x'.repeat(2_000_001)),
  ];
  for (const fetchOverride of failures) {
    await assert.rejects(fixture({ fetchOverride }).reader.fetchComments({ videoId }), error => !JSON.stringify(safeError(error)).includes(SECRET) && !error.message.includes(SECRET));
  }
  await assert.rejects(fixture({ tokenStore: { getAccessToken: async () => { throw Error(SECRET); } } }).reader.fetchComments({ videoId }), error => error.code === 'REAUTH_REQUIRED' && !error.message.includes(SECRET));
  const invalid = fixture({ tokenStore: { getAccessToken: async () => `${SECRET}\r\ninjected: value` } });
  await assert.rejects(invalid.reader.fetchComments({ videoId }), error => error.code === 'OAUTH_NOT_CONNECTED');
  assert.equal(invalid.calls.length, 0);
});
