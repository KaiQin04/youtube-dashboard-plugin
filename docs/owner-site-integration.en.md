# One core, multiple adapters

`src/` is the maintained analytics, report, layout, editor and rendering source. The local Plugin, browser workspace and optional Sites adapter consume it. An existing owner-bound site can consume a pinned, generated vendor copy without changing its saved authorization or database format.

## Existing owner-bound site

The site keeps its HTTP/MCP identity boundary, owner/channel binding and transport handler. `src/compat/` preserves its existing encrypted grant envelope, configured AAD context, tables, cache keys and layout revisions. No grant migration, re-encryption or new Google permission is performed.

Installation-specific defaults belong in the site's private `settings/dashboard.mjs`: display name/icon/subtitle, origin and legacy compatibility identifiers. Channel binding, Google client configuration and encryption keys remain runtime configuration. Only allowlisted display defaults are embedded in browser assets. Never put real secrets in source settings or in arguments to the installer.

From the public checkout, call the source installer with a source-only site checkout, reviewed display defaults and the exact public Git commit:

```js
import { syncOwnerSite } from './scripts/sync-owner-site.mjs';
await syncOwnerSite({
  target: '/absolute/path/to/owner-site-source',
  sourceCommit: 'THE_REVIEWED_PUBLIC_COMMIT_SHA',
  brand: { name: 'My Channel', icon: 'chart' },
});
```

This generates `vendor/youtube-dashboard-core/`, backend re-export wrappers, browser modules, the owner-panel bundle and `dashboard-core.lock.json`. The manifest records the public commit and hashes of the exact generated sources. The script opens source files only; it does not discover or load environment files, runtime profiles or databases. The initial transport adapter wiring and private settings are reviewed integration work, not an automatic migration of arbitrary sites.

Inside the integrated site:

```sh
node scripts/build-dashboard-panel.mjs --check
```

A source or generated-output mismatch fails the check. To update, change canonical public source, run its tests and panel build, commit it, then regenerate from that exact revision and run the site's compatibility tests/build. Do not hand-edit vendor files or generated browser assets. Integrating source does not deploy the site.

## Preserved storage boundaries

- Local/tenant connections keep their existing user/connection keys and encrypted grants.
- Owner-site adapters keep their original owner/channel keys, grant context and layout revision checks.
- Layout rendering accepts the same canonical schema; each adapter retains its storage and identity checks.
- Changing display names, subtitles, icons or themes does not call Google or change permissions.

Tests use synthetic grants, isolated in-memory stores and synthetic Google responses. They verify old ciphertext readability without writes, unchanged saved rows, cross-owner/channel/tenant rejection, report caching and generated drift detection. They do not replace live Google consent or production deployment verification.
