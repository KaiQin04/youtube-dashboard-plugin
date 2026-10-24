# 只維護一份核心

`src/` 是分析、報表、版面、編輯器與渲染器的唯一維護來源。本機 Plugin、瀏覽器工作台與選用 Sites adapter 都使用它；既有 owner-bound 網站透過鎖定版本的產生副本使用相同程式碼。

既有網站只保留 HTTP／MCP 身分驗證、owner／channel 綁定及傳輸 adapter。`src/compat/` 保留既有 grant 加密格式、原本設定的 AAD context、資料表、快取鍵及版面 revision。整合不搬遷資料、不重新加密、不要求新 Google 權限。

名稱、圖標、副標題、origin 與舊版相容識別設定放在網站自己的 `settings/dashboard.mjs`。頻道與 Google 憑證、加密金鑰繼續從執行期設定讀取；前端只注入白名單內的顯示預設值。公開來源和發行包不包含這份私人設定。

`scripts/sync-owner-site.mjs` 從明確來源產生 vendor、後端 re-export、網站資產及 Plugin 面板，以 `dashboard-core.lock.json` 記錄 public commit 與檔案雜湊。腳本不搜尋或載入環境檔、runtime profile 或資料庫；首次傳輸 adapter 的接線需另外檢查。完整呼叫方式見 [English integration guide](owner-site-integration.en.md)。

整合後在網站執行 `node scripts/build-dashboard-panel.mjs --check`，可檢查核心及生成資產是否漂移。後續只修改公開核心，測試、commit 後從確切版本重新產生；不要另外修改 vendor 或瀏覽器產物。產生與 commit 不會部署網站。

本機驗證使用合成授權與隔離資料庫，涵蓋既有密文可讀且不重寫、資料列與 revision 保留、跨 owner／channel／tenant 阻擋、報表快取與漂移檢查。這些測試不等於真實 Google 或正式站部署驗收。
