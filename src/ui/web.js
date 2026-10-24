(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const sites = document.documentElement.dataset.authMode === 'sites';
  const errors = { LOGIN_REQUIRED: '登入已失效，請重新登入。', CSRF_REJECTED: '帳號狀態已改變，請重新整理頁面。', CONFIGURATION: '網站尚未完成 YouTube 連線設定，暫時無法授權或同步。', PRIVACY_ACKNOWLEDGEMENT_REQUIRED: '請先閱讀並同意隱私說明。', REFRESH_COOLDOWN: '剛完成同步，請稍後再更新；可先開啟現有資料。', REAUTH_REQUIRED: 'Google 授權已失效，請重新連接頻道。', NO_CHANNEL: '此 Google 授權沒有可用的 YouTube 頻道。', CHANNEL_FORBIDDEN: '請選擇這次 Google 授權確認的頻道。', SYNC_IN_PROGRESS: '頻道正在同步，請稍後查看。' };
  let session = null, generation = 0, working = false, selected = null, brandRequest = 0;
  let configurationReady = !sites;
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('youtube-dashboard-session') : null;
  function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); $('notice').hidden = !text; }
  function updateConnectAvailability() { $('connect').disabled = working || !configurationReady || sites && !$('privacy-consent').checked; }
  function applyReadiness(value) { if (sites) { configurationReady = value.configurationReady === true; $('setup-status').hidden = configurationReady; updateConnectAvailability(); } }
  function clearPrivateView() { brandRequest++;applyBrand(document,{});generation++; selected = null; $('panel').removeAttribute('src'); $('dashboard-area').hidden = true; $('connections').replaceChildren(); $('workspace').hidden = true; if (sites) { $('privacy-consent').checked = false; updateConnectAvailability(); } }
  function signedOut() { clearPrivateView(); session = null; $('signed-out').hidden = false; $('loading').hidden = true; }
  function signOutSites() {
    // The platform authentication endpoint requires a full document navigation.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.assign('/signout-with-chatgpt?return_to=%2F');
  }
  async function api(path, data) {
    const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken ?? '' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const value = await response.json();
    if (path === '/api/session') applyReadiness(value);
    if (!response.ok) { if (response.status === 401) signedOut(); throw new Error(errors[value.error?.code] ?? '操作未完成，請稍後重試。'); }
    return value;
  }
  async function refreshSession() {
    const before = generation;
    try {
      const value = await api('/api/session');
      if (before !== generation) return;
      if (session && session.csrfToken !== value.csrfToken) clearPrivateView();
      session = value; $('account').textContent = value.accountLabel; $('signed-out').hidden = true; $('workspace').hidden = false; $('loading').hidden = true; updateConnectAvailability();
      await connections();
    } catch (error) { if (!session) signedOut(); else notice(error.message, true); }
  }
  async function busy(action) {
    if (working) return; working = true; $('connect').disabled = true;
    try { await action(); } catch (error) { notice(error.message, true); }
    finally { working = false; updateConnectAvailability(); }
  }
  function element(tag, text, className) { const item = document.createElement(tag); if (text) item.textContent = text; if (className) item.className = className; return item; }
  function openPanel(id) { brandRequest++;applyBrand(document,{});selected = id; $('dashboard-area').hidden = false; $('panel').src = '/panel?connection=' + encodeURIComponent(id); }
  async function sync(id) {
    notice('正在同步最近 28 天；會依實際頻道 ID 核對 API 資料。');
    const current = generation;
    const reply = await api('/browser/rpc', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'refresh_youtube_data', arguments: { connectionId: id } } });
    if (current !== generation) return;
    if (reply.error || reply.result?.isError) throw new Error(errors[reply.result?.structuredContent?.error?.code] ?? '同步未完成；授權與既有資料仍保留，可稍後重試。');
    notice('已授權 · 已同步。'); await connections(); openPanel(id);
  }
  function action(label, run) { const button = element('button', label, 'quiet'); button.type = 'button'; button.addEventListener('click', () => busy(async () => { button.disabled = true; try { await run(); } finally { button.disabled = false; } })); return button; }
  async function connections() {
    const current = generation, value = await api('/api/connections'); if (current !== generation) return;
    $('connections').replaceChildren();
    if (!value.connections.length) { $('connections').append(element('p', '尚未連接頻道。先授權 YouTube，再選擇頻道與同步資料。', 'empty')); return; }
    for (const connection of value.connections) {
      const card = element('article', '', 'connection'), info = element('div'), actions = element('div', '', 'connection-actions');
      const title = element('h3', connection.channel?.title ?? '等待確認的頻道');
      title.append(element('span', connection.status === 'select_channel' ? '待選擇頻道' : connection.status === 'authorizing' ? '授權未完成' : connection.connected ? '已授權' : '需要重新授權', 'status')); info.append(title);
      if (connection.channel) info.append(element('code', connection.channel.id));
      if (connection.status === 'select_channel') {
        const select = element('select'); select.setAttribute('aria-label', '選擇已驗證的 YouTube 頻道');
        for (const item of connection.channels) { const option = element('option', item.title + ' · ' + item.id); option.value = item.id; select.append(option); } info.append(select);
        actions.append(action('選擇並同步最近 28 天', async () => { await api('/api/connections/' + connection.id + '/channel', { channelId: select.value }); await connections(); await sync(connection.id); }));
      } else if (connection.channel) {
        info.append(element('p', connection.syncState === 'synced' ? '已有同步快照 · 可開啟檢視與自訂版面' : '尚未同步 · Google 授權成功不代表已取得分析資料'));
        actions.append(action('開啟儀表板', () => openPanel(connection.id)));
        if (connection.connected) actions.append(action('同步最近 28 天', () => sync(connection.id)));
        else info.append(element('p', '請按「連接 YouTube 頻道」重新授權。舊快照與版面仍保留在原連線。'));
      } else info.append(element('p', '授權尚未完成；未完成的連線會在 10 分鐘後移除。'));
      card.append(info, actions); $('connections').append(card);
    }
    if (selected && !value.connections.some(item => item.id === selected)) { selected = null; $('panel').removeAttribute('src'); $('dashboard-area').hidden = true; }
  }
  $('connect').addEventListener('click', () => busy(async () => { if (sites && !$('privacy-consent').checked) throw new Error(errors.PRIVACY_ACKNOWLEDGEMENT_REQUIRED); const start = await api('/oauth/google/start', sites ? { acceptedPrivacy: true } : {}); location.assign(start.authorizationUrl); }));
  $('logout').addEventListener('click', async () => { clearPrivateView(); if (sites) { session = null; channel?.postMessage('changed'); signOutSites(); return; } try { await api('/auth/logout', {}); signedOut(); channel?.postMessage('changed'); notice('已登出。頻道授權與個人版面已保留，下次登入可繼續使用。'); } catch (error) { notice(error.message, true); await refreshSession(); } });
  window.addEventListener('message', async event => {
    const frame = $('panel'), message = event.data, current = generation;
    if (!session || event.source !== frame.contentWindow || event.origin !== location.origin || message?.jsonrpc !== '2.0' || !Object.hasOwn(message, 'id')) return;
    const destination = event.source;
    const brandRead=message.method==='tools/call'&&message.params?.name==='get_youtube_dashboard';
    const brandStamp=brandRead?++brandRequest:brandRequest;
    try {
      let reply;
      if (message.method === 'ui/initialize') reply = { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'youtube-dashboard-web', version: '0.1.0' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light' } } };
      else reply = await api('/browser/rpc', message);
      if (current === generation && destination === frame.contentWindow) {
        if(!reply.result?.isError&&brandStamp===brandRequest){
          const content=reply.result?.structuredContent;
          if(brandRead&&content?.layout&&content.connection?.id===message.params?.arguments?.connectionId){selected=content.connection.id;applyBrand(document,content.layout);}
          if(message.params?.name==='update_dashboard_layout'&&message.params?.arguments?.connectionId===selected&&content?.version)applyBrand(document,content);
        }
        destination.postMessage(reply, location.origin);
      }
    } catch (error) { if (current === generation) destination.postMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }, location.origin); }
  });
  channel?.addEventListener('message', () => { clearPrivateView(); session = null; refreshSession(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshSession(); });
  window.addEventListener('pagehide', clearPrivateView);
  window.addEventListener('pageshow', event => { if (event.persisted) { session = null; refreshSession(); } });
  const event = new URL(location.href).searchParams.get('notice');
  if (event) {
    const messages = { SIGNED_IN: '已登入。請連接 YouTube 頻道，或開啟既有儀表板。', LOGIN_FAILED: 'Google 登入未完成或已過期，請從登入按鈕重新開始。', YOUTUBE_CONNECTED: 'YouTube 授權已完成。請核對下方頻道 ID，再開始同步。', YOUTUBE_AUTH_FAILED: 'YouTube 授權未完成或登入狀態已改變，請重新連接。' };
    if (messages[event]) notice(messages[event], event.endsWith('FAILED'));
    history.replaceState(null, '', '/'); if (event === 'SIGNED_IN') channel?.postMessage('changed');
  }
  $('demo-banner').hidden = document.documentElement.dataset.synthetic !== 'true';
  if (sites) {
    $('legacy-login').hidden = true; $('sites-login').hidden = false;
    $('login-note').textContent = '以 ChatGPT 辨識你的工作台；YouTube 唯讀授權會在下一步另行取得。';
    $('privacy-notice').hidden = false; $('sites-policy-links').hidden = false;
    $('privacy-consent').addEventListener('change', updateConnectAvailability);
    updateConnectAvailability();
  }
  applyBrand(document,{});
  refreshSession();
})();
