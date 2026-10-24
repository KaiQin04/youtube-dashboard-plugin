(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let session, busy = false;
  function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
  async function api(path, value) {
    const response = await fetch(path, { method: value === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: value === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': session?.csrfToken ?? '' }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? 'The request did not complete.');
    return data;
  }
  async function tool(name, args = {}) {
    const reply = await api('/browser/rpc', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    if (reply.error || reply.result?.isError) throw new Error(reply.result?.structuredContent?.error?.message ?? 'The request did not complete.');
    return reply.result.structuredContent;
  }
  function button(label, action) { const item = document.createElement('button'); item.className = 'quiet'; item.textContent = label; item.onclick = () => run(action); return item; }
  function openPanel(id) { $('dashboard-area').hidden = false; $('panel').src = '/panel?connection=' + encodeURIComponent(id); }
  async function refresh() {
    session = await api('/api/session'); $('setup').hidden = session.configurationReady;
    $('connect').disabled = busy || !session.configurationReady || !$('consent').checked;
    const data = await api('/api/connections'); $('connections').replaceChildren();
    for (const connection of data.connections) {
      const card = document.createElement('article'); card.className = 'connection';
      const text = document.createElement('p'); text.textContent = connection.channel ? `${connection.channel.title} · ${connection.channel.id} · ${connection.connected ? 'Authorized' : 'Reconnect required'} · ${connection.syncState}` : connection.status;
      card.append(text);
      if (connection.status === 'select_channel') {
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Verified YouTube channel');
        for (const channel of connection.channels) { const option = document.createElement('option'); option.value = channel.id; option.textContent = channel.title + ' · ' + channel.id; select.append(option); }
        card.append(select, button('Use this channel', async () => { await tool('select_youtube_channel', { connectionId: connection.id, channelId: select.value }); await refresh(); openPanel(connection.id); }));
      }
      if (connection.channel) {
        card.append(button('Open dashboard', () => openPanel(connection.id)));
        if (connection.connected) card.append(button('Update last 28 days', async () => { await tool('refresh_youtube_data', { connectionId: connection.id }); await refresh(); openPanel(connection.id); }));
      }
      card.append(button('Disconnect and delete local data', async () => {
        if (!window.confirm('Delete this connection and its saved reports/layout? Google revocation can affect other connections using the same OAuth application.')) return;
        await tool('disconnect_youtube', { connectionId: connection.id, confirmed: true }); $('panel').removeAttribute('src'); $('dashboard-area').hidden = true; await refresh();
      }));
      $('connections').append(card);
    }
    if (!data.connections.length) $('connections').textContent = 'No connected channels yet.';
  }
  async function run(action) { if (busy) return; busy = true; try { await action(); } catch (error) { notice(error.message); } finally { busy = false; $('connect').disabled = !session?.configurationReady || !$('consent').checked; } }
  $('settings').addEventListener('submit', event => { event.preventDefault(); run(async () => { const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); try { await api('/api/local/config', values); notice('Saved locally. You can now authorize your YouTube channel.'); } finally { form.reset(); } await refresh(); }); });
  $('connect').onclick = () => run(async () => { const data = await api('/oauth/google/start', { acceptedPrivacy: $('consent').checked }); location.assign(data.authorizationUrl); });
  $('consent').onchange = () => { $('connect').disabled = busy || !session?.configurationReady || !$('consent').checked; };
  $('reload').onclick = () => run(refresh);
  $('callback').textContent = location.origin + '/oauth/google/callback';
  window.addEventListener('message', async event => {
    const frame = $('panel'), message = event.data;
    if (event.source !== frame.contentWindow || event.origin !== location.origin || message?.jsonrpc !== '2.0' || !Object.hasOwn(message, 'id')) return;
    try {
      const result = message.method === 'ui/initialize' ? { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'youtube-dashboard-local', version: '0.3.1' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light' } } } : await api('/browser/rpc', message);
      const layout = message.params?.name === 'get_youtube_dashboard' ? result.result?.structuredContent?.layout : message.params?.name === 'update_dashboard_layout' ? result.result?.structuredContent : null;
      if (layout) applyBrand(document, layout);
      if (event.source === frame.contentWindow) event.source.postMessage(result, location.origin);
    } catch { event.source.postMessage({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'Local dashboard request failed.' } }, location.origin); }
  });
  const access = new URLSearchParams(location.hash.slice(1)).get('access');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  const params = new URL(location.href).searchParams;
  if (params.has('notice')) { notice(params.get('notice') === 'YOUTUBE_CONNECTED' ? 'Authorized. Verify the channel ID before syncing.' : 'Authorization did not complete. Start again from Connect YouTube.'); history.replaceState(null, '', '/'); }
  applyBrand(document, {}); run(async () => { if (access) await api('/api/local/unlock', { token: access }); await refresh(); });
})();
