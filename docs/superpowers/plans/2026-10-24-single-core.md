# Single Dashboard Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** One maintained public analytics and presentation core consumed by the local Plugin and an existing owner-bound site, without deploying or altering saved grants/data.

**Architecture:** Keep identity, persistence format compatibility, HTTP/MCP transport and installation-specific settings at adapter boundaries. Publish a superset analytics adapter and the existing richer display components as canonical source. A deterministic source installer writes generated copies/wrappers and an integrity manifest into the existing site; generated copies are verified and never independently edited.

**Tech Stack:** JavaScript ESM, Node.js 24+, SQLite/D1, existing Workers APIs, pinned esbuild for UI bundling.

**Spec:** User request in this conversation: integrate locally, preserve credentials/permissions/grants/data, remove installation branding/bindings from public source, test before commit/push, no site deployment.

## Global Constraints

- Do not open runtime profiles, environment files, credential values, live databases or private-site runtime endpoints.
- Use synthetic Google responses, temporary SQLite/D1 fixtures and explicit source allowlists.
- No migration, token re-encryption, replacement encryption key, new scope or live consent.
- Public files contain no installation brand, channel, owner, origin, project binding or credential.
- Preserve existing site paths, tool aliases, owner boundaries, encrypted envelope/AAD and table keys through explicit private adapter settings.
- Public local/tenant profile formats remain compatible; connection-scoped reads/writes stay isolated.
- Commit/push the public repository only after checks; commit the local existing-site integration without creating a remote or deploying it.

## Review Focus

- Existing encrypted grants must decrypt using their original configured context; reads must not rewrite ciphertext.
- Owner/channel or tenant/connection substitution must still fail before provider access.
- Existing report widgets, layouts, snapshots and revision conflicts must retain behavior.
- Browser and Plugin display must use canonical widgets/editor without losing unavailable-data distinctions.
- Generated source drift, stale assets and publication of private settings must be detected.

## Task 1: Shared analytics and compatibility codecs

**Files:** `src/analytics/{youtube,reports,storage,security,sync}.mjs`, `src/compat/{oauth,owner-store}.mjs`, `src/http-json.mjs`, relevant analytics tests.

**Interfaces:** One `YouTubeSnapshotAdapter` retains bounded `readDashboardReports(range)` and adds the existing `readDashboardReport(args)` contract. Compatibility OAuth consumes `config.grantContextPrefix`; owner-store consumes an injected DB and clock. No runtime migration.

- [x] Write/run failing tests for existing synthetic ciphertext, unchanged snapshot/layout rows, and shared advanced reports.
- [x] Merge the richer adapter while retaining streaming size bounds, tenant failures and current profile formats.
- [x] Run targeted analytics/OAuth/storage tests.

## Task 2: Shared display components and panel

**Files:** `src/dashboard/*`, `src/{layout,branding,themes,panel-resource}.mjs`, `src/ui/{panel.js,panel.html}`, UI build script, package/lock, display tests.

**Interfaces:** Canonical `validateLayout`, `createCustomizer`, `renderWidgets`, report/source-video widgets and catalog. Transport controllers project their own wire format into the same display input. Brand defaults are explicit display-only settings; generic defaults apply when absent.

- [x] Write/run failing tests for preserved advanced layouts and identical renderer output across adapters.
- [x] Move richer components to the public core, retain existing public projections and add scoped report tools where needed.
- [x] Bundle the shared editor/renderer for MCP Apps; keep browser modules generated from identical sources.
- [x] Run display, tenant and package tests.

## Task 3: Deterministic owner-site integration

**Files:** public `scripts/sync-owner-site.mjs`, source manifest/checker; existing-site wrappers, private settings, generated assets/vendor and integration tests.

**Interfaces:** `syncOwnerSite({sourceRoot,target,check})` copies only declared public source into a generated vendor tree and records hashes. Private settings supply display branding, origin, legacy context and host aliases; Google values remain runtime environment inputs.

- [x] Write/run a fixture integration test that fails before installation support exists.
- [x] Generate imports/wrappers instead of retaining copied analytics/layout/renderer implementations.
- [x] Preserve existing migrations and run old and new synthetic compatibility tests.
- [x] Check drift detection and ensure no runtime/secret paths are copied or read.

## Task 4: Verification and publication

**Files:** docs, package version/lock, local verification outputs, public/private commits.

- [x] Run both complete suites, release privacy checks and the existing-site production build locally with synthetic build inputs only.
- [x] Browser-smoke empty and synthetic saved-data panels; no live Google or site requests.
- [x] Request one fresh architectural review of the immutable changes and address material findings with tests.
- [ ] Commit/push public source; pin its exact SHA in the local site artifact and commit local integration. Do not deploy.

## Execution Rulings

- Existing-site checkout has no configured remote. Preserve that state; a new remote or site push/deployment is outside this integration.
- The user's explicit execution instruction authorizes implementation without another planning confirmation.
