import { THEMES } from './themes.mjs';
import { REPORTS as REPORT_DEFINITIONS } from './dashboard/report-catalog.mjs';

export const METRICS = [
  ['views', '觀看次數', '次', 0, true, '期間觀看次數，包含頻道全部內容。'],
  ['watchHours', '觀看時間', '小時', 1, true, 'YouTube 觀看分鐘換算成小時。'],
  ['subscribersNet', '訂閱淨增', '人', 0, true, '新增訂閱減去流失訂閱，可為負數。'],
  ['subscribersGained', '新增訂閱', '人', 0, true, '頻道全部訂閱來源，與影片觀看頁歸因不同。'],
  ['subscribersLost', '流失訂閱', '人', 0, true, '期間取消訂閱次數。'],
  ['averageViewDuration', '平均觀看時間', '秒', 0, false, 'YouTube 原生期間平均，不能以每日平均再平均。'],
  ['engagedViews', '參與觀看次數', '次', 0, false, 'YouTube engagedViews 原生期間指標。'],
  ['likes', '按讚次數', '次', 0, true, '期間互動報表；不是影片累積按讚數。'],
  ['comments', '留言次數', '次', 0, true, '期間留言互動數，沒有留言內容或留言者資料。'],
  ['shares', '分享次數', '次', 0, true, '透過 YouTube 分享功能產生的次數。'],
  ['videoCount', '已同步影片', '支', 0, false, '快照內可存取 uploads 的數量，並非期間新發布數。'],
].map(([id, label, unit, decimals, trend, note]) => ({ id, label, unit, decimals, trend, note }));
export const REPORTS = REPORT_DEFINITIONS.filter(report=>['trafficSources','countries','devices','subscriptionStatus'].includes(report.id)).map(report=>({id:report.id,label:report.label,dimension:report.dimensions[0]}));
export const VIDEO_COLUMNS = [
  { id: 'views', label: '觀看次數' }, { id: 'watchHours', label: '觀看小時' },
  { id: 'subscribersNet', label: '訂閱淨增' }, { id: 'subscribersGained', label: '新增訂閱' },
  { id: 'subscribersLost', label: '流失訂閱' }, { id: 'publishedAt', label: '發布日期' },
  { id: 'durationSeconds', label: '影片長度（秒）' },
];
export const VIDEO_SORTS = ['views', 'watchHours', 'subscribersNet', 'publishedAt'];
export function dashboardCatalog() {
  return structuredClone({ themes: THEMES, metrics: METRICS, reports: REPORTS, videoColumns: VIDEO_COLUMNS, videoSorts: VIDEO_SORTS,
    limits: { widgets: 16, videos: 20, breakdownRows: 20 },
    unavailable: [
      { id: 'revenue', label: '收益與廣告成效', reason: 'additional_scope_required', note: '需要額外 monetary scope 與頻道資格，目前不要求此權限。' },
      { id: 'realtime', label: 'Studio 即時 48 小時', reason: 'not_available_in_this_connector', note: '本版使用已完成日期的 Analytics 報表。' },
      { id: 'advanced', label: '縮圖曝光與 CTR', reason: 'not_implemented', note: '需 Reporting API 批次流程，目前尚未匯入，不以其他欄位估算。' },
    ] });
}
