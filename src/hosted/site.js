import {getBrandDefaults} from './core/dashboard/brand-default.mjs';
import {requestLayout} from './customization/layout-http.mjs';
import {defaultLayout} from './customization/layout.mjs';
import {renderWidgets} from './customization/widgets.mjs';
import {bindSourceVideoInteractions} from './customization/source-videos.mjs';
bindSourceVideoInteractions(document);
import {createCustomizer} from './customization/editor.mjs';
import {createReportActions} from './customization/report-actions.mjs';

const TIMEZONE = 'America/Los_Angeles';
const $ = (selector) => document.querySelector(selector);
const icon = (name, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 0) => isNumber(value) ? new Intl.NumberFormat('zh-TW', { maximumFractionDigits: digits }).format(value) : '—';
const signed = (value) => isNumber(value) ? `${value > 0 ? '+' : ''}${number(value)}` : '—';
const duration = (value) => isNumber(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` : '—';
const hours = (minutes) => isNumber(minutes) ? number(minutes / 60, 1) : '—';
const dayOffset = (date, amount) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const displayDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return '—';
  if (value.length === 10) return value.replaceAll('-', '.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).replaceAll('-', '.');
};
const displayTimestamp = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
};
const emptyData = () => ({ status: { mode: 'disconnected', connected: false, completeThrough: null, timezone: TIMEZONE, lastSyncedAt: null, blockers: [] }, summary: {}, videos: [], daily: [], topics: [] });
let connectionReady = false;
let connectionAuthorized = null;
let reconnectRequired = false;
let displayedQuery = null;
const state = {
  tab: ['overview', 'videos', 'topics', 'status'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview',
  demo: false,
  start: dayOffset(today(), -28),
  end: dayOffset(today(), -1),
  days: 28,
  rangeClamped: false,
  search: '',
  topicFilter: 'all',
  sort: 'views',
  releaseAgeDays: 28,
  selectedTopics: new Set(),
  topicsInitialized: false,
  data: emptyData(),
  loading: true,
  error: null,
  syncing: false,
  syncMessage: '',
};
let pendingRequest = null;
let requestSequence = 0;
let toastTimer;
let dashboardLayout = defaultLayout();
const customizer = createCustomizer({
  transport: requestLayout,
  getData:()=>state.data,
  onChange(layout) { dashboardLayout = layout; render(); },
  onNotice: showToast,
  onSessionExpired() {
    state.data = emptyData(); displayedQuery = null; connectionAuthorized = null;
    connectionReady = false; reconnectRequired = false;
    state.error = '私人站登入已失效，請重新登入私人站。'; render();
  },
});
const reportActions=createReportActions({getData:()=>state.demo?null:state.data,getLayout:()=>dashboardLayout,getRange:()=>({startDate:state.start,endDate:state.end}),render,notice:showToast,transport:async(args,refresh)=>{
 const response=await fetch('/api/analytics/reports'+(refresh?'':'?'+new URLSearchParams(args)),{method:refresh?'POST':'GET',credentials:'same-origin',headers:refresh?{'Content-Type':'application/json'}:{},...(refresh?{body:JSON.stringify(args)}:{})});
 if(!response.ok)throw new Error('Report request failed');return response.json();
}});

const pageCopy = {
  overview: ['Channel overview', '頻道總覽', '已保存的頻道資料與每日成效。'],
  videos: ['Video performance', '影片表現', '把每一支影片的表現，放回同一個視野。'],
  topics: ['Comparable cohorts', '主題比較', '在相同的發布天數裡，公平比較不同主題。'],
  status: ['Data provenance', '資料狀態', '知道數據從哪裡來，也知道它的邊界。'],
};

function topicLabel(id) {
  const found = state.data.topics.find((topic) => topic.id === id);
  return found?.label ?? id;
}

function videoTopics(video) {
  return Array.isArray(video.topics) ? video.topics.map((topic) => typeof topic === 'string' ? topic : topic.id ?? topic.label).filter(Boolean) : [];
}

function availableData() {
  return state.demo || state.data.status.hasData === true || (state.data.status.mode === 'real' && Boolean(state.data.status.completeThrough));
}

function normalizeData(value) {
  if (!value || typeof value !== 'object' || !value.status) throw new Error('私人端點尚未提供可辨識的資料格式。');
  return {
    ...value,
    status: { ...emptyData().status, ...value.status },
    summary: value.summary && typeof value.summary === 'object' ? value.summary : {},
    videos: Array.isArray(value.videos) ? value.videos : [],
    daily: Array.isArray(value.daily) ? value.daily : [],
    topics: Array.isArray(value.topics) ? value.topics : [],
  };
}

function effectiveRange() {
  const data = state.data;
  const provided = data.range ?? data.dateRange ?? data.effectiveRange ?? data.summary.dateBounds ?? {};
  const has = (key) => Object.prototype.hasOwnProperty.call(provided, key);
  const start = has('start') ? provided.start : has('effectiveStartDate') ? provided.effectiveStartDate : provided.startDate ?? state.start;
  const end = has('end') ? provided.end : has('effectiveEndDate') ? provided.effectiveEndDate : provided.endDate ?? (data.status.completeThrough && state.end > data.status.completeThrough ? data.status.completeThrough : state.end);
  return { start, end, clamped: end !== state.end || state.rangeClamped };
}

function recordConnection(value) {
  if (typeof value.configurationReady === 'boolean') connectionReady = value.configurationReady;
  if (typeof value.connected === 'boolean' && !reconnectRequired) connectionAuthorized = value.connected;
}

function recordAuthorizationError(code) {
  if (code === 'REAUTH_REQUIRED') { reconnectRequired = true; connectionAuthorized = false; }
  if (code === 'OAUTH_NOT_CONNECTED') connectionAuthorized = false;
}

async function fetchSnapshot({cacheOnly = reconnectRequired} = {}) {
  if (pendingRequest) pendingRequest.abort();
  const controller = new AbortController();
  pendingRequest = controller;
  const sequence = ++requestSequence;
  const query = JSON.stringify([state.demo, state.start, state.end, state.releaseAgeDays]);
  if (displayedQuery !== query) state.data = emptyData();
  state.loading = true;
  state.error = null;
  $('#error-message').hidden = true;
  $('#view').setAttribute('aria-busy', 'true');
  $('#view').classList.add('is-loading');
  $('#demo-toggle').disabled = true;
  $('#refresh-button').disabled = true;
  const params = new URLSearchParams({ demo: state.demo ? '1' : '0', start: state.start, end: state.end, timezone: TIMEZONE, releaseAgeDays: String(state.releaseAgeDays) });
  if (cacheOnly) params.set('cacheOnly', '1');
  try {
    const response = await fetch(`/api/analytics/preview?${params}`, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      if (sequence !== requestSequence) return;
      if ([401, 403].includes(response.status)) {
        state.data = emptyData(); displayedQuery = null; connectionAuthorized = null;
        reconnectRequired = false; connectionReady = false;
        customizer.invalidate();
        throw new Error('私人站登入已失效或無存取權，請重新登入私人站。');
      }
      throw new Error(`私人資料端點暫時無法使用（HTTP ${response.status}）。`);
    }
    const data = normalizeData(await response.json());
    if (sequence !== requestSequence) return;
    state.data = data;
    displayedQuery = query;
    await reportActions.readSelected();
    if (sequence !== requestSequence) return;
    if (!state.demo) {
      recordConnection(data.status);
      recordAuthorizationError(data.summary.nativeReadError?.code);
      if (data.summary.nativeReadError) state.syncMessage = reconnectRequired ? 'Google 授權已失效；顯示上次同步資料' : '原生期間指標暫時無法更新；顯示已儲存資料';
    }
    // Preserve the requested dates. Provider lag must not silently shift the window.
    if (!state.topicsInitialized && data.topics.length) {
      state.selectedTopics = new Set(data.topics.slice(0, 3).map((topic) => topic.id));
      state.topicsInitialized = true;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (sequence !== requestSequence) return;
    state.error = error.message || '無法讀取私人資料。請確認私人 Site 連線狀態。';
  } finally {
    if (sequence === requestSequence) {
      state.loading = false;
      pendingRequest = null;
      $('#view').classList.remove('is-loading');
      $('#view').setAttribute('aria-busy', 'false');
      $('#demo-toggle').disabled = false;
      $('#refresh-button').disabled = state.syncing;
      render();
    }
  }
}

function renderChrome() {
  const [eyebrow, title, description] = pageCopy[state.tab];
  $('#page-eyebrow').textContent = eyebrow;
  const displayTitle = state.tab === 'overview' ? dashboardLayout.dashboardTitle?.trim() || title : title;
  $('#page-title').textContent = displayTitle;
  $('#layout-name-label').textContent = dashboardLayout.name?.trim() ? `版面：${dashboardLayout.name.trim()}` : '';
  $('#layout-name-label').hidden = state.tab !== 'overview' || !dashboardLayout.name?.trim();
  $('#page-description').textContent = description;
  document.title = `${dashboardLayout.headerName?.trim() || getBrandDefaults(document).name} · ${displayTitle}`;
  document.querySelectorAll('[data-tab]').forEach((link) => {
    const active = link.dataset.tab === state.tab;
    link.classList.toggle('active', active);
    active ? link.setAttribute('aria-current', 'page') : link.removeAttribute('aria-current');
  });
  $('#video-count').textContent = availableData() ? number(state.data.videos.length) : '—';
  $('#sidebar-connection').textContent = state.demo ? '合成示範 · 非真實數據' : reconnectRequired ? '授權已失效 · 待重新連接' : connectionAuthorized === null ? '正在確認授權' : connectionAuthorized ? (availableData() ? '已授權 · 已同步' : '已授權 · 未同步') : '尚未授權頻道';
  $('#demo-toggle').innerHTML = state.demo
    ? `${icon('close')}<span>離開示範</span>`
    : `<span class="demo-button-icon">✧</span><span>探索示範資料</span>${icon('arrow')}`;
  const banner = $('#mode-banner');
  banner.className = `mode-banner${state.demo ? ' demo' : ''}`;
  banner.innerHTML = state.demo
    ? `${icon('info')}<span class="banner-lead"><strong>合成示範模式 · 非真實數據</strong><span class="banner-details">數字與影片均為測試資料，不代表 YouTube Dashboard 表現。</span></span><button data-action="leave-demo">離開示範 ↗</button>`
    : reconnectRequired
      ? `${icon('link')}<span class="banner-lead"><strong>Google 授權已失效</strong><span class="banner-details">${availableData() ? '仍可查看上次同步資料；重新連接後繼續更新。' : '重新連接後即可同步頻道資料。'}</span></span><button data-action="connect-google">重新連接 Google ↗</button>`
    : connectionAuthorized === null
      ? `${icon('info')}<span class="banner-lead"><strong>正在確認 Google 授權與資料狀態</strong></span>`
      : availableData()
      ? `${icon('shield')}<span class="banner-lead"><strong>已讀取已驗證頻道資料</strong><span class="banner-details">不會從這個頁面上傳或發佈內容。</span></span><button data-action="show-status">查看資料狀態 ↗</button>`
      : connectionAuthorized
        ? `${icon('shield')}<span class="banner-lead"><strong>Google 已授權 · 尚未同步資料</strong><span class="banner-details">授權已保存；同步成功後才會顯示真實分析數據。</span></span><button data-action="show-status">查看資料狀態 ↗</button>`
        : `${icon('link')}<span class="banner-lead"><strong>尚未授權 YouTube 帳戶</strong><span class="banner-details">連接一次後，之後開啟會直接顯示已同步資料。</span></span><button data-action="${connectionReady ? 'connect-google' : 'setup'}">${connectionReady ? '連接 Google' : '查看設定說明'} ↗</button>`;
  $('#start-date').value = state.start;
  $('#end-date').value = state.end;
  $('#start-date').max = state.end;
  $('#end-date').min = state.start;
  $('#end-date').max = dayOffset(today(), -1);
  document.querySelectorAll('[data-days]').forEach((button) => {
    const selected = Number(button.dataset.days) === state.days;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  $('#refresh-label').textContent = state.syncing ? '更新中…' : '更新資料';
  $('#refresh-button').disabled = state.syncing || state.loading;
  const range = effectiveRange();
  $('#effective-range').textContent = availableData() && state.data.status.completeThrough
    ? `所選 ${displayDate(state.start)}–${displayDate(state.end)} · API 可用 ${displayDate(range.start)}–${displayDate(range.end)}${range.clamped ? ' · 尚未涵蓋完整所選期間' : ''} · 全頻道（所有內容類型） · 美西時間 · ${state.syncMessage || `上次同步 ${displayTimestamp(state.data.status.lastSyncedAt)}`}`
    : state.syncMessage || '資料日期以美西時間計算（America/Los_Angeles）';
  $('.filter-bar').hidden = ['status', 'topics'].includes(state.tab);
  if (state.error) {
    $('#error-message').hidden = false;
    $('#error-message').innerHTML = `${escapeHTML(state.error)} ${availableData() ? '目前顯示同一期間的上次資料。' : '沒有可顯示的資料，未補成零。'}<button data-action="refresh">重試</button>`;
  }
}

function coverageMarkup() {
  if(state.demo)return '';
  const coverage=state.data.coverage;
  if(!coverage)return '';
  const complete=coverage.videoSelection==='all_current_uploads';
  return '<p class="sync-coverage" role="status">'+(complete?'全部影片清單已讀取':'目前仍是舊版前 20 支快照，請按更新資料')+' · 清單 '+number(coverage.videoIdsReturned)+' 支 · 已查詢 '+number(coverage.videoMetadataAvailable)+' 支 · 無法取得影片資料 '+number(coverage.videoMetadataMissing)+' 支'+(isNumber(coverage.videosWithoutDailyRows)?' · 本期間未回傳分析列 '+number(coverage.videosWithoutDailyRows)+' 支':'')+'。API 未提供的日期與數值不補零；已刪除影片不保證可取得。</p>';
}

function metricsMarkup() {
  const summary = state.data.summary;
  const metrics = [
    ['觀看次數', 'eye', number(summary.views), 'views'],
    ['觀看時間（小時）', 'clock', hours(summary.watchMinutes), 'watchMinutes'],
    [state.demo ? '平均觀看時長（示範）' : '平均觀看時長（API 原生）', 'video', duration(summary.averageViewDurationSeconds), 'averageViewDurationSeconds'],
    ['訂閱淨變動', 'people', signed(summary.subscribersNet), 'subscribersNet'],
  ];
  return `<section class="metrics" aria-label="期間核心指標">${metrics.map(([label, glyph, value]) => `<article class="metric-card"><div class="metric-top"><span>${label}</span>${icon(glyph)}</div><div class="metric-value${value === '—' ? ' unknown' : ''}">${value}</div><div class="metric-bottom"><span class="tiny-dot"></span>${value === '—' ? '尚無可用原生資料，不代表零' : state.demo ? '合成示範 · 所選期間' : `${displayDate(effectiveRange().start)}–${displayDate(effectiveRange().end)}${effectiveRange().clamped ? ' · 部分期間' : ''}`}</div></article>`).join('')}</section>`;
}

function chartMarkup() {
  const range = effectiveRange();
  const daily = state.data.daily.filter((entry) => typeof entry.date === 'string' && (!range.end || entry.date <= range.end)).slice().sort((a, b) => a.date.localeCompare(b.date));
  const known = daily.filter((entry) => isNumber(entry.views));
  const maxActual = known.length ? Math.max(...known.map((entry) => entry.views)) : 0;
  const max = Math.max(1, maxActual);
  const width = 600, height = 190, left = 35, right = 12, top = 17, bottom = 30;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const scaledMax = max < 5 ? 5 : Math.ceil(max / Math.pow(10, Math.floor(Math.log10(max)))) * Math.pow(10, Math.floor(Math.log10(max)));
  const xAt = (index) => left + (daily.length > 1 ? index / (daily.length - 1) : .5) * plotWidth;
  const points = daily.map((entry, index) => isNumber(entry.views) ? [xAt(index), top + plotHeight * (1 - entry.views / scaledMax), entry] : null);
  const segments = [];
  let segment = [];
  for (const point of points) {
    if (point) segment.push(point);
    else if (segment.length) { segments.push(segment); segment = []; }
  }
  if (segment.length) segments.push(segment);
  const paths = segments.map((items) => {
    const line = items.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L${items.at(-1)[0]},${top + plotHeight} L${items[0][0]},${top + plotHeight} Z`;
    return `<path d="${area}" fill="none" stroke="none"/><path class="chart-line" d="${line}"/>`;
  }).join('');
  const grid = [0, .25, .5, .75, 1].map((ratio) => {
    const y = top + plotHeight * ratio;
    const value = scaledMax * (1 - ratio);
    const label = known.length ? (value >= 1000 ? `${number(value / 1000, 1)}k` : number(value)) : '—';
    return `<line class="chart-grid" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-label" x="${left - 9}" y="${y + 3}" text-anchor="end">${label}</text>`;
  }).join('');
  const labelDates = daily.length ? [...new Set([0, Math.floor((daily.length - 1) / 3), Math.floor((daily.length - 1) * 2 / 3), daily.length - 1])] : [];
  const labels = labelDates.map((index) => `<text class="chart-label" x="${xAt(index)}" y="${height - 8}" text-anchor="${index === 0 ? 'start' : index === daily.length - 1 ? 'end' : 'middle'}">${escapeHTML(daily[index].date.slice(5).replace('-', '/'))}</text>`).join('');
  const knownPoints = points.filter(Boolean);
  const dot = knownPoints.length ? `<circle cx="${knownPoints.at(-1)[0]}" cy="${knownPoints.at(-1)[1]}" r="4" fill="var(--cp-jilan)" stroke="var(--cp-surface)" stroke-width="2"/>` : '';
  const tooltips = knownPoints.map(([x, y, entry]) => `<circle cx="${x}" cy="${y}" r="7" fill="transparent" stroke="none"><title>${escapeHTML(entry.date)}：${number(entry.views)} 次觀看</title></circle>`).join('');
  const summary = known.length ? `所選期間有 ${known.length} 天可用資料；每日觀看次數最高 ${number(maxActual)} 次。缺漏日期斷線顯示。` : '尚無每日觀看次數資料。';
  return `<section class="panel trend-panel"><div class="panel-heading"><div><h2>${known.length ? '逐日觀看，保留缺漏' : '尚無資料，不推斷趨勢'}</h2><p>${known.length ? `${displayDate(range.start)} — ${displayDate(range.end)}` : '每一天的累積，都是內容留下的回響。'}</p></div><span class="subtle-pill">觀看次數 · 按日</span></div><div class="chart-wrap"><svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(summary)}">${grid}${paths}${dot}${tooltips}${labels}</svg>${!known.length ? `<div class="chart-empty"><div class="empty-glyph">${icon('bars')}</div><strong>${state.error ? '目前無法取得資料' : state.demo ? '所選期間沒有可用日資料' : '等待你的第一筆訊號'}</strong><p>${state.demo ? '換個日期範圍，或查看資料狀態。' : connectionAuthorized ? 'Google 已授權；同步成功後，這裡會顯示頻道的觀看走勢。' : '授權並同步後，這裡會顯示頻道的觀看走勢。<br>現在也可以先探索合成示範。'}</p><button class="text-button" data-action="${state.demo ? 'show-status' : 'demo'}">${state.demo ? '查看資料狀態' : '看看工作台如何運作'}${icon('arrow')}</button></div>` : ''}</div><div class="chart-caption"><span class="chart-legend"><span class="legend-stroke"></span>圖 1 · 觀看次數 · N = ${known.length} 天</span><span>${state.demo ? '合成測試資料 · 非真實頻道' : '缺漏日期不補零、不連線'} · 美西日期</span></div></section>`;
}

