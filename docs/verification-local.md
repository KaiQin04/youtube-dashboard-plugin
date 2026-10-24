# Local verification — 0.3.0

Date: 2026-10-24.

## Shared source and compatibility

- `src/analytics/`, `src/dashboard/` and explicit compatibility modules are the maintained core. Local/tenant transports and the existing owner-bound site's transport consume it. A deterministic installer generates the latter's vendor copy, browser modules, thin backend wrappers and panel; its manifest pins source hashes and the public commit.
- Public core: 133 tests pass. Existing-site integration: 149 tests pass and its local production build completes. Tests cover first-run setup, synthetic OAuth, verified channel selection, grant refresh, user/connection and owner/channel boundaries, restart persistence, report caching, layouts, subtitle settings and generated drift detection.
- Old-format synthetic encrypted grants decrypt with the original configured context, without rewriting the grant, snapshot or layout rows. Incorrect owner/channel/context fails. No real stored grant was inspected, migrated or re-encrypted.
- Public and owner-site browser/Plugin UIs share the editor, themes, renderer, report catalog, source-video title/thumbnail/link logic and layout validator. Old wire formats and storage revision semantics remain at the adapters.
- The panel build is deterministic and checked before tests. The `panel-v4.html` public resource retains older read aliases; the owner adapter supplies its own private resource URI/aliases.

## Browser checks

Fresh temporary profiles and in-memory fixtures provided synthetic Google responses. The public empty panel displays its local setup entry; a saved connection displays metrics and the shared customizer. The existing-site website saves a title/subtitle that its Plugin panel reads back; both display the same 260 views, 13 hours, +26 subscriptions and 3:00 native average for the test range. Browser testing found an initialization-order bug; a regression test now ensures the editor does not notify its host before initialization completes.

This is a browser MCP Apps test bridge, not native desktop sidebar registration or real Google authorization. The existing user's installed Plugin copy was not replaced. Earlier official CLI installation evidence remains for 0.2.0; this release is additionally tested as an extracted packaged stdio process.

## Publication checks and limits

The exact source allowlist is scanned for private deployment bindings, credential patterns, runtime files and provenance hashes. An additional inspection checks installation branding/channel/origin, private email and local home paths. No matches were found. Archive CRC, file hashes and packaged stdio discovery/resource invocation are checked before distribution. Runtime profiles, databases, credentials, private site settings and Git history are excluded.

Pattern checks are not a proof that every possible sensitive value is absent. No existing credential value, live database or private-site runtime endpoint was read. Local integration changes source only; it does not deploy the private site or modify its existing authorization/data/permissions.

Real Google, live production data and native host rendering remain outside this local verification. GitHub/custom marketplace distribution is not approval for the official public directory. The local edition has no central collection backend or background scheduler while closed. Hosted operators remain responsible for their deployment's authentication, retention, privacy and operational controls.

One fresh architectural review identified three important issues, now covered by failing-then-passing regression tests: symlink output escape, undetected stale generated files, and ordinary sync dropping advanced report caches. Full suites pass after the fixes. A pre-existing compatibility OAuth path still uses unbounded response.json(); this is deferred, while the shared analytics and tenant Google clients use streamed byte limits.
