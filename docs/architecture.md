# 架構與操作界線

## 共享來源與自架入口

`src/` 是唯一維護的 dashboard/service 來源。`local-workspace`、`web-app` 與 `sites-app` 只負責各執行環境的身分和交接；統計、Google API adapter、SQLite/D1 介面、版面與面板都共用。安裝包與 Sites build 中的複本是由此來源產生的產物，不另外手改。

本機 Plugin 以 stdio 連接同一 `DashboardService`，瀏覽器以 loopback HTTP 和 HttpOnly cookie/CSRF 存取同一 profile。只有一位 OS 擁有者，不再多加 Google OIDC 登入；YouTube OAuth 使用一個自行管理的 Web client。profile 中的 owner ID 由程式產生，不能由工具參數指定。

品牌名稱、副標題、顯示開關、圖標、主題、資料與憑證屬於使用者設定／儲存層；公開來源維持通用預設。OAuth 設定表單只寫本機檔案，工具與狀態回應不讀回設定值。細節及信任界線見 [self-hosting.en.md](self-hosting.en.md)。

既有 owner-bound 網站透過 `src/compat/` 與產生的 vendor 副本引用同一核心，保留既有 schema、owner binding、grant context 與版面 revision，不搬入本機 profile。來源 commit 與生成雜湊由 lock manifest 固定；下載安裝不會自動修改或部署既有網站。見 [整合流程](owner-site-integration.md)。

## 分層

`auth/identity` 驗證服務 token → 不可由普通物件偽造的 principal → `DashboardService` → 以 user/connection 綁定的 SQLite 與加密 Google grant → 固定 Google API adapter。

`createApp` 提供 HTTP、OAuth cookie 交接及 MCP 路由。`mcp` 宣告工具 schema、行為標記及面板資源。`analytics` 保留純資料契約、統計、日期、匯出與有界 YouTube 查詢。

## Bearer adapter 的 Google 授權

1. 已通過服務身分驗證的請求呼叫 `POST /oauth/google/start`。後端建立隨機 connection、state、PKCE verifier 與 browser nonce。
2. state／nonce 僅存雜湊；PKCE verifier 加密保存。回應將 nonce 放入按 state 區分的 HttpOnly、Secure、SameSite=Lax cookie；JSON 不回傳 nonce。
3. 瀏覽器前往 Google，同意兩個唯讀 scopes。callback 必須符合固定 origin/path、唯一 state、單次 code、有效 browser cookie 與十分鐘期限。
4. SQL 原子消耗 state，並用伺服器憑證交換 token。從 `channels.list(mine=true)` 核對頻道；grant 暫存於待選頻道的連線。
5. 同一服務使用者呼叫選頻道介面，僅能選剛驗證的清單。選定後頻道不可覆寫，需新增連線才能換頻道。

Google callback 綁定開始時已驗證的使用者與瀏覽器 nonce，沒有從 callback query 接受使用者身分。服務 token、Google token、PKCE、browser nonce 都不進入 MCP 工具輸出。

## Bearer adapter 的 HTTP