function insightMarkup() {
  const comparisons = comparisonGroups();
  const usable = comparisons.filter((group) => isNumber(group.views) && isNumber(group.videoCount) && group.videoCount > 0);
  const best = usable.sort((a, b) => b.views / b.videoCount - a.views / a.videoCount)[0];
  if (best && availableData()) {
    return `<aside class="panel insight-panel"><div class="eyebrow">比較前先對齊口徑</div><h2>哪個主題，<br>更值得深入？</h2><div class="insight-value">${number(best.views / best.videoCount)}</div><p>「${escapeHTML(best.label ?? topicLabel(best.topicId))}」發布前 ${state.releaseAgeDays} 天，每支影片平均觀看次數。${state.demo ? '僅為合成示範。' : ''}</p><button class="button button-outline" data-action="show-topics">比較主題${icon('arrow')}</button></aside>`;
  }
  return `<aside class="panel insight-panel"><div class="eyebrow">比較前先對齊口徑</div><h2>哪個主題，<br>更值得深入？</h2><p>用相同的發布天數看表現，<br>讓新影片與舊影片站在同一起點。</p><button class="button button-outline" data-action="show-topics">探索主題比較${icon('arrow')}</button></aside>`;
}

function filteredVideos() {
  const search = state.search.trim().toLocaleLowerCase('zh-TW');
  const result = state.data.videos.filter((video) => (!search || String(video.title ?? '').toLocaleLowerCase('zh-TW').includes(search) || videoTopics(video).some((id) => String(topicLabel(id)).toLocaleLowerCase('zh-TW').includes(search))) && (state.topicFilter === 'all' || videoTopics(video).includes(state.topicFilter)));
  return result.sort((a, b) => state.sort === 'publishedAt' ? String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) : (isNumber(b[state.sort]) ? b[state.sort] : -Infinity) - (isNumber(a[state.sort]) ? a[state.sort] : -Infinity));
}

