# 首次 Google OAuth 設定

[English](self-hosting.en.md) · [回到安裝說明](../README.md)

## 啟動本機設定頁

安裝 Node.js 24 以上，在已解壓的安裝包或完成依賴安裝的原始碼目錄執行：

```sh
npm run setup
```

在系統瀏覽器開啟終端顯示的完整一次性網址。連結有效五分鐘，需要時可透過設定服務或 Plugin 取得新連結。

## 建立 Google OAuth client

在 [Google Cloud Console](https://console.cloud.google.com/)：

1. 建立或選擇此安裝使用的專案。
2. 啟用 **YouTube Data API v3** 與 **YouTube Analytics API**。
3. 設定 Google Auth Platform 的品牌與對象。使用 **Testing** 時，加入可存取頻道的 Google 登入帳號作為測試使用者。
4. 設定兩個唯讀 scopes：

   ```text
   https://www.googleapis.com/auth/youtube.readonly
   https://www.googleapis.com/auth/yt-analytics.readonly
   ```

5. 建立 **Web application** OAuth client，JavaScript origins 留白。
6. 登記本機設定頁顯示的完整 redirect URI。預設為：

   ```text
   http://127.0.0.1:4318/oauth/google/callback
   ```

   主機名稱、連接埠與路徑都需一致；使用不同 port 時，以設定頁顯示的網址為準。

## 連接自己的頻道

1. 在本機表單自行輸入 Client ID 與 Secret，按 **Save in this local profile**。憑證不要貼到聊天；若有助手協助，輸入期間請停止畫面讀取與截圖。
2. 閱讀頁面的資料用途說明，勾選確認後按 **Connect YouTube**，自行完成 Google 登入與授權。
3. 核對回傳的實際 channel ID，選定自己的頻道。
4. 更新最近 28 天資料，再開啟儀表板。
5. 在自訂介面設定名稱、副標題、圖標、主題與區塊，網站和 Plugin 會使用同一份設定。

完成後按 Ctrl+C 停止前景設定服務，再依 [安裝說明](../README.md#安裝) 安裝 Plugin。往後直接使用保存的連線與資料，授權失效時再重新連接。

資料預設位於 `~/.youtube-dashboard/`；`YTDASH_HOME` 可指定其他資料夾，`YTDASH_PORT` 可指定其他連接埠。更新程式時保留原資料夾。
