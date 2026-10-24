# YouTube Dashboard Plugin

A self-hosted YouTube dashboard with shared browser/Plugin reports, themes and layouts. See the [features and installation guide](../README.en.md).

## Install

Extract the [release ZIP](https://github.com/KaiQin04/youtube-dashboard-plugin/releases/latest), run `npm run setup`, and complete the first Google OAuth setup. Stop the foreground setup server with Ctrl+C, then run:

```sh
codex plugin marketplace add .
codex plugin add youtube-dashboard@youtube-dashboard-community
```

Enable **YouTube Dashboard** in your desktop client and open the dashboard.

## First Google OAuth setup

Use your own Google OAuth Web application client and enter its credentials in the local Setup form. Follow the [step-by-step guide](../docs/self-hosting.en.md) to authorize YouTube, check the channel ID and load your data.
