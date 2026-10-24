import { CHANNEL_A, CHANNEL_B, googleFixture } from './synthetic-fixtures.mjs';

const EPOCH = Date.parse('2026-09-01T00:00:00Z');
const labels = ['第一次讀懂頻道數據', '觀眾從哪裡找到內容', '把研究說成一個故事', '一張圖解釋複雜觀念', '影片開場的三種寫法', '從留言找下一個題目', '建立可持續的創作節奏', '本月內容實驗回顧'];
const videoIds = channel => labels.map((_, index) => (channel === CHANNEL_A ? 'a' : 'b') + String(index).padStart(10, '0'));
function days(start, end) {
  const result = [];
  for (let time = Date.parse(start); time <= Date.parse(end); time += 86400000) result.push(new Date(time).toISOString().slice(0, 10));
  return result;
}
function daily(date, channel, videoIndex) {
  const day = Math.round((Date.parse(date) - EPOCH) / 86400000);
  const views = (180 + (day * 31 + videoIndex * 59) % 400 + Math.round(220 * (1 + Math.sin(day / 3)))) * (channel === CHANNEL_A ? 1 : 2);
  return { views, estimatedMinutesWatched: views * 4.5, subscribersGained: Math.floor(views / 140), subscribersLost: (day + videoIndex) % 3, likes: Math.floor(views * .04), comments: Math.floor(views * .006), shares: Math.floor(views * .009), engagedViews: views };
}
function total(rows) {
  return Object.fromEntries(Object.keys(rows[0]).map(key => [key, rows.reduce((sum, row) => sum + row[key], 0)]));
}
const table = (columns, rows) => Response.json({ columnHeaders: columns.map(name => ({ name })), rows });

/** Rich deterministic demo fixture. Delegates identity checks to the synthetic Google boundary. */
export function dashboardDemoFixture() {
  const base = googleFixture();
  return { control: base.control, fetch: async (input, options = {}) => {
    const url = new URL(input), params = url.searchParams;
    if (url.origin === 'https://www.googleapis.com' && ['/youtube/v3/playlistItems', '/youtube/v3/videos'].includes(url.pathname)) {
      const identity = await base.fetch('https://www.googleapis.com/youtube/v3/channels?mine=true', options);
      if (!identity.ok) return identity;
      const owned = (await identity.json()).items.map(item => item.id);
      if (url.pathname.endsWith('/playlistItems')) {
        const channel = 'UC' + (params.get('playlistId') ?? '').slice(2);
        if (!owned.includes(channel)) return new Response('', { status: 403 });
        return Response.json({ items: videoIds(channel).map(videoId => ({ contentDetails: { videoId } })) });
      }
      const requested = (params.get('id') ?? '').split(',');
      const items = owned.flatMap(channel => videoIds(channel).filter(id => requested.includes(id)).map(id => {
        const index = Number(id.slice(1));
        return { id, snippet: { channelId: channel, title: `合成示範 ${channel === CHANNEL_A ? 'A' : 'B'} · ${labels[index]}`, publishedAt: `2026-08-${String(index + 10).padStart(2, '0')}T08:00:00Z` }, contentDetails: { duration: `PT${8 + index}M30S` } };
      }));
      return Response.json({ items });
    }
    if (url.origin !== 'https://youtubeanalytics.googleapis.com' || url.pathname !== '/v2/reports') return base.fetch(input, options);
    const authorization = await base.fetch(input, options);
    if (!authorization.ok) return authorization;
    const channel = (params.get('ids') ?? '').replace('channel==', '');
    if (![CHANNEL_A, CHANNEL_B].includes(channel)) return new Response('', { status: 403 });
    const all = videoIds(channel), filter = params.get('filters')?.replace('video==', ''), indices = filter ? [all.indexOf(filter)] : all.map((_, index) => index);
    if (indices.includes(-1)) return new Response('', { status: 403 });
    const dates = days(params.get('startDate'), params.get('endDate')).filter(date => date <= '2026-10-20');
    const rows = dates.map(date => ({ date, values: total(indices.map(index => daily(date, channel, index))) }));
    const metrics = params.get('metrics').split(','), dimension = params.get('dimensions');
    if (dimension === 'day') return table(['day', ...metrics], rows.map(row => [row.date, ...metrics.map(key => row.values[key])]));
    const totals = total(rows.map(row => row.values)); totals.averageViewDuration = 270;
    if (!dimension) return table(metrics, [metrics.map(key => totals[key])]);
    const categories = { country: ['TW', 'HK', 'US', 'JP'], deviceType: ['MOBILE', 'DESKTOP', 'TV', 'TABLET'], insightTrafficSourceType: ['SUBSCRIBER', 'YT_SEARCH', 'RELATED_VIDEO', 'EXT_URL'], subscribedStatus: ['UNSUBSCRIBED', 'SUBSCRIBED'] }[dimension];
    if (!categories) throw new Error('Unexpected demo report dimension');
    const weights = categories.length === 2 ? [.65, .35] : [.55, .25, .15, .05];
    const values = weights.map(weight => Math.floor(totals.views * weight));
    values[0] += totals.views - values.reduce((sum, value) => sum + value, 0);
    return table([dimension, ...metrics], categories.map((label, index) => [label, ...metrics.map(key => key === 'views' ? values[index] : values[index] * 4.5)]));
  } };
}
