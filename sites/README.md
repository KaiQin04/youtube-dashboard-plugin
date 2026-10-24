# Sites 部署適配

此目錄是套用到 Sites 官方 Vinext starter 的應用程式檔案，不包含部署 ID、執行期設定或資料庫。共享程式仍以根目錄 `src/` 為準，網站與 MCP 使用相同身分、報表與版面。

## 建立獨立部署

1. 使用 Sites 官方 skill，在新的空目錄執行 `project-setup.mjs`，建立獨立 Sites 專案並保存其回傳 ID。不要選擇既有網站的 checkout。
2. 從本 repository 執行 `node scripts/prepare-sites.mjs /absolute/path/to/fresh-sites-checkout`。腳本會複製共享核心、套用本目錄檔案，保留目標的 project ID 與環境設定；僅接受尚未改造的 starter。
3. 在目標目錄使用 Sites 官方 dependency installer 更新依賴與 lockfile，再以官方 build/source workflow 檢查、推送、封裝及部署。保留 starter 的 `sites()` Vite integration 和 Worker entrypoint。D1 binding 為 `DB`，schema migration 隨部署套用。
4. 部署環境設定 `PUBLIC_ORIGIN` 為 Sites 實際回傳的 HTTPS origin。管理者建立此部署專用的 Google OAuth Web client；回呼為該 origin 的 `/oauth/google/callback`。在託管平台的 Secrets UI 設定 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、`TOKEN_ENCRYPTION_KEY`，不要寫入此 repository。

`TOKEN_ENCRYPTION_KEY` 須是 32 bytes 隨機值的 base64url 編碼，並在同一部署的所有實例維持一致。Google 僅要求 `youtube.readonly` 和 `yt-analytics.readonly`；一般使用者只需登入和授權，不必持有 OAuth client。

## 身分邊界

這個適配使用 Sites Dispatch 提供的使用者身分，瀏覽器與原生 MCP 共用同一租戶；不讀取使用者 email 或全名。不要將此 wrapper 直接部署成可繞過 Dispatch 的公開 Worker，也不要以自行填入的 identity header 建立外部信任。

獨立 Node 主機的 Google OIDC 登入仍由 `createWebApp` 提供；其 MCP 需另設驗證器。Sites 登入與 Node 登入是不同的部署選項。

## 驗證與發行

根目錄 `npm test` 包含非同步 store、D1 SQL、OAuth callback 帳號綁定、HTTP/MCP 與版面隔離測試。D1 測試是在本機 SQLite 執行實際 migration，不能宣稱等同線上 D1 或真實 Google 帳號驗收。

初次部署請維持私人測試，完成兩個真實帳號的授權、channel ID 核對、少量唯讀同步、跨帳號拒絕、版面隔離及解除連線測試。平台建立的私人 Plugin 不代表已通過公開目錄審查。

公開前仍需完成定期資料清理、撤銷授權後刪除驗收、備份保留期限與維護者聯絡資訊；`/privacy` 和 `/terms` 是測試版草稿。上架案例見 [review-cases.md](../docs/review-cases.md)，不得以真正使用者帳號代替專用審查帳號。
