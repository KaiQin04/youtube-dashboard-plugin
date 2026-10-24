# 測試邊界

依使用者已核准的多人授權與資料隔離方案，採測試先失敗再實作的垂直切片。

1. 公開認證介面：驗證服務 token 的 issuer、audience、簽章、有效期與 scopes；拒絕偽造身分 header。
2. 授權介面：開始、Google callback、選擇已驗證頻道、refresh、斷線及資料刪除。state 必須限時、單次使用並綁定瀏覽器。
3. 資料介面：兩位使用者、不同及相同頻道的資料、快照、鎖、匯出與刪除隔離；刪除不得被正在執行的 callback、refresh 或同步復活。
4. HTTP／MCP：未驗證請求被拒絕、工具參數無法覆寫使用者、錯誤不回傳 token、回應明確區分授權與同步。
5. 可再現來源：僅白名單純程式模組及合成測試；無私人部署綁定或 runtime 檔案。
6. 版面偏好：沿用 service／MCP 公開介面，驗證跨使用者、同使用者不同連線、相同頻道、重啟、刪除後重新連接、唯讀權限及不合法欄位。瀏覽器另驗證保存、排序、隱藏、取消與切換帳號。

使用真正的 SQLite 與 jose 驗證器；只模擬 Google HTTP、時間與測試身分提供者。測試產生的金鑰僅保留在記憶體，不使用任何現存憑證。不把單機測試稱為真實 Google、公開託管或目錄驗收。

7. 資料積木 v2：可選指標／圖表、最多 16 區塊、影片欄位與排序、v1 遷移、五種預設。檢查所有主題的明暗文字對比。
8. 附加 Analytics 報表：固定五個查詢、完整／缺漏／空資料、重複分類、負值、回應筆數、截斷標示及授權失效。只模擬 Google HTTP 邊界，不新增 scope。
9. Loopback 合成示範：28 天、影片、分類與互動資料；總計一致、版面保存及跨帳號拒絕。實際瀏覽器另外驗證樣式預覽、取消、儲存、區塊編輯與帳號切換。

10. 瀏覽器登入：真實 jose 驗證合成 Google ID token，驗證錯誤簽章／issuer／audience／nonce／azp／期限、重播、取消、不同瀏覽器及跨 session callback。
11. 從兩個 Google subject 經完整 HTTP 登入、頻道選擇、同步和版面保存；同頻道不同使用者亦不共用快照。session 重建後必須重新登入，但 ownership／偏好不變。
12. 本機 HTTP：實際 listen 只綁 loopback；拒絕 Host 偽造、外站 Origin、超大 body；未登入不能載入面板。瀏覽器另外驗證表單 POST、跨分頁登出及重新登入。

13. 非同步 store 與 D1：使用實際 migration、複合鍵與條件 batch，檢查兩租戶、callback 所有人、限額、grant 版本、過期租約及同步冷卻競態。測試透過 SQLite 模擬 D1 binding，不冒充 Cloudflare runtime 驗收。
14. Sites HTTP/MCP：相同平台身分映射一致、偽造 header 不建立 principal、跨帳號 404、state 單次消耗、帳號切換後 CSRF 失效，以及缺設定時不建立 Google service。
15. Sites 套用腳本：僅接受新 starter，保留目標部署 ID 與既有環境檔，從當前共享來源打包網站和面板；部署識別碼不隨開源套件發行。

真實 Google 驗收需維護者提供獨立 OAuth 設定、兩個測試帳號及各自可讀取的頻道。授權由使用者在 Google 畫面完成；只核對實際 channel ID、資料範圍、隔離結果與刪除狀態，不記錄憑證值。準備不足時保留為未驗證，不能以合成測試代替。
