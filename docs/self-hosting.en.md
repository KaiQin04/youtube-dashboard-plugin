# First Google OAuth setup

[繁體中文](self-hosting.md) · [Installation](../README.en.md)

## Start local Setup

With Node.js 24+, run this from the extracted release package or a source checkout with dependencies installed:

```sh
npm run setup
```

Open the complete one-time URL printed by Setup in your system browser. It is valid for five minutes; use Setup or the Plugin to get a fresh link when needed.

## Create a Google OAuth client

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create/select the project for this installation.
2. Enable **YouTube Data API v3** and **YouTube Analytics API**.
3. Configure Google Auth Platform branding and audience. When using **Testing**, add the Google sign-in account with access to your channel as a test user.
4. Configure these two read-only scopes:

   ```text
   https://www.googleapis.com/auth/youtube.readonly
   https://www.googleapis.com/auth/yt-analytics.readonly
   ```

5. Create an OAuth client of type **Web application**. Leave JavaScript origins empty.
6. Register the complete redirect URI displayed by local Setup. The default is:

   ```text
   http://127.0.0.1:4318/oauth/google/callback
   ```

   The hostname, port and path must match. If you choose another port, use the URI displayed by Setup.

## Connect your channel

1. Enter the Client ID and Secret directly into the local form and select **Save in this local profile**. Keep credentials out of chat. If an assistant is helping, pause its screen reading and screenshots during entry.
2. Read the page's data-use notice, check the acknowledgement, and choose **Connect YouTube**. Complete Google sign-in and consent yourself.
3. Check the returned channel ID and select your channel.
4. Update the last 28 days and open the dashboard.
5. Customize the name, subtitle, icon, theme and blocks. The browser and Plugin use the same saved settings.

Stop the foreground setup server with Ctrl+C, then follow the [Plugin installation steps](../README.en.md#install). Later launches reuse saved connections and reports; reconnect when authorization becomes invalid.

Data is saved in `~/.youtube-dashboard/` by default. Use `YTDASH_HOME` for another profile folder and `YTDASH_PORT` for another port. Keep your profile folder across application upgrades.
