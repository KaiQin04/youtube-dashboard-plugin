# 本機 Google 登入與頻道授權

此頁保留給多人 Google OIDC 網站 adapter。一般下載自架使用者請改看 [單一擁有者首次設定](self-hosting.md)，只需要一個 YouTube OAuth client。

需要 Node.js 24 以上，以及可管理目標 YouTube 頻道的 Google 帳號。

## 啟動方式

| 命令 | 用途 | 資料保存 |
| --- | --- | --- |
| `npm run demo` | 主題及版面展示，port 4317 | 合成資料，記憶體 |
| `npm run demo:auth` | 登入與頻道授權示範，port 4319 | 合成資料，記憶體 |
| `npm run start:web` | 多人 Google OIDC 流程，port 4318 | `.local/dashboard.sqlite` |

## Google 設定

1. 在自己的 Google Cloud 專案啟用 YouTube Data API v3 與 YouTube Analytics API，設定 OAuth consent screen。Testing 模式需加入測試使用者。
2. 建立兩個 OAuth Web application client，分別用於登入及 YouTube 授權。
3. 登入 client 的 redirect URI 設為 `http://127.0.0.1:4318/auth/google/callback`；YouTube client 設為 `http://127.0.0.1:4318/oauth/google/callback`。這是後端流程，不需要 JavaScript origins。
4. 將 `.env.example` 複製為 `.env.local`，在本機編輯器填入以下設定：

| 設定 | 用途 |
| --- | --- |
| `PUBLIC_ORIGIN` | `http://127.0.0.1:4318` |
| `GOOGLE_LOGIN_CLIENT_ID`、`GOOGLE_LOGIN_CLIENT_SECRET` | Google 登入 client |
| `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` | YouTube 授權 client |
| `TOKEN_ENCRYPTION_KEY` | 隨機 32 bytes，以 base64url 編碼，共 43 字元 |

`.env.local` 已被 Git 忽略，請保持私密並保留加密金鑰。更換金鑰後，既有授權資料將無法解密。

## 使用

```sh
npm run start:web
```

在系統瀏覽器開啟 `http://127.0.0.1:4318/`，登入 Google，再按「連接 YouTube 頻道」。核對實際 channel ID、選擇頻道並同步資料。

登入使用 `openid`；YouTube 使用 `youtube.readonly` 與 `yt-analytics.readonly`。資料與版面依使用者／頻道連線保存。登出不會刪除資料；授權失效時會保留舊資料並提示重新連接。

本機伺服器僅綁定 `127.0.0.1`。session 存於記憶體，重啟後需重新登入；SQLite 內的資料與版面會保留。對外部署需 HTTPS，外部 MCP 還需 OAuth 2.1 身分服務，詳見 [architecture.md](architecture.md)。

## 驗證自己的設定

分別用兩個 Google 帳號登入、授權、核對 channel ID 並同步。確認 A 的資料與版面不會出現在 B；重新登入 A 後仍能看到已保存設定。自動測試使用合成 Google 回應，不能取代這項真實帳號驗收。

參考：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[Web server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)、[OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth)。
