import { connectPanelHost } from '../dashboard/panel-bridge.mjs';
import { createCustomizer } from '../dashboard/editor.mjs';
import { defaultLayout } from '../dashboard/layout.mjs';
import { renderWidgets } from '../dashboard/widgets.mjs';
import { createReportActions } from '../dashboard/report-actions.mjs';
import { bindSourceVideoInteractions } from '../dashboard/source-videos.mjs';
import { widgetData } from '../dashboard/projection.mjs';

const $ = id => document.getElementById(id);
let host, selected = '', data = null, layout = defaultLayout(), customizer, busy = false;
const notice = text => { $('panel-status').textContent = text; };
async function call(name, args = {}) {
  const reply = await host.callTool(name, args);
  if (reply?.isError) throw new Error('操作未完成，保留目前資料。');
  return reply.structuredContent;
}
function controls() {
  $('connections').disabled = busy;
  $('customize-button').disabled = busy || !selected;
  $('panel-reload').disabled = busy;
  $('panel-refresh').disabled = busy || !selected || data?.status?.connected !== true;
}
function render() {
  $('panel-heading').textContent = layout.dashboardTitle?.trim() || '頻道總覽';
  $('layout-name-label').textContent = layout.name?.trim() ? '版面：' + layout.name.trim() : '';
  $('layout-name-label').hidden = !layout.name?.trim();
  if (!data) return;
  const range = data.range;
  $('panel-period').textContent = `${range.requestedStart ?? '—'}–${range.requestedEnd ?? '—'} · API 可用至 ${data.status.completeThrough ?? '—'} · 非即時資料`;
  $('view').innerHTML = renderWidgets(layout, data, range, { authorized: data.status.connected, reconnectRequired: !data.status.connected });
}
const reports = createReportActions({ getData: () => data, getLayout: () => layout, getRange: () => ({ startDate: data?.range?.requestedStart, endDate: data?.range?.requestedEnd }), render, notice, transport: (args, refresh) => call(refresh ? 'refresh_analytics_report' : 'get_analytics_report', { connectionId: selected, ...args }) });
async function read(refresh = false) {
  if (!selected) return;
  const id = selected;
  const result = await call(refresh ? 'refresh_youtube_data' : 'get_youtube_dashboard', { connectionId: id });
  if (id !== selected) return;
  data = widgetData(result); layout = result.layout; render();
  await customizer.load(); await reports.readSelected();
  notice(data.status.connected ? data.status.hasData ? '已授權 · 已顯示保存資料' : '已授權 · 尚未同步' : '授權已失效 · 顯示保存資料，請重新連接。');
}
async function run(action) {
  if (busy) return; busy = true; controls();
  try { await action(); } catch { notice('本次操作未完成，保留目前資料。'); }
  finally { busy = false; controls(); }
}
async function loadConnections() {
  const result = await call('list_youtube_connections');
  if (result.setupUrl) {
    const url = new URL(result.setupUrl);
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash) {
      $('setup-link').href = url.href; $('setup-link').hidden = false;
    }
  }
  $('connections').replaceChildren();
  for (const connection of result.connections) {
    if (!connection.channel) continue;
    const option = document.createElement('option'); option.value = connection.id; option.textContent = connection.channel.title; $('connections').append(option);
  }
  const preferred = selected || new URL(location.href).searchParams.get('connection');
  if ([...$('connections').options].some(option => option.value === preferred)) $('connections').value = preferred;
  selected = $('connections').value;
  if (!selected) { notice(result.configurationReady === false ? '請開啟「Google 設定與頻道授權」，在自己的瀏覽器完成首次設定。' : '尚未連接頻道，請先完成 Google 授權並選擇頻道。'); return; }
  await read();
}
async function ready(bridge) {
  host = bridge;
  customizer = createCustomizer({ getData: () => data ?? {}, onChange: next => { layout = next; render(); }, onNotice: notice, onSessionExpired: () => { data = null; $('view').replaceChildren(); }, transport: async body => {
    const id = selected;
    if (!id) return Response.json({ error: { code: 'NOT_CONNECTED' } }, { status: 400 });
    const value = body === undefined ? (await call('get_youtube_dashboard', { connectionId: id })).layout : await call('update_dashboard_layout', { connectionId: id, layout: body.layout });
    if (id !== selected) throw new Error('Connection changed');
    return Response.json({ layout: value, revision: 0 });
  } });
  await run(loadConnections);
}
$('connections').addEventListener('change', () => {
  selected = $('connections').value; data = null; $('view').replaceChildren(); customizer?.invalidate(); run(() => read());
});
$('panel-reload').addEventListener('click', () => run(loadConnections));
$('panel-refresh').addEventListener('click', () => run(() => read(true)));
$('view').addEventListener('click', event => { const button = event.target.closest('[data-report-widget]'); if (button) reports.update(button.dataset.reportWidget); });
bindSourceVideoInteractions($('view'), { openVideo: id => host.openVideo(id), onError: () => notice('主機無法開啟影片連結，請在自己的瀏覽器開啟。') });
connectPanelHost({ window, onResult: () => {}, onReady: ready, onError: () => notice('面板無法連接主機，請重新開啟 Plugin。') });