function videoRows(videos) {
  return videos.map((video, index) => `<tr><td><div class="video-identity"><div class="video-thumbnail theme-${index % 5}" aria-hidden="true">Py<small>${duration(video.durationSeconds)}</small></div><div><div class="video-name" title="${escapeHTML(video.title)}">${escapeHTML(video.title || '未命名影片')}</div><div class="video-tags">${videoTopics(video).slice(0, 3).map((id) => `<span class="video-tag">${escapeHTML(topicLabel(id))}</span>`).join('')}${state.demo ? '<span class="video-tag">合成示範</span>' : ''}</div></div></div></td><td>${displayDate(video.publishedAt)}</td><td>${number(video.views)}</td><td>${hours(video.watchMinutes)}${isNumber(video.watchMinutes) ? ' 小時' : ''}</td><td class="${isNumber(video.subscribersNet) && video.subscribersNet > 0 ? 'positive' : ''}">${signed(video.subscribersNet)}</td></tr>`).join('');
}

function videoTableMarkup(overview = false) {
  const videos = overview ? state.data.videos.slice().sort((a, b) => String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? ''))).slice(0, 5) : filteredVideos();
  const hasData = availableData();
  const empty = !state.data.videos.length;
  return `<section class="panel table-panel"><div class="panel-heading"><div class="table-header-label"><h2>${overview ? '近期影片' : '影片清單'}</h2><span class="count-badge">${hasData ? number(overview ? state.data.videos.length : videos.length) : '—'}</span></div><div class="table-tools">${overview ? `<button class="text-button" data-action="show-videos">查看全部${icon('arrow')}</button>` : `<button class="text-button" data-action="export"${!videos.length ? ' disabled' : ''}>${icon('download')}匯出 CSV</button>`}</div></div><div class="table-scroll"><table class="video-table"><thead><tr><th scope="col">影片與主題</th><th scope="col">發布日期</th><th scope="col">觀看次數</th><th scope="col">觀看時間</th><th scope="col">訂閱淨變動</th></tr></thead><tbody>${videoRows(videos)}</tbody></table></div>${!videos.length ? `<div class="table-empty">${icon(empty ? 'video' : 'search')}<strong>${empty ? state.demo ? '這個日期範圍沒有影片資料' : '你的內容，會在這裡展開' : '沒有符合篩選條件的影片'}</strong><p>${empty ? state.demo ? '試試調整日期範圍，確認是否涵蓋示範資料。' : connectionAuthorized ? 'Google 已授權，影片資料尚未同步。沒有數據，不代表沒有表現。' : '影片資料尚未連接。沒有數據，不代表沒有表現。' : '調整搜尋文字或主題，重新找找看。'}</p></div>` : ''}<div class="table-footer"><span>${state.demo ? '合成影片與數據 · 僅供功能測試' : '所選期間數據 · 訂閱為影片觀看頁面歸因，不等同頻道總訂閱'}</span><span>${videos.length ? `顯示 ${videos.length} 支影片` : '缺漏資料保留為 —'}</span></div></section>`;
}

