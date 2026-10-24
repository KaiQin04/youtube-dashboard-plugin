# YouTube Dashboard Plugin

[English](README.en.md) · [下載安裝包](https://github.com/KaiQin04/youtube-dashboard-plugin/releases/latest) · [首次設定指南](docs/self-hosting.md)

開源自架的 YouTube 儀表板。瀏覽器與 Plugin 共用同一套核心，使用自己的 Google 授權查看頻道資料。

## 功能介紹

- 頻道總覽、每日趨勢與影片成效。
- 流量來源、國家、裝置、互動與逐段留存報表。
- 16 種主題，包含 Cold Porcelain；可自訂名稱、副標題、圖標與版面區塊。
- CSV／JSON 匯出，以及各頻道獨立保存的報表與版面。
- 網站與 Plugin 共用外觀設定，已連接的頻道可直接開啟保存資料。

## 安裝

需要 Node.js 24 以上，以及支援本機 Plugin 的桌面客戶端與 Codex CLI。

下載 Release ZIP，解壓至固定資料夾；安裝包已包含執行依賴。若使用原始碼：

```sh
git clone https://github.com/KaiQin04/youtube-dashboard-plugin.git
cd youtube-dashboard-plugin
npm ci --ignore-scripts --no-audit --no-fund
```

在安裝資料夾啟動設定頁：

```sh
npm run setup
```

在系統瀏覽器開啟終端顯示的完整一次性網址。連結有效五分鐘，需要時可透過設定服務或 Plugin 取得新連結。完成下方 Google OAuth 設定後，按 Ctrl+C 停止設定服務，再安裝 Plugin：

```sh
codex plugin marketplace add .
codex plugin add youtube-dashboard@youtube-dashboard-community
```

在桌面客戶端啟用 **YouTube Dashboard**，從支援的側邊欄／對話面板入口開啟，或請助手開啟儀表板。

資料預設保存在 `~/.youtube-dashboard/`。更新程式時保留此資料夾，並重新啟動 Plugin、關閉後重開面板。

## 首次 Google OAuth 設定

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 建立或選擇專案，啟用 **YouTube Data API v3** 與 **YouTube Analytics API**。
2. 設定 OAuth 對象；使用 Testing 時，加入可存取頻道的 Google 帳號作為測試使用者。
3. 建立 **Web application** OAuth client，登記本機設定頁顯示的 redirect URI，並使用 `youtube.readonly`、`yt-analytics.readonly`。
4. 在本機表單自行輸入 Client ID 與 Secret，完成 Google 授權；憑證不要貼到聊天。
5. 核對回傳的實際 channel ID，選定頻道後更新最近 28 天資料。

完整步驟見 [首次設定指南](docs/self-hosting.md)。後續開啟會使用保存的連線與資料，授權失效時再重新連接。

[MIT](LICENSE) · [第三方出處](NOTICE)
