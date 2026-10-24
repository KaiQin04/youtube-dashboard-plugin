import { AppError } from './security.mjs';

const CHANNEL = /^UC[A-Za-z0-9_-]{22}$/;
const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const COMMENT = /^[A-Za-z0-9._-]{1,512}$/;
const ORIGIN = 'https://www.googleapis.com';
const SOURCE = 'YouTube Data API v3: published commentThreads.list + comments.list';
const COMMENT_FIELDS = 'id,snippet(videoId,parentId,textDisplay,publishedAt,updatedAt,likeCount,moderationStatus)';
const fail = () => new AppError('INVALID_UPSTREAM_DATA', 'YouTube returned invalid comment data.', 502);

function bounded(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError('INVALID_LIMIT', `${name} must be ${min}–${max}.`);
  return value;
}
function nextToken(data) {
  if (data.nextPageToken === undefined) return null;
  if (typeof data.nextPageToken !== 'string' || !data.nextPageToken || data.nextPageToken.length > 512 || /[\x00-\x20\x7f]/.test(data.nextPageToken)) throw fail();
  return data.nextPageToken;
}
function page(data, limit) {
  if (!data || !Array.isArray(data.items) || data.items.length > limit) throw fail();
  return { items: data.items, next: nextToken(data) };
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw fail();
  return new Date(value).toISOString();
}
function comment(item, { videoId, parentId }) {
  const s = item?.snippet;
  if (!COMMENT.test(item?.id ?? '') || !s || (s.videoId !== undefined && s.videoId !== videoId) || (s.parentId ?? null) !== parentId) throw fail();
  // Do not surface non-public content even if an upstream response includes it.
  if (s.moderationStatus !== undefined && s.moderationStatus !== 'published') return null;
  if (typeof s.textDisplay !== 'string' || s.textDisplay.length > 20_000 || !Number.isSafeInteger(s.likeCount) || s.likeCount < 0) throw fail();
  const publishedAt = timestamp(s.publishedAt), updatedAt = timestamp(s.updatedAt);
  if (updatedAt < publishedAt) throw fail();
  // Deliberately no author name, author channel, avatar, or profile URL.
  return { id: item.id, parentId, text: s.textDisplay, publishedAt, updatedAt, likeCount: s.likeCount };
}
function boundedText(value, maxBytes) {
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return { text: value, bytes: bytes.byteLength, truncated: false };
  // Trim only the incomplete final code point, never insert a replacement character.
  for (let end = maxBytes; end >= Math.max(0, maxBytes - 3); end--) {
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, end)), bytes: end, truncated: true }; } catch {}
  }
  throw fail();
}

/** Bound bytes while consuming the stream, not after an unbounded response.text(). */
async function readJson(response, maxBytes) {
  const length = response.headers?.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) { try { await response.body?.cancel(); } catch {} throw fail(); }
  try {
    if (!response.body?.getReader) {
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > maxBytes) throw fail();
      return JSON.parse(raw);
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let bytes = 0, raw = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { try { await reader.cancel(); } catch {} throw fail(); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      return JSON.parse(raw + decoder.decode());
    } finally { reader.releaseLock(); }
  } catch { throw fail(); }
}

/**
 * Server-only, fixed-channel reader. Uses the existing youtube.readonly grant.
 * No writes, moderation calls, author identities, token persistence, or raw errors.
 * Limits count Data API requests made here (including videos.list), not OAuth refresh.
 */
export class YouTubeCommentsReader {
  constructor({ channelId, tokenStore, fetchImpl = globalThis.fetch.bind(globalThis), now = () => new Date(), maxRequests = 20, maxComments = 200, maxThreadPages = 5, maxTextBytes = 262144 }) {
    if (!CHANNEL.test(channelId ?? '')) throw new AppError('UNBOUND_CHANNEL', 'A canonical fixed channel is required.');
    if (!tokenStore || typeof tokenStore.getAccessToken !== 'function') throw new AppError('OAUTH_NOT_CONNECTED', 'Server-side token provider is required.', 503);
    bounded(maxRequests, 2, 50, 'Request limit');
    bounded(maxComments, 1, 5000, 'Comment limit');
    bounded(maxThreadPages, 1, 20, 'Thread-page limit');
    bounded(maxTextBytes, 1, 262144, 'Text-byte limit');
    Object.assign(this, { channelId, tokenStore, fetchImpl, now, maxRequests, maxComments, maxThreadPages, maxTextBytes });
  }