function overviewMarkup() {
  const definition = state.demo ? '目前為合成示範資料。' : state.data.summary.nativeCheckedAt ? '總覽採全頻道 API 原生期間指標；平均時長使用 averageViewDuration，不以觀看次數推算。' : '目前顯示已儲存每日資料的彙總；原生期間指標待 Google 查詢完成，平均時長不以觀看次數推算。';
  return `${coverageMarkup()}${renderWidgets(dashboardLayout,state.data,effectiveRange(),{authorized:connectionAuthorized,reconnectRequired})}<div class="guide-row">${icon('info')}<span>${definition}影片與主題比較的推導值另有口徑，不能視為 Studio 原生平均。API 可能晚於 Studio，缺漏值保留「—」。</span></div>`;
}

function videosMarkup() {
  return `<div class="video-controls"><label class="search-field">${icon('search')}<input id="video-search" type="search" placeholder="搜尋影片標題或主題…" aria-label="搜尋影片標題或主題" value="${escapeHTML(state.search)}" /></label><select class="select-control" id="video-topic" aria-label="依主題篩選"><option value="all">所有主題</option>${state.data.topics.map((topic) => `<option value="${escapeHTML(topic.id)}"${state.topicFilter === topic.id ? ' selected' : ''}>${escapeHTML(topic.label)}</option>`).join('')}</select><label class="sort-label" for="video-sort">排序方式</label><select class="select-control" id="video-sort"><option value="views"${state.sort === 'views' ? ' selected' : ''}>觀看次數：高 → 低</option><option value="watchMinutes"${state.sort === 'watchMinutes' ? ' selected' : ''}>觀看時間：高 → 低</option><option value="subscribersNet"${state.sort === 'subscribersNet' ? ' selected' : ''}>訂閱淨變動：高 → 低</option><option value="publishedAt"${state.sort === 'publishedAt' ? ' selected' : ''}>發布日期：新 → 舊</option></select></div><p class="view-summary">標題搜尋、主題篩選與排序只作用於目前已讀取的影片。表內數據對應上方選定期間。</p><div id="video-table-container">${videoTableMarkup()}</div><div class="guide-row">${icon('shield')}<span>匯出僅產生目前篩選結果的本機 CSV。合成示範檔案會清楚標示，不會上傳至外部服務。</span></div>`;
}

