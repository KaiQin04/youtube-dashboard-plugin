/** Minimal MCP Apps bridge. Messages stay within the host-managed sandbox. */
import {sourceVideoUrl} from './source-videos.mjs';
export function connectPanelHost({window, onResult, onReady, onError, requestPrefix='dashboard-'}) {
  const parent = window.parent;
  const pending = new Map();
  let sequence = 0, ready = false, closed = false;
  let origin = '*';
  const post = message => parent.postMessage({jsonrpc:'2.0', ...message}, origin);
  function request(method, params, timeout = 600000) {
    if (closed) return Promise.reject(new Error('Panel closed.'));
    const id = requestPrefix + (++sequence);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error('Panel request timed out.'));
      }, timeout);
      pending.set(id, {resolve, reject, timer});
      post({id, method, params});
    });
  }
  function close() {
    closed = true;
    window.removeEventListener('message', receive);
    for (const item of pending.values()) {
      window.clearTimeout(item.timer);
      item.reject(new Error('Panel closed.'));
    }
    pending.clear();
  }
  function receive(event) {
    if (closed || event.source !== parent || (origin !== '*' && event.origin !== origin)) return;
    const data = event.data;
    if (!data || data.jsonrpc !== '2.0') return;
    if (pending.has(data.id) && (Object.hasOwn(data,'result') || Object.hasOwn(data,'error'))) {
      const item = pending.get(data.id);
      pending.delete(data.id);window.clearTimeout(item.timer);
      if (event.origin && event.origin !== 'null') origin = event.origin;
      if (data.error) item.reject(new Error('Host request failed.'));
      else item.resolve(data.result);
    } else if (ready && data.method === 'ui/notifications/tool-result') onResult(data.params);
    else if (ready && data.method === 'ping' && data.id !== undefined) post({id:data.id,result:{}});
    else if (ready && data.method === 'ui/resource-teardown' && data.id !== undefined) {
      post({id:data.id,result:{}});close();
    }
  }
  window.addEventListener('message', receive);
  const bridge = {
    async callTool(name, args) {
      if (!ready || !['get_youtube_dashboard','list_youtube_connections','update_dashboard_layout','open_youtube_dashboard','get_latest_youtube_data','get_dashboard_preferences','update_dashboard_preferences','get_dashboard_view','refresh_youtube_data','get_analytics_report','refresh_analytics_report'].includes(name)) throw new Error('Tool unavailable.');
      return request('tools/call', {name, arguments:args});
    },
    async openVideo(id){
      const url=sourceVideoUrl(id);if(!ready||!url)throw new Error('Video link unavailable.');
      return request('ui/open-link',{url},15000);
    },
    close,
  };
  request('ui/initialize', {
    appInfo:{name:'YouTube Dashboard',version:'0.3.1'},
    appCapabilities:{availableDisplayModes:['inline','fullscreen']},
    protocolVersion:'2026-01-26',
  }, 15000).then(result => {
    if (!result || result.protocolVersion !== '2026-01-26') throw new Error('Unsupported host.');
    ready = true;
    post({method:'ui/notifications/initialized'});
    onReady(bridge);
  }).catch(() => {close();onError();});
  return bridge;
}
