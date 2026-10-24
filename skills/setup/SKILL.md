---
name: setup
description: Set up the self-hosted YouTube Dashboard Plugin using the user's own local Google OAuth project, without exposing credentials to chat or tools.
---

# Local setup

Use the bundled local MCP server and the setup instructions in `docs/self-hosting.en.md`.

1. Call `get_local_setup_status`. Return only setting names, configured flags and versions.
2. If the MCP server cannot start, check Node.js 24+ and the package installation. A release ZIP includes the pinned dependency. For a Git checkout, inspect `package.json` and `package-lock.json`, then use `npm ci --ignore-scripts --no-audit --no-fund` in this plugin's root. Do not use `npx`, unpinned dependencies, lifecycle hooks, or auto-update commands. Restart the local Plugin connection after installing dependencies.
3. Call `open_youtube_dashboard` and open the returned numeric loopback URL using a supported browser tool. The user creates their own Google OAuth Web application client and enters its client ID and secret directly in the local form. The callback URL is displayed in that form. The encryption key is generated automatically in the local profile.
4. Hand control to the user before they enter credentials. Do not read the browser, screenshot it, inspect the DOM, read local credential files or intercept requests while they enter or save credentials. Do not request credentials, credential JSON, authorization codes or tokens in chat or attachments.
5. After the user says entry is finished and the fields are cleared/closed, call `get_local_setup_status`; never read credential values. The user checks the data-use notice and completes Google consent in their own browser. Prefer the normal system browser for Google authorization.
6. List connections and show the actual verified channel ID before selecting a channel or syncing. Preserve the two existing YouTube read-only scopes. Reuse a valid grant on subsequent launches; reconnect only when needed.
7. Names, subtitles, icons, themes and layouts are user settings, not source edits. Use `update_dashboard_layout` for them. Never write a real brand, channel ID, email, token or credential into the published package, examples, tests or Git history.

The profile is single-owner and local to one OS user. Different installations can share the same profile; use separate `YTDASH_HOME` directories when independent profiles are needed. A browser does not need an additional Google OIDC login to access its own local workspace. Tool responses the user requests can be read by the chat host and model.

Do not register or publish a remote service, modify any existing private site, or reuse credentials from another project during setup. Never claim a synthetic test is real Google authorization.
