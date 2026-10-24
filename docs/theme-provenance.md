# 主題來源與調整

本版含Cold Porcelain及 15 種 claude-skins 色彩風格，均可切換淺色、深色或跟隨系統。

參考來源：[KaiQin04/claude-skins](https://github.com/KaiQin04/claude-skins)，固定 commit `917b5b6117a432e274e22279f80e22ce7ac3db06`，讀取 `hooks/themes/*.ts` 的 label 與十六進位 palette 常數。此 repository 是 hellosverre/claude-skins 的 fork，MIT 授權全文保留於 `third-party/claude-skins.LICENSE`。

| 主題 | 儲存 ID |
| --- | --- |
| Cold Porcelain | cold-porcelain |
| Noir | noir |
| Tokyo Night | tokyo-night |
| Dracula | dracula |
| Nord | nord |
| Gruvbox | gruvbox |
| Catppuccin Mocha | catppuccin |
| Rosé Pine | rose-pine |
| Everforest | everforest |
| One Dark | one-dark |
| Solarized | solarized |
| GitHub | github |
| Kanagawa | kanagawa |
| Ayu | ayu |
| Night Owl | night-owl |
| Monochrome | mono |

`src/ui/skin-palettes.json` 保存來源版本及原始色彩常數；沒有執行、安裝或複製 claude-skins 的 hook 或瀏覽器注入程式。

`src/themes.mjs` 將 palette 轉為儀表板 CSS tokens。來源提供 10 組明確淺色 palette；其餘 5 組以中性淺色背景及原有強調色產生。文字、次要文字、強調色會調整至在頁面與區塊背景至少 4.5:1；按鈕前景依強調色選擇。這是適用於儀表板的改編，不宣稱逐像素重現上游。

未載入外部字型、圖片或樣式，未開放任意 CSS／JavaScript 或遠端 URL。可以調整標題字體、疏密與排列方式；完整自由色票、拖拉座標及自訂公式尚未提供。

Cold Porcelain 採影青白底、藍色強調與襯線標題；其餘主題改編自上述 MIT 色票，出處見 `NOTICE`。