function comparisonGroups() {
  const comparison = state.data.comparison;
  if (!comparison || Number(comparison.releaseAgeDays) !== state.releaseAgeDays || !Array.isArray(comparison.groups)) return [];
  return comparison.groups.map((group) => ({ ...group, topicId: group.topicId ?? group.id, videoCount: group.videoCount ?? group.qualifiedVideoCount }));
}

function topicsMarkup() {
  const groups = comparisonGroups();
  const selected = state.data.topics.filter((topic) => state.selectedTopics.has(topic.id));
  const normalizedViews = groups.filter((group) => isNumber(group.views) && group.videoCount > 0).map((group) => group.views / group.videoCount);
  const maxAverage = Math.max(1, ...normalizedViews);
  const cards = selected.map((topic, index) => {
    const group = groups.find((item) => item.topicId === topic.id) ?? {};
    const average = isNumber(group.views) && isNumber(group.videoCount) && group.videoCount > 0 ? group.views / group.videoCount : null;
    const colors = ['#34577d', '#776a91', '#6f959a', '#b8c8d3'];
    return `<article class="panel comparison-card"><h3><span class="topic-color" style="background:${colors[index % colors.length]}"></span>${escapeHTML(topic.label)}</h3><p>${isNumber(group.videoCount) ? `${number(group.videoCount)} 支影片符合完整 ${state.releaseAgeDays} 天條件` : '等待相同發布天數的完整資料'}</p><div class="comparison-value${!isNumber(average) ? ' unknown' : ''}">${number(average)}</div><div class="comparison-unit">每支影片平均觀看次數 · 前 ${state.releaseAgeDays} 天</div><div class="comparison-meter"><span style="width:${isNumber(average) ? Math.max(0, Math.min(100, average / maxAverage * 100)) : 0}%;background:${colors[index % colors.length]}"></span></div><dl class="comparison-details"><div><dt>總觀看時間</dt><dd>${hours(group.watchMinutes)}${isNumber(group.watchMinutes) ? '<span class="metric-footnote">小時</span>' : ''}</dd></div><div><dt>訂閱淨變動</dt><dd>${signed(group.subscribersNet)}</dd></div><div><dt>平均觀看時長</dt><dd>${duration(group.averageViewDurationSeconds)}</dd></div><div><dt>完整樣本數</dt><dd>${number(group.videoCount)}</dd></div></dl>${isNumber(group.videoCount) && group.videoCount < 3 ? '<p class="sample-warning">樣本較少，先當作探索訊號，不做勝負判定。</p>' : ''}</article>`;
  }).join('');
  return `<div class="topic-intro"><section class="panel topic-selection"><h2>選擇你想比較的主題</h2><p>以所有已收錄影片，按各自發布後的完整窗口比較。多標籤影片可能出現在多組，組間合計不等於頻道總計。</p><div class="topic-chips">${state.data.topics.length ? state.data.topics.map((topic) => `<button class="topic-chip" data-topic="${escapeHTML(topic.id)}" aria-pressed="${state.selectedTopics.has(topic.id)}"><span class="chip-check">${state.selectedTopics.has(topic.id) ? icon('check') : ''}</span>${escapeHTML(topic.label)}</button>`).join('') : '<span class="view-summary">尚無主題標籤；連接資料或開啟示範後即可選擇。</span>'}</div></section><aside class="panel comparison-window"><label for="release-age">統一比較窗口</label><select id="release-age" class="select-control">${[7, 28, 90].map((days) => `<option value="${days}"${days === state.releaseAgeDays ? ' selected' : ''}>發布後前 ${days} 天</option>`).join('')}</select><p>只納入完整經過此窗口的影片。比較的是相同發布天數，不是終身累計。</p></aside></div>${selected.length ? `<div class="comparison-grid">${cards}</div>` : `<section class="panel comparison-empty"><div class="empty-glyph">${icon('bars')}</div><h2>${state.data.topics.length ? '選擇主題，開始一場公平的比較' : '讓每個主題，站在同一起點'}</h2><p>${state.data.topics.length ? '點選上方標籤，至少選擇一個主題。' : '有了發布日期與每日數據後，<br>才能比較各主題在相同時間窗口的表現。'}</p>${!state.demo ? `<button class="text-button" data-action="demo">用合成資料探索${icon('arrow')}</button>` : ''}</section>`}<section class="panel method-panel"><h3>這裡的「公平比較」，如何計算？</h3><ol><li><strong>對齊發布天數</strong>跳過發布當日的零碎時段，從次日起計算 ${state.releaseAgeDays} 個完整美西日曆日。</li><li><strong>只比較完整窗口</strong>尚未成熟或窗口內日資料缺漏的影片不補零，另行排除。</li><li><strong>留意樣本與交集</strong>觀看次數除以符合條件的影片數；主題重疊與小樣本需另外判讀。</li></ol></section>`;
}