  async #get(resource, params, context) {
    // No caller-provided path or origin can reach fetch.
    if (!['videos', 'commentThreads', 'comments'].includes(resource) || context.requests >= context.maxRequests) throw new AppError('REQUEST_LIMIT', 'The bounded YouTube request limit was reached.');
    const url = new URL(`/youtube/v3/${resource}`, ORIGIN);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    context.requests++;
    let response;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${context.token}`, Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    } catch { throw new AppError('UPSTREAM_UNAVAILABLE', 'YouTube comments are temporarily unavailable.', 502); }
    if (response.redirected) throw new AppError('UPSTREAM_UNAVAILABLE', 'YouTube comments are temporarily unavailable.', 502);
    if (!response.ok) {
      let reasons = [];
      // Only inspect an allowlisted reason, never return Google's message or body.
      if (response.status === 403 && resource === 'commentThreads') {
        try { const error = await readJson(response, 16_384); reasons = Array.isArray(error?.error?.errors) ? error.error.errors.map(e => e?.reason) : []; } catch {}
      }
      if (reasons.includes('commentsDisabled')) throw new AppError('COMMENTS_DISABLED', 'Public comments are disabled for this video.', 409);
      const code = response.status === 401 ? 'REAUTH_REQUIRED' : response.status === 403 ? 'UPSTREAM_FORBIDDEN' : response.status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE';
      throw new AppError(code, 'YouTube comments could not be read; verify authorization, availability, or quota.', 502);
    }
    return readJson(response, 2_000_000);
  }

  async fetchComments({ videoId, channelId = this.channelId, maxComments = this.maxComments, maxRequests = this.maxRequests, maxThreadPages = this.maxThreadPages } = {}) {
    if (channelId !== this.channelId) throw new AppError('CHANNEL_MISMATCH', 'Comments cannot be read for another channel.', 403);
    if (!VIDEO.test(videoId ?? '')) throw new AppError('INVALID_VIDEO_ID', 'A canonical video ID is required.');
    // Per-call limits may lower, but never expand, the configured server ceilings.
    bounded(maxComments, 1, this.maxComments, 'Comment limit');
    bounded(maxRequests, 2, this.maxRequests, 'Request limit');
    bounded(maxThreadPages, 1, this.maxThreadPages, 'Thread-page limit');
    const fetchedAt = new Date(this.now());
    if (!Number.isFinite(fetchedAt.getTime())) throw new AppError('INVALID_CLOCK', 'A valid clock is required.');
    let token;
    try { token = await this.tokenStore.getAccessToken(this.channelId); } catch { throw new AppError('REAUTH_REQUIRED', 'Google authorization is unavailable; reconnect the owner account.', 503); }
    if (typeof token !== 'string' || !token || token.length > 16384 || /[\r\n]/.test(token)) throw new AppError('OAUTH_NOT_CONNECTED', 'No valid server-side Google connection.', 503);
    const context = { token, requests: 0, maxRequests };

    // A valid ID alone is not authorization: verify its fixed channel before comments.
    const video = await this.#get('videos', { part: 'snippet', id: videoId, fields: 'items(id,snippet(channelId))' }, context);
    if (!Array.isArray(video?.items) || video.items.length > 1) throw fail();
    if (video.items.length === 0) throw new AppError('VIDEO_UNAVAILABLE', 'The video is unavailable to the authorized account.', 404);
    if (video.items[0]?.id !== videoId) throw fail();
    if (video.items[0]?.snippet?.channelId !== this.channelId) throw new AppError('CHANNEL_MISMATCH', 'The video does not belong to the configured channel.', 403);

    const comments = [], seenComments = new Set(), threadTokens = new Set(), threads = [];
    let threadPageToken = null, threadPaginationComplete = false, threadPages = 0, replyPages = 0, excludedNonPublic = 0, commentsDisabled = false, returnedTextBytes = 0, textTruncatedCommentCount = 0;
    const canRead = () => context.requests < maxRequests && comments.length < maxComments && returnedTextBytes < this.maxTextBytes && textTruncatedCommentCount === 0;
    const append = value => {
      if (value === null) { excludedNonPublic++; return; }
      if (seenComments.has(value.id)) throw fail();
      const text = boundedText(value.text, this.maxTextBytes - returnedTextBytes);
      returnedTextBytes += text.bytes;
      if (text.truncated) textTruncatedCommentCount++;
      seenComments.add(value.id); comments.push({ ...value, text: text.text, ...(text.truncated ? { textTruncated: true } : {}) });
    };

    while (canRead() && threadPages < maxThreadPages && !threadPaginationComplete) {
      const pageSize = Math.min(100, maxComments - comments.length);
      let data;
      try {
        data = await this.#get('commentThreads', { part: 'snippet', videoId, maxResults: pageSize, moderationStatus: 'published', order: 'time', textFormat: 'plainText', fields: `nextPageToken,items(id,snippet(channelId,videoId,totalReplyCount,topLevelComment(${COMMENT_FIELDS})))`, ...(threadPageToken ? { pageToken: threadPageToken } : {}) }, context);
      } catch (error) {
        if (error?.code !== 'COMMENTS_DISABLED') throw error;
        commentsDisabled = true;
        break;
      }
      const current = page(data, pageSize);
      threadPages++;
      if (current.next && (current.next === threadPageToken || threadTokens.has(current.next))) throw fail();
      if (current.next) threadTokens.add(current.next);
      threadPageToken = current.next;
      threadPaginationComplete = current.next === null;
      const selected = [];
      for (const item of current.items) {
        const snippet = item?.snippet;
        if (snippet?.channelId !== this.channelId || snippet?.videoId !== videoId) throw fail();
        if (!Number.isSafeInteger(snippet.totalReplyCount) || snippet.totalReplyCount < 0) throw fail();
        const top = comment(snippet.topLevelComment, { videoId, parentId: null });
        append(top);
        if (!top) continue;
        const state = { parentId: top.id, reportedReplyCount: snippet.totalReplyCount, repliesReturned: 0, pagesFetched: 0, paginationComplete: snippet.totalReplyCount === 0, nextPageToken: null, countChanged: false };
        threads.push(state); selected.push(state);
      }
      for (const state of selected) {
        const replyTokens = new Set();
        while (!state.paginationComplete && canRead()) {
          const replyPageSize = Math.min(100, maxComments - comments.length);
          // Embedded replies are intentionally never used: they can be incomplete.
          const replies = page(await this.#get('comments', { part: 'snippet', parentId: state.parentId, maxResults: replyPageSize, textFormat: 'plainText', fields: `nextPageToken,items(${COMMENT_FIELDS})`, ...(state.nextPageToken ? { pageToken: state.nextPageToken } : {}) }, context), replyPageSize);
          replyPages++; state.pagesFetched++;
          if (replies.next && (replies.next === state.nextPageToken || replyTokens.has(replies.next))) throw fail();
          if (replies.next) replyTokens.add(replies.next);
          for (const item of replies.items) {
            const value = comment(item, { videoId, parentId: state.parentId });
            append(value);
            if (value) state.repliesReturned++;
          }
          state.nextPageToken = replies.next;
          state.paginationComplete = replies.next === null;
          if (state.paginationComplete) state.countChanged = state.repliesReturned !== state.reportedReplyCount;
        }
      }
    }

    const pendingReplies = threads.filter(t => !t.paginationComplete);
    const countChanged = threads.some(t => t.countChanged);
    const pending = !threadPaginationComplete || pendingReplies.length > 0;
    const reasons = [];
    if (commentsDisabled) reasons.push('comments_disabled');
    if (pending && context.requests >= maxRequests) reasons.push('request_limit');
    if (pending && comments.length >= maxComments) reasons.push('comment_limit');
    if (textTruncatedCommentCount > 0 || (pending && returnedTextBytes >= this.maxTextBytes)) reasons.push('text_byte_limit');
    if (!threadPaginationComplete && threadPages >= maxThreadPages) reasons.push('thread_page_limit');
    if (countChanged) reasons.push('reply_count_changed');
    if (excludedNonPublic) reasons.push('non_public_items_excluded');
    const complete = !commentsDisabled && !pending && !countChanged && excludedNonPublic === 0 && textTruncatedCommentCount === 0;
    return {
      mode: 'real', source: SOURCE, channelId, videoId, fetchedAt: fetchedAt.toISOString(), comments,
      coverage: {
        status: commentsDisabled ? 'disabled' : complete ? 'complete' : 'partial',
        scope: 'Published comments for this verified video only; not channel-wide and not moderation data.',
        threadOrder: 'time', maxPageSize: 100,
        limits: { maxRequests, maxComments, maxThreadPages, maxTextBytes: this.maxTextBytes }, requestsMade: context.requests,
        requestCountScope: 'Data API requests made by this reader, including video verification; excludes OAuth token refresh.',
        threadPagesFetched: threadPages, replyPagesFetched: replyPages,
        topLevelCommentsReturned: threads.length, repliesReturned: comments.length - threads.length,
        threadPaginationComplete, repliesForSelectedThreadsComplete: pendingReplies.length === 0 && !countChanged,
        allAvailablePublicCommentsFetched: complete, truncated: !complete, commentsDisabled,
        reasons, excludedNonPublic, returnedTextBytes, textTruncatedCommentCount, textComplete: textTruncatedCommentCount === 0, threads,
        completenessMeaning: 'Complete means the observed public API pages were exhausted and reply counts agreed during this read, not an immutable snapshot. Zero reported replies are not separately queried. Hidden, deleted, held-for-review, and spam comments are not covered.',
      },
      continuation: {
        nextThreadPageToken: threadPaginationComplete ? null : threadPageToken,
        pendingReplies: pendingReplies.map(t => ({ parentId: t.parentId, pageToken: t.nextPageToken, started: t.pagesFetched > 0 })),
        restartRequired: countChanged || excludedNonPublic > 0 || commentsDisabled || textTruncatedCommentCount > 0,
        note: 'Cursors describe unfinished API pagination, not an input accepted by this operation. Another call starts a new bounded read; API pages and counts can change.',
      },
    };
  }
}
