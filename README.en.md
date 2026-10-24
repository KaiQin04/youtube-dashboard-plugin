# YouTube Dashboard Plugin

[繁體中文](README.md) · [Download](https://github.com/KaiQin04/youtube-dashboard-plugin/releases/latest) · [First-run guide](docs/self-hosting.en.md)

A self-hosted YouTube dashboard. The browser workspace and Plugin share one core and use your own Google authorization to display your channel's data.

## Features

- Channel totals, daily trends and video performance.
- Traffic sources, countries, devices, engagement and per-video retention reports.
- 16 themes, including Cold Porcelain, with editable names, subtitles, icons and dashboard blocks.
- CSV/JSON exports and separate saved reports/layouts for each connection.
- Shared appearance settings across the browser and Plugin, with saved data ready on later launches.

## Install

Use Node.js 24+ and a local desktop client/Codex CLI with Plugin support.

Download the release ZIP and extract it into a permanent folder. The ZIP includes its runtime dependency. For a source checkout:

```sh
git clone https://github.com/KaiQin04/youtube-dashboard-plugin.git
cd youtube-dashboard-plugin
npm ci --ignore-scripts --no-audit --no-fund
```

Start Setup from the application folder:

```sh
npm run setup
```

Open the complete one-time URL printed by Setup in your system browser. It is valid for five minutes; use Setup or the Plugin to get a fresh link when needed. Complete Google OAuth below, then stop the foreground setup server with Ctrl+C and install the Plugin:

```sh
codex plugin marketplace add .
codex plugin add youtube-dashboard@youtube-dashboard-community
```

Enable **YouTube Dashboard** in your desktop client. Open it from a supported sidebar/conversation-panel entry, or ask your assistant to open the dashboard.

Data is saved in `~/.youtube-dashboard/` by default. Keep that folder across upgrades, restart the Plugin connection, and close/reopen old panels.

## First Google OAuth setup

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/) and enable **YouTube Data API v3** and **YouTube Analytics API**.
2. Configure the OAuth audience. When using Testing, add the Google account with access to your channel as a test user.
3. Create a **Web application** OAuth client, register the exact redirect URI shown by local Setup, and use `youtube.readonly` and `yt-analytics.readonly`.
4. Enter the Client ID and Secret directly into the local form and complete Google consent yourself. Keep credentials out of chat.
5. Check the returned channel ID, select your channel, and update the last 28 days.

See the [first-run guide](docs/self-hosting.en.md) for full steps. Later launches reuse saved connections and reports; reconnect when authorization becomes invalid.

[MIT](LICENSE) · [Third-party notices](NOTICE)
