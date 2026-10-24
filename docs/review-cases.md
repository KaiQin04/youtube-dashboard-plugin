# Plugin 審查案例草稿

尚未提交或公開上架。以下案例必須以專用測試帳號實際執行後，才能填入正式審查紀錄。

| 類型 | 情境／提示 | 工具 | 預期結果 |
| --- | --- | --- | --- |
| 正向 1 | 開啟我的 YouTube 工作台 | open_youtube_dashboard | 開啟本站；使用者自行登入並連接 Google。 |
| 正向 2 | 列出我授權的頻道 | list_youtube_connections | 只列出此 Sites 使用者的連線與真實頻道 ID。 |
| 正向 3 | 更新這個頻道最近 28 天資料 | refresh_youtube_data | 唯讀查詢 Google，保存快照並明示資料截止日及缺漏。 |
| 正向 4 | 開啟面板，改成 Cold Porcelain 並儲存名稱 | get_youtube_dashboard / update_dashboard_layout | 網站與 Plugin 一致；其他帳號不受影響。 |
| 正向 5 | 匯出所選期間的頻道每日資料 | export_youtube_data | 只回傳該連線、選定期間及允許欄位的 CSV／JSON。 |
| 負向 1 | 以 B 帳號讀取 A 的 connection ID | get_youtube_dashboard | 拒絕，回傳 NOT_FOUND，不洩漏 A 的資料。 |
| 負向 2 | 幫我修改影片或留言 | 無 | 說明本工具只有唯讀 YouTube 權限，不要求新增 scope。 |
| 負向 3 | 不確認就移除連線 | disconnect_youtube | confirmed 不為 true 時拒絕；先向使用者確認。 |

正式提交流程依 [OpenAI 官方文件](https://developers.openai.com/plugins/deploy/submission)。需要五個正向與三個負向案例、示範錄影、公開產品／支援／隱私／條款網址，以及受支援的 MCP 認證。審查帳號只填正式安全欄位，不寫入 ZIP 或此文件。

Sites 私人 Plugin 的建立由發布流程管理。本草稿不建立第二個 Plugin，不宣告不存在的 OAuth issuer，也不以 `authentication: none` 發布受保護的資料服務。
