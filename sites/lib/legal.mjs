const sections = {
  '/privacy': ['隱私說明 · 測試版本', `<p>本服務使用 YouTube API Services。你以 ChatGPT 登入工作台，再自行授權 Google 存取自己的 YouTube 頻道。我們不要求你提交 Google 密碼、Client Secret 或授權碼。</p>
<h2>我們處理的資料</h2><p>站內使用者識別碼、你授權的頻道與影片標題及 ID、發布日期、觀看與互動分析、流量來源與國家／裝置彙總，以及你設定的名稱、主題、版面與圖示。可存取的影片可能包含私人或不公開影片的資訊。本版本不接入留言全文，不要求 Google email 或 profile 權限。</p>
<h2>資料用途與接收者</h2><p>資料用於同步、顯示及匯出你自己的儀表板。資料儲存在 Sites 配置的 Cloudflare D1；Google token 加密儲存。一般報表與版面以結構化資料儲存。使用 Plugin 工具時，回傳的報表、名稱及匯出內容可由 ChatGPT／MCP host 及模型讀取，並非只在面板顯示。請勿在自訂名稱與圖示輸入不必要的個人資料。</p>
<h2>控制與刪除</h2><p>登出保留資料。解除連線會刪除此連線的線上資料及版面，並嘗試撤銷 Google 授權；撤銷可能影響同一應用程式的其他連線。你也可以在 <a href="https://myaccount.google.com/permissions">Google 帳戶權限</a>撤銷授權。此操作不宣稱即時抹除平台備份或已回傳至對話的內容。</p>
<h2>公開發行狀態</h2><p>目前是私人部署驗收版，尚未開放一般使用者或設定 Google OAuth。公開發行前，維護者必須公布聯絡／刪除申請管道、備份保留期限，並完成失效授權及資料清理驗收。本頁不將尚未完成的控制宣稱為已實施。</p>
<p>另請閱讀 <a href="https://policies.google.com/privacy">Google 隱私權政策</a>、<a href="https://www.youtube.com/t/terms">YouTube 服務條款</a>與本站<a href="/terms">使用條款</a>。版本：2026-10-24。</p>`],
  '/terms': ['使用條款 · 測試版本', `<p>YouTube Dashboard 是自訂分析工作台，使用 YouTube API Services；使用本服務亦須遵守 <a href="https://www.youtube.com/t/terms">YouTube 服務條款</a>。本服務不是 YouTube 或 Google 官方產品。</p><p>請只連接你有權存取的頻道。分析可能有延遲、隱私門檻及 API 缺漏，不等同 YouTube Studio 即時數據。請先閱讀並同意<a href="/privacy">隱私說明</a>。</p><p>目前限私人測試，尚未完成真實雙帳號驗收與公開上架。版本：2026-10-24。</p>`],
};

/** Legal notices contain no runtime identity, credentials or analytics. */
export function legalResponse(path) {
  const item = sections[path];
  if (!item) return null;
  const [title, body] = item;
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/assets/web.css"></head><body><main class="shell"><a href="/">返回工作台</a><h1>${title}</h1>${body}</main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' } });
}