function statusMarkup() {
  const status = state.data.status;
  const blockers = Array.isArray(status.blockers) ? status.blockers : [];
  const blockerLabels = { DEMO_DATA_ONLY: '目前僅有合成示範資料，不能據此判讀真實頻道。', CHANNEL_UNBOUND: '尚未綁定固定 YouTube 頻道與所有者。', OAUTH_NOT_CONFIGURED: 'Google OAuth 與安全權杖儲存尚未接通。', OAUTH_NOT_CONNECTED: '尚未完成 Google 唯讀授權。', NO_COMPLETE_DAY_WATERMARK: '尚無經過完整性確認的資料日期。', NO_ANALYTICS_DATA: '尚未同步真實分析資料。' };
  const normalizedBlockers = blockers.map((blocker) => { const message = typeof blocker === 'string' ? blocker : blocker.message ?? blocker.detail ?? blocker.code ?? '待確認的資料條件'; return blockerLabels[message] ?? message; });
  const fallbackBlockers = reconnectRequired ? ['Google 已拒絕保存的授權，請重新連接。'] : state.demo ? ['目前使用合成示範資料，不能據此判讀真實頻道。', '示範模式不代表帳戶授權或同步狀態。'] : connectionAuthorized === null ? ['正在確認 Google 授權與資料狀態。'] : connectionAuthorized ? ['Google 授權已保存。', '尚無可顯示的分析快照，請確認同步狀態。'] : ['尚未設定並授權 YouTube 頻道的唯讀存取。', '尚無經過完整性檢查的頻道資料。'];
  const range = effectiveRange();
  const facts = [
    ['Google 授權', reconnectRequired ? '已失效，需重新連接' : connectionAuthorized === null ? '確認中' : connectionAuthorized ? '已授權（已保存）' : '尚未授權'],
    ['資料同步', state.demo ? '合成示範' : state.loading ? '讀取中' : availableData() ? '已同步' : '尚未同步'],
    ['目前資料來源', state.demo ? '合成示範資料' : state.loading ? '讀取中' : availableData() ? '已驗證頻道快照' : '尚無同步資料'],
    ['API 回報至（可能修訂）', displayDate(status.completeThrough)],
    ['最後同步時間', displayTimestamp(status.lastSyncedAt)],
    ['更新狀態', state.syncMessage || '尚未要求更新'],
    ['日期歸屬時區', status.timezone || TIMEZONE],
    ['有效查詢期間', availableData() ? `${displayDate(range.start)} – ${displayDate(range.end)}` : '—'],
  ];
  const connectButton = !state.demo && (reconnectRequired || connectionAuthorized === false) ? `<button class="button button-outline" id="connect-google" ${connectionReady ? '' : 'disabled'}>${reconnectRequired ? '重新連接 Google' : '連接 Google'}</button>` : '';
  return `<section class="panel status-header"><div class="dialog-icon">${icon(state.demo ? 'info' : status.connected ? 'check' : 'link')}</div><div><div class="eyebrow">${state.demo ? 'Synthetic data only' : reconnectRequired ? 'Reconnect to update' : availableData() ? 'Verified channel snapshot' : connectionAuthorized ? 'Authorized, awaiting sync' : connectionAuthorized === null ? 'Checking authorization' : 'Not authorized'}</div><h2>${state.demo ? '可以探索，但不是你的真實數據。' : reconnectRequired ? 'Google 授權已失效。' : availableData() ? '資料已同步，口徑保持透明。' : connectionAuthorized ? 'Google 已授權，尚未同步資料。' : connectionAuthorized === null ? '正在確認授權狀態。' : '工作台已就緒，等你完成授權。'}</h2><p>${state.demo ? '所有影片與指標皆為合成測試資料，不代表真實頻道資料。' : reconnectRequired ? '上次同步資料仍保留；重新連接後即可繼續更新。' : availableData() ? '以下列出私人資料來源、可用日期與待處理項目。' : connectionAuthorized ? '授權已保存；尚未取得通過驗證的分析快照，請同步選定期間。' : connectionAuthorized === null ? '正在讀取私人端點，尚未判定授權狀態。' : '私人介面已部署，尚未完成 Google 帳戶授權。'}</p></div></section><div class="guide-row">${connectButton}<button class="button button-outline" id="sync-google" ${connectionReady && connectionAuthorized && !state.demo && !state.syncing ? "" : "disabled"}>同步選定期間（最多 31 天）</button><button class="button button-outline" id="export-json" ${availableData() && !state.demo ? "" : "disabled"}>下載 JSON 分析包</button><button class="button button-outline" id="export-csv" ${availableData() && !state.demo ? "" : "disabled"}>下載頻道 CSV</button><a href="/">返回原成長工作台</a></div><div class="status-grid"><section class="panel status-card"><h3>${icon('database')}資料來源與完整性</h3><dl class="status-facts">${facts.map(([key, value]) => `<div><dt>${key}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl></section><section class="panel status-card"><h3>${icon('clock')}目前待辦與限制</h3><ul class="status-blockers">${(reconnectRequired ? fallbackBlockers : normalizedBlockers.length ? normalizedBlockers : status.connected && !state.demo ? ['目前端點沒有回報待處理的阻礙。'] : fallbackBlockers).map((blocker) => `<li><span class="tiny-dot"></span><span>${escapeHTML(blocker)}</span></li>`).join('')}</ul><p class="freshness-note">未回報日期不補零；無法取得的值保留「—」。</p></section></div><section class="panel privacy-card">${icon('shield')}<div><h3>私有，從基礎開始。</h3><p>這個頁面只讀取私人雲端端點。沒有廣告追蹤、外部字型或第三方分析程式，也不會在瀏覽器儲存帳戶憑證。Google 唯讀授權與資料同步分開顯示。</p></div></section>`;
}

function render() {
  renderChrome();
  $('#view').innerHTML = `<div class="view-enter">${({ overview: overviewMarkup, videos: videosMarkup, topics: topicsMarkup, status: statusMarkup })[state.tab]()}</div>`;
}

function changeTab(tab) {
  if (!pageCopy[tab]) return;
  state.tab = tab;
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', `#${tab}`);
  render();
}