| 方法／路徑 | 用途 |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` | 公開服務認證 discovery |
| `POST /oauth/google/start` | 需服務 read/manage scopes；設定瀏覽器 cookie |
| `GET /oauth/google/callback` | Google 回呼；成功後清除 cookie 並導向無 code 的頁面 |
| `GET /api/connections` | 自己的連線 |
| `GET /api/connections/:id` | 狀態與頻道 |
| `GET /api/connections/:id/data` | 自己的儀表板快照 |
| `POST /api/connections/:id/channel` | 選擇已驗證頻道 |
| `POST /api/connections/:id/sync` | 更新快照 |
| `POST /api/connections/:id/disconnect` | 明確確認後移除 |
| `POST /mcp` | stateless JSON Streamable HTTP MCP |

除 discovery、結果文字頁及 Google callback 外，HTTP 均需有效 Bearer 服務 token。工具與 JSON 欄位採 allowlist；多餘的 userId、ownerId、任意 URL 或 channel 改寫參數會被拒絕。沒有 CORS 放行；有 Origin 時必須與設定 origin 相同。

## 儲存與競態

- 所有資料查詢、更新與刪除都帶 user_id 與 connection_id；兩位使用者即使連到相同頻道也分開保存。
- grant 使用 AES-256-GCM；AAD 包含版本、使用者、連線、用途及選定頻道。調換加密資料不可解密。
- callback 原子消耗、refresh 版本 compare-and-swap、grant/sync 有期限的鎖、快照有鎖持有人及連線狀態驗證。
- 刪除連線以外鍵連鎖刪除 state、grant、快照、鎖、版面偏好，網路請求完成後不得重建已刪除資料。
- SQLite adapter 適用單機共享資料庫。跨主機部署、集中式排程、備份清除與 key rotation 仍需另行設計及測試。

Sites 適配另外使用 `D1Store` 和部署時 migration。Service 以非同步介面存取 store；連線建立、state 消耗與 grant 更新使用條件寫入和 D1 batch。同步先取得鎖，再讀取最新快照檢查冷卻，避免兩個實例同時使用過期快照判斷。資料仍以 user/connection 複合鍵隔離，待完成連線最多 5 個。

## 目前刻意保留的限制

面板偏好由 `get_youtube_dashboard` 讀取、`update_dashboard_layout` 保存，後者需 manage scope。固定版本與選項白名單，不接受 HTML、任意 CSS、外部網址或 caller-selected user ID。排序按鈕可用鍵盤操作；沒有自由拖拉或自訂程式碼。設定每次讀取皆由服務身分解析，不寫入瀏覽器共用 localStorage。相同連線的並行偏好修改採最後一次成功寫入。

尚未提供完整公開 MCP authorization server 與網頁身分連結設定、背景排程、超過 500 支影片的續跑、機器層／網路層限流、真實 Google 與 OpenAI host 驗收。這些屬下一階段部署前工作。

目前保留每個連線的最新有界快照，不聲稱永久歷史倉庫。刪除是本地邏輯刪除，SQLite/WAL、主機備份與遠端 Google 的資料保存政策需由部署方一併處理。

## 原始文件

- [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)
- [OpenAI MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Google web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [YouTube channels.list](https://developers.google.com/youtube/data/reference/rest/v3/channels/list)

## 瀏覽器登入 adapter

`createWebApp` 與外部 MCP Bearer adapter 分開。Google OIDC code flow 使用 state、nonce、PKCE 與固定 Google JWKS；通過驗證後建立 HttpOnly session，沒有將 Google token 當作 MCP token。登入只要求 openid。`/api/session` 提供不含 email 的帳號標記及 CSRF 值；所有寫入均需相同 Origin 與 session CSRF。

`POST /auth/login` → `/auth/google/callback` → 個人頻道頁；YouTube 的 `/oauth/google/start` 把 browser nonce 保留在伺服器，綁定目前 session。callback 必須回到相同且仍有效的 session；state 另外由 SQLite 原子消耗。選頻道／同步沿用既有 Service 的使用者邊界。`GET /panel` 需登入，`POST /browser/rpc` 使用 session 身分；公開 `/mcp` 與 discovery 在此 adapter 回傳未設定。

登入、session、待完成授權各有 1000 筆記憶體上限；仍需部署層限流。session 8 小時上限／30 分鐘閒置、state 10 分鐘。重啟清空 session，Google subject 保持同一資料擁有者。瀏覽器不存憑證或版面於 localStorage，登出／跨分頁變更／bfcache 回復會清除私人畫面並重新確認 session。

本機啟動器只接受明確 numeric loopback HTTP，建立獨立私有 SQLite 路徑；遠端服務預設仍要求 HTTPS。完整設定與限制見 [local-setup.md](local-setup.md)。

## Sites adapter

`createSitesApp` 使用平台驗證的站內 ID，依站點 origin 建立獨立租戶命名空間。此 ID 只由官方 Dispatch wrapper 傳入，不接受工具參數指定。網站與 MCP 使用相同身分；不建立第二套 Google OIDC 登入。

Google callback 必須符合當下 Sites 使用者、持久化 state 擁有者、瀏覽器 nonce 和有效期限。登入帳號切換後，另一個使用者既無法消耗該 state，也不能讀取或更新連線。瀏覽器寫入另驗證同源及使用者綁定的 CSRF。

未設定 Google OAuth 時，頁面仍可登入和閱讀說明；連接與同步停用，僅回傳缺少設定的名稱。對外回應不包含 Google grant 或執行期秘密值。部署與公開上架限制見 [Sites 說明](../sites/README.md)。
