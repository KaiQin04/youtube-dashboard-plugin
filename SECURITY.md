# 安全界線

## Local Plugin boundary

The local Plugin uses a single-owner OS profile and a numeric-loopback HTTP workspace. It does not import another project's environment or credentials. Local stdio tools and browser requests resolve ownership from that profile, never caller-supplied IDs. HttpOnly cookies and CSRF protect browser writes; Google callbacks also bind one-use state, PKCE and browser nonce.

The profile directory/files use POSIX `0700`/`0600`; Windows ACLs must be checked by the user. Google grants are encrypted at rest, but client settings, encryption keys and report snapshots are local files, not an OS credential vault. Protect disk/backups and the OS account. Same-account software is inside this trust boundary.

Requested tool/report output is sent to the chat host/model; do not describe the Plugin as completely offline. Never log credential values, callbacks, cookies or provider payloads. Setup assistants must hand off credential entry and stop browser observation until the user finishes.

The legacy multi-user browser adapter and optional Sites transport retain their own deployment/security requirements below. Installing the local Plugin does not deploy them or migrate existing grants. The `.env.local` instructions below apply only to the legacy multi-user adapter; the default local setup writes its own separate profile.

這是待實際部署驗收的開發版本；合成測試不構成安全認證。

- 不收集帳號密碼、OAuth client secret、OTP 或 token 作為工具參數。正式部署秘密透過主機 secret manager 設定；本機由使用者私下編輯受權限保護、Git 忽略的 `.env.local`。
- 開源 repository 不包含真實憑證、個人頻道快照、資料庫、Google Console 截圖、部署包或私人 Git 歷史。
- `createIdentityVerifier` 驗證簽章、固定 issuer/audience、exp、iat、nbf 與必要 scopes。只接受 RS256/ES256，驗證金鑰來源由伺服器配置，不能由請求選擇。
- `SqliteStore`、`Vault` 與 provider client 是伺服器內部介面。不要將它們或任意資料庫查詢暴露為工具；外部請求只進 `createApp`／`createWebApp`／`DashboardService`。
- HTTP 回應只含固定錯誤類別與訊息；不傳回 provider body、stack trace 或 token。反向代理與身分服務也必須停用 Authorization、Cookie、callback query 的原文記錄。
- 資料庫不得放在公開靜態目錄；部署者須設定檔案權限、磁碟／備份保護、key rotation、日誌保留及清理政策。
- 解除連線先刪除本地資料，再嘗試遠端撤銷，失敗明示未確認。Google 撤銷的範圍可能超出這個本地連線，需在正式介面說明。
- 本機合成示範不是認證服務。它固定綁定 loopback，禁止轉接到公開網路或接入真實資料。
- 公開部署前須補主機層請求限流、公開 MCP 身分連結、Google 政策審核、雙真實帳號隔離測試及正式面板驗收。

尚未指定公開安全通報管道；GitHub 發布前由維護者補上私人通報方式，避免在公開 issue 貼出憑證或私人資料。

- Google 網頁登入用 jose 驗證固定 Google issuer／client audience／RS256／期限／nonce／azp，以 subject 建立身分；登入 token 不保存。session 與 OAuth state 有大小／數量／期限上限，寫入要求 Origin＋CSRF。
- 本機 HTTP 只限明確 opt-in 的 `127.0.0.1:<port>`，不能當成公開部署。cookie 名稱含 port 但瀏覽器 cookie 本身不隔離 port；需使用可信的本機開發環境。正式 HTTPS 使用 Secure／HttpOnly／SameSite=Lax／__Host cookie。
- 伺服器 session 目前只支援單程序；沒有跨主機 session store、集中式撤銷或帳號連結。Google 登入與外部 MCP issuer 的 identity 不會因 email 相同就自動合併。