function showSetup() {
  $('#setup-dialog').showModal();
}

function showToast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4300);
}

async function toggleDemo(enabled) {
  state.demo = enabled;
  state.data = emptyData();
  state.search = '';
  state.topicFilter = 'all';
  state.topicsInitialized = false;
  state.selectedTopics.clear();
  render();
  await fetchSnapshot();
  if (!state.error) showToast(enabled ? '已開啟合成示範。所有數據均非真實頻道表現。' : '已離開示範，回到私人工作台。');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCSV() {
  const videos = filteredVideos();
  if (!videos.length) return;
  const range = effectiveRange();
  const rows = [['資料類型', '開始日期', '結束日期', '日期時區', '影片 ID', '影片標題', '發布日期', '主題', '觀看次數', '觀看時間（分鐘）', '平均觀看時長（秒）', '訂閱淨變動'], ...videos.map((video) => [state.demo ? 'SYNTHETIC_DEMO_合成示範' : '已驗證頻道資料', range.start, range.end, TIMEZONE, video.id, video.title, video.publishedAt, videoTopics(video).map(topicLabel).join(' / '), video.views, video.watchMinutes, video.averageViewDurationSeconds, video.subscribersNet])];
  const blob = new Blob(['\ufeff', rows.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${getBrandDefaults(document).name}-${state.demo ? 'SYNTHETIC-DEMO-' : ''}${range.start}_${range.end}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast(`已產生 ${videos.length} 支影片的本機 CSV${state.demo ? '，並標記為合成示範' : ''}。`);
}

document.addEventListener('click', (event) => {
  const reportButton=event.target.closest('[data-report-widget]');
  if(reportButton){reportActions.update(reportButton.dataset.reportWidget);return;}
  const nav = event.target.closest('[data-tab]');
  if (nav) { event.preventDefault(); changeTab(nav.dataset.tab); return; }
  const range = event.target.closest('[data-days]');
  if (range) {
    state.days = Number(range.dataset.days);
    state.end = dayOffset(today(), -1);
    state.start = dayOffset(state.end, -(state.days - 1));
    state.rangeClamped = false;
    renderChrome();
    fetchSnapshot();
    return;
  }
  const chip = event.target.closest('[data-topic]');
  if (chip) {
    const id = chip.dataset.topic;
    state.selectedTopics.has(id) ? state.selectedTopics.delete(id) : state.selectedTopics.add(id);
    render();
    document.querySelectorAll('[data-topic]').forEach((button) => { if (button.dataset.topic === id) button.focus(); });
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'setup') showSetup();
  if (action === 'connect-google') connectGoogle();
  if (action === 'demo') toggleDemo(true);
  if (action === 'leave-demo') toggleDemo(false);
  if (action === 'refresh') refreshFromGoogle();
  if (action === 'show-status') changeTab('status');
  if (action === 'show-videos') changeTab('videos');
  if (action === 'show-topics') changeTab('topics');
  if (action === 'export') exportCSV();
});

document.addEventListener('change', (event) => {
  const { id, value } = event.target;
  if (id === 'start-date' || id === 'end-date') {
    const start = $('#start-date').value;
    const end = $('#end-date').value;
    if (!start || !end || start > end) { showToast('請選擇有效的起訖日期，開始日不可晚於結束日。'); renderChrome(); return; }
    state.start = start;
    state.end = end;
    state.days = null;
    state.rangeClamped = false;
    fetchSnapshot();
  }
  if (id === 'video-sort') { state.sort = value; $('#video-table-container').innerHTML = videoTableMarkup(); }
  if (id === 'video-topic') { state.topicFilter = value; $('#video-table-container').innerHTML = videoTableMarkup(); }
  if (id === 'release-age') { state.releaseAgeDays = Number(value); fetchSnapshot(); }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'video-search') {
    state.search = event.target.value;
    $('#video-table-container').innerHTML = videoTableMarkup();
  }
});

$('#demo-toggle').addEventListener('click', () => toggleDemo(!state.demo));
$('#refresh-button').addEventListener('click', () => refreshFromGoogle());
$('#close-setup').addEventListener('click', () => $('#setup-dialog').close());
$('#acknowledge-setup').addEventListener('click', () => $('#setup-dialog').close());
$('#setup-dialog').addEventListener('click', (event) => { if (event.target === $('#setup-dialog')) $('#setup-dialog').close(); });
window.addEventListener('hashchange', () => changeTab(location.hash.slice(1)));

document.addEventListener('click', async (event) => {
  if (['export-json','export-csv'].includes(event.target.id) && availableData() && !state.demo) {
    const format=event.target.id==='export-json'?'json':'csv';
    const params=new URLSearchParams({format,table:'channel_daily',startDate:state.start,endDate:state.end});
    try {const r=await fetch('/api/analytics/export?'+params,{cache:'no-store'});if(!r.ok){const e=await r.json();throw new Error(e.error?.message||'匯出未完成');}const file=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=getBrandDefaults(document).name+'-channel-'+state.start+'-'+state.end+'.'+format;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(e){showToast(e.message);}return;
  }
  if (event.target.id === 'connect-google') await connectGoogle();
  if (event.target.id === 'sync-google') await refreshFromGoogle({startDate:state.start,endDate:state.end});
});
let connectingGoogle = false;
async function connectGoogle() {
  if (connectingGoogle || !connectionReady || state.demo || (connectionAuthorized !== false && !reconnectRequired)) return;
  connectingGoogle = true;
  try {
    const response = await fetch('/oauth/google/start', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const result = await response.json();
    if (!response.ok) throw new Error('Google 連接暫時無法開始，請稍後重試。');
    const destination = new URL(result.authorizationUrl);
    if (destination.origin !== 'https://accounts.google.com') throw new Error('授權網址未通過檢查');
    location.assign(destination.href);
  } catch(error) { showToast(error.message); }
  finally { connectingGoogle = false; render(); }
}
async function refreshFromGoogle(range) {
  if(state.demo)return fetchSnapshot();
  if(state.syncing)return;
  if(!connectionReady||!connectionAuthorized)return fetchSnapshot({cacheOnly:true});
  state.syncing=true;state.syncMessage=availableData()?'正在向 Google 更新；暫顯示上次資料':'正在向 Google 同步資料';
  $('#refresh-button').disabled=true;render();
  const endDate=dayOffset(today(),-1);
  let failed=false;
  try {
    const response=await fetch('/api/analytics/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(range??{startDate:dayOffset(endDate,-27),endDate})});
    const result=await response.json();
    if(!response.ok) {
      const code=result.error?.code;
      recordAuthorizationError(code);
      if(['RATE_LIMITED','SYNC_IN_PROGRESS'].includes(code))state.syncMessage='近期已更新或同步進行中；顯示已儲存資料';
      else { failed=true; state.syncMessage=reconnectRequired?'Google 授權已失效；重新連接後可繼續更新':code==='OAUTH_CONFIGURATION_ERROR'?'應用程式設定暫時無法通過 Google 驗證；請聯絡管理者':'Google 更新暫時未完成；保留上次資料，可稍後重試'; }
    } else state.syncMessage='更新完成：'+number(result.coverage?.videoMetadataAvailable)+' 支影片已查詢；API 資料截止 '+displayDate(result.completeThrough);
  } catch {failed=true;state.syncMessage='Google 更新暫時未完成；保留上次資料，可稍後重試';}
  finally{state.syncing=false;await fetchSnapshot({cacheOnly:failed||reconnectRequired});}
}
async function initializeDashboard() {
  render();
  // Preferences never delay the saved snapshot or Google synchronization.
  void customizer.load();
  // The saved snapshot is rendered before waiting for any upstream refresh.
  const saved=fetchSnapshot({cacheOnly:true});
  const status=fetch('/api/analytics/status',{cache:'no-store'}).then(r=>r.ok?r.json():null).then(value=>{if(value){recordConnection(value);render();}}).catch(()=>{});
  await Promise.all([saved,status]);
  if(!state.demo&&connectionReady&&connectionAuthorized)await refreshFromGoogle();
}
// Startup fetch remains separate from declarations for the browser test harness.
initializeDashboard();

export { number, signed, duration, hours, dayOffset, displayDate, escapeHTML, csvCell };
