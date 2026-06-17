# Changelog

All notable changes to **ccgauge** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-06-17

Two big themes: **Codex billing accuracy** is back in line with
[ccusage](https://github.com/ccusage/ccusage) (the de-facto reference for
multi-agent token accounting), and the **usage page no longer freezes** when
you flip ranges or sources.

On the billing side: Codex transcripts had three independent issues that
combined to push numbers off by ~20% in either direction. Reasoning tokens
were being double-counted at the output rate (output already includes them in
Codex's raw payload — verified against real `~/.codex` rollouts: `input +
output == total`), the fast / priority service tier was billed at the
standard rate (it's 2× for most models, 2.5× for `gpt-5.5`), and the most
commonly used model strings (`gpt-5.2-codex`, `gpt-5.2` — together >65% of
local Codex requests on the maintainer's machine) had no entry in the price
table and silently fell back to the priciest gpt-5.5 tier. Costs now match
ccusage to the cent on identical data; on a high-volume Codex priority-tier
session the corrected total came in 2.4× higher than before — entirely from
adding the missing multiplier and pricing keys, not from new spend.

On the usage page: every filter change re-streamed ~300 KB of HTML and
fully re-hydrated a 25-row table with portal hovercards. Combined with no
visible click feedback, this looked like the UI was frozen. The page is now
a thin shell that boots in ~20 KB, and the chart / KPIs / table fetch from
a new `/api/turns` endpoint with stale-while-revalidate caching. Toggling
7d ↔ 30d ↔ all is now ~30 ms after the first hit (was ~150 ms every time),
and every filter control flashes pending state on click so it's obvious
the input landed.

### Fixed

- **Codex reasoning tokens were billed twice.** The parser added
  `reasoning_output_tokens` on top of `output_tokens` before applying the
  output rate, but Codex's raw payload already counts reasoning inside
  `output_tokens` (every `total = input + output` invariant holds in real
  rollouts). Output is now billed once; `reasoning_tokens` stays on the
  record as a display-only subset, mirroring ccusage's
  `reasoningOutputTokens` column. `parserVersion` bumps to
  `codex-v6-output-excludes-readded-reasoning` so any indexed snapshot
  rebuilds with the corrected totals.
- **Fast / priority service tier was missing.** When
  `~/.codex/config.toml` sets `service_tier = "fast" | "priority"`, costs
  scale per model (gpt-5.5 ×2.5, others ×2, ported from ccusage's
  `fast-multiplier-overrides.json`). Standard-tier sessions are unchanged.
- **`gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`, `gpt-5.1-codex` had no pricing
  rows** and resolved via family-fallback to the priciest gpt-5.5 tier
  (5 / 30 per 1 M tokens). Real Codex logs use these strings constantly —
  the maintainer's archive had ~1,600 requests on `gpt-5.2-codex` alone,
  every one of which was over-billed by ~3×. Added with ccusage's values
  (gpt-5.2-codex 1.75 / 14, gpt-5.1 1.25 / 10) so they resolve `exact`.

### Added

- **`·fast` marker on the usage page model column** when the active Codex
  config requests the fast / priority tier. Shows as `GPT-5.5·fast` in
  amber with a tooltip explaining the 2×+ rate, on Codex rows only.
  Source-aware: Claude rows stay clean even on mixed (`source=all`) views.
- **Build-time LiteLLM snapshot for builtin pricing.** New
  `pnpm update-pricing` script fetches BerriAI/litellm's
  `model_prices_and_context_window.json`, filters to Anthropic + OpenAI
  chat models, transforms per-token costs into ccgauge's per-1 M
  `Pricing` shape (Anthropic `cacheCreation1h = 2× input`, mirroring
  ccusage's hard-coded multiplier; OpenAI keeps cache-write tiers at 0),
  and writes a committed `lib/pricing/litellm-pricing.generated.{js,d.ts}`.
  Runtime stays fully offline — the snapshot IS the pin. The hand-curated
  layer shrinks to seven legacy Claude bare names that LiteLLM doesn't
  carry; everything LiteLLM tracks is sourced from there.

### Performance

- **Usage page page-load HTML cut from ~300 KB to ~34 KB**, constant
  across filters. `force-dynamic` SSR no longer re-streams every record
  inline as RSC payload; the page now ships a shell only.
- **Filter changes feed from a JSON endpoint with stale-while-revalidate.**
  New `/api/turns` returns totals, trend buckets, the paginated turn
  slice, and the filter dropdown contents (~30 KB). A client-side URL-keyed
  cache renders the previous payload immediately on revisit, so 7d ↔ 30d
  toggles drop from ~150 ms each to ~30 ms after the first hit.
- **Every filter nav now uses `useTransition`** with visible pending
  feedback (control opacity-60 + `cursor-progress` + `aria-busy`, table
  card additionally drops pointer events). Range picker, segmented
  picker, multi-selects, table sort / page / search, source switcher —
  all share the treatment. Eliminates the "did my click land?" gap.
- **Scan-derived data is cached on the indexer snapshot.**
  `allModels` / `allProjects` use a WeakMap on the scan object; new
  `recordsToTurnRowsCached` is an LRU sub-keyed on
  `(source, range token, models, projects)`. Using the range *token*
  instead of the resolved `fromIso/toIso` avoids `Date.now()` drift, so
  the same scan + same filter combo hits the cache on every revisit.

### Changed

- **GPT-5 base variants (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-codex`)
  now follow LiteLLM**: 1.25 / 10, 0.25 / 2, 0.05 / 0.4, 1.25 / 10
  respectively (these are the same numbers ccusage uses). The 1.1.6
  alignment chose openai.com values for them; this release picks one
  source of truth for the whole table. No real-data impact for the
  maintainer's transcripts — none of those four ids appears in local
  Codex logs.
- **`AutoRefresh` now dispatches a `ccgauge:refresh` window event** so the
  client-side data island can re-fetch alongside the existing
  `router.refresh()`. Existing pages without an island are unaffected.

## [1.1.6] — 2026-06-17

Brings GPT pricing back in line with [OpenAI's official rates](https://openai.com/api/pricing/)
and trims the settings page model table to the variants people actually run today.

### Fixed

- **GPT-5 family prices were wrong across the board.** Every gpt-5\* entry was
  carrying the old launch-window numbers (`$1.25 / $10` per 1 M tokens),
  which under-reported cost on every Codex CLI session run since the
  rate change. Updated to current official rates:
  `gpt-5.5` $5 / $30 (cached $0.50), `gpt-5.4` $2.50 / $15 (cached $0.25),
  and `gpt-5.3-codex` $1.75 / $14 (cached $0.175). The bare-name
  Codex CLI aliases (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-5-codex`)
  are mapped to the matching `gpt-5.4` tier so existing transcripts cost
  out correctly without manual remapping.

### Added

- **`gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.3-codex`, `gpt-5-codex`** as
  first-class pricing entries, so Codex CLI runs on those exact ids get
  an `exact` match instead of falling through to family-fallback.

### Changed

- **Settings → Pricing table trimmed to the models in active use.**
  Codex now shows `gpt-5*` only; the legacy `gpt-4.1`, `o3`, `o4-mini`
  rows are hidden (their prices are still in the underlying table, so
  any historical session involving them still costs out accurately).
  Claude shows only `haiku-4-5`, `sonnet-4-6`, `opus-4-6` and newer,
  plus the `fable-5` family — older snapshots are kept in the data for
  the same backward-compat reason but no longer clutter the UI.

### Removed

- **`gpt-5.5-mini` and `gpt-5.5-nano` pricing rows.** These ids never
  shipped on the OpenAI pricing page; they were placeholder rows from
  the initial 5.5 announcement and would have masked real usage of the
  `gpt-5.4-mini` / `gpt-5.4-nano` ids that do exist.

## [1.1.5] — 2026-06-11

Adds pricing support for Claude Fable 5 and fixes a turn-grouping regression
where background-task completions appeared as dozens of standalone rows on the
usage page instead of folding into the turn that spawned them.

### Added

- **Claude Fable 5 pricing.** Input $10 / output $50 per 1 M tokens, with
  cache-write multipliers (5 min: ×1.25 → $12.50, 1 h: ×2 → $20) and cache
  read at $1 per 1 M tokens. `fable` is now a recognized family-fallback key,
  so future `claude-fable-*` variants resolve automatically without a code
  change.

### Fixed

- **`<task-notification>` completions split into dozens of standalone rows.**
  When a turn used the Workflow / ultracode tool to fan out background tasks,
  each completion notification arrived as a harness-injected `user` message
  and was incorrectly treated as a new turn root — producing one row per
  background-task result instead of folding all the work back into the
  spawning turn. `isSyntheticUserText` now classifies `<task-notification>`
  messages as synthetic; a `parserVersion` bump (`claude-v5-task-notification-synthetic`)
  invalidates the persisted index cache so existing transcripts are re-parsed
  on first load.

## [1.1.4] — 2026-06-07

A maintenance follow-up to 1.1.3 — hardens the build's smoke gate and adds
regression coverage for the Workflow badge. No user-facing or runtime
changes.

### Fixed

- **Build smoke gate could spuriously fail or leak on interruption.** The
  post-build `smoke-standalone.mjs` picked its port ~1s before binding it
  (the standalone `cpSync` sits in between), so a busy host could grab the
  port in that gap and fail the build with a spurious `EADDRINUSE`; and a
  signal-killed run (CI cancel / Ctrl-C) skipped the cleanup, leaking the
  multi-MB temp copy and an orphaned server still holding the port. The
  gate now picks the port immediately before spawn and cleans up the temp
  dir + child on SIGINT/SIGTERM/SIGHUP.

### Internal

- **Regression test for the Workflow badge count.** Added an N>1 fan-out
  case to `scripts/test-sidechain.mjs`: three sub-agents (two Workflow
  files + one Task) fold into a single turn, and the badge count resolves
  to the two distinct workflow transcript files (the Task one excluded) —
  the `workflowSubagentCount` path the 1.1.3 feature shipped without
  coverage.

## [1.1.3] — 2026-06-05

A critical hotfix, plus a Workflow / ultracode badge on the usage page.
**v1.1.2 fails to start on a clean install** — `npx ccgauge` crashes at
boot, before serving a single page. If you installed 1.1.2, upgrade
immediately.

### Added

- **Workflow / ultracode badge on the usage page.** A turn that fans out
  parallel sub-agents — Claude Code's Workflow tool, e.g. `ultracode`
  mode — now shows a `Workflow ×N` badge in the usage table's model
  column, where N is the number of distinct parallel sub-agent transcripts
  it spawned. Localized (en / zh).

### Fixed

- **`npx ccgauge` crashed on every clean machine (1.1.2 regression).**
  The 1.1.2 size-prune deleted `next/dist/compiled/babel`, assuming it was
  a build-only transpiler bundle. It is not: Next's standalone production
  startup requires `babel/code-frame` unconditionally
  (`node-environment.js` → `patch-error-inspect.js` →
  `next-devtools/server/shared.js`). The server threw `Cannot find module
  'next/dist/compiled/babel/code-frame'` at boot and never listened — so
  every page, logo, and JS chunk failed to load with a 400 and the app
  died with a `ChunkLoadError`. `babel` + `babel-packages` are restored to
  the package (tarball 5.3 MB → 5.9 MB — still ~62% below the 15.5 MB it
  started from). The other prunes (`sharp` / `@img`, AMP validator,
  capsize font-metrics, `next/font`) are verified safe and stay removed.

- **The build's smoke gate couldn't catch this — now it can.** The
  post-build `smoke-standalone.mjs` booted the server *inside the repo*,
  where Node's module resolution falls back to the project's own
  `node_modules/next` — so a standalone missing its bundled `babel` still
  started and the gate passed green. The gate now copies the standalone to
  a temp dir **outside the repo** and boots it there, faithfully
  reproducing a clean `npx` install. Reverse-tested: with `babel` removed
  it now fails the build (`server exited early … Cannot find module`),
  exactly the regression that shipped 1.1.2.

- **Workflow / ultracode sub-agent turns weren't folded into the turn
  that spawned them.** These sub-agent transcripts live under
  `subagents/workflows/wf_<id>/`, a path the sidechain-linking regex
  didn't match — so each parallel agent surfaced as its own orphan
  "(no user text)" row instead of collapsing into the conversation turn
  that launched the fan-out. The matcher now handles the nested workflow
  path (case- and separator-tolerant), with regression tests.

### Internal

- `postbuild.mjs` now carries a standing warning against re-pruning
  `babel`, documenting the exact startup require chain that depends on it,
  so the assumption that misfired in 1.1.2 can't be repeated silently.

## [1.1.2] — 2026-05-30

A packaging + polish release. The published npm tarball shrinks by 66%,
the nav gets a Docs link, and Claude Opus 4.8 pricing lands. No
breaking changes — drop-in over 1.1.x.

### Highlights

- **npm package is 66% smaller** — tarball **15.5 MB → 5.3 MB**
  (unpacked 51.8 MB → 22.2 MB). The bulk was a macOS `sharp` native
  binary (~16 MB of libvips) that `next build` traced into a nested
  `node_modules` the old prune never reached — pure dead weight since
  ccgauge sets `images: { unoptimized: true }` and uses no `next/image`.
  We also drop other Next internals ccgauge never loads (AMP validator,
  `next/font` font-metrics + babel bundles) and shrink the Codex logo.
- **Docs link in the nav** — a new "Docs" entry after Settings opens the
  documentation site in a new tab. It follows the in-app language:
  English → `chengzuopeng.github.io/ccgauge/`, Chinese →
  `…/ccgauge/zh/`.
- **Claude Opus 4.8 pricing** — added to the built-in table, and the
  `opus` family fallback now points at 4.8 so unknown future Opus date
  suffixes price correctly.

### Added

- **Built-in pricing for `claude-opus-4-8`** ($5 / $25 per 1M in/out,
  $6.25 / $10 cache-write 5m/1h, $0.50 cache-read).
- **Docs nav link** — locale-aware external link with an external-arrow
  glyph, opens in a new tab (`rel="noopener noreferrer"`).
- **`scripts/smoke-standalone.mjs`** — a post-build smoke gate wired
  into `pnpm build`. It boots the pruned standalone server and hits the
  key routes; if any page 500s or the server crashes, the build fails.
  This is the safety net that makes pruning Next internals viable: a
  future Next upgrade that starts requiring a pruned file is caught at
  build time instead of shipping a broken package.

### Changed

- **`opus` family pricing fallback** now resolves to `claude-opus-4-8`
  (was `claude-opus-4-7`).
- **Nav: removed the tagline** next to the logo ("usage dashboard for
  AI coding CLIs" / "AI 编程 CLI 的本地用量看板") for a cleaner bar. The
  string is still used for the page `<meta description>` and the
  empty-state copy.
- **Codex logo `png → webp`** — 354 KB / 816² PNG → 23 KB / 512² WebP
  (matches the Claude logo), a 331 KB drop.
- **`ccgauge report` bundle is minified** (`dist/report/index.mjs`,
  307 KB → 166 KB), same as the MCP bundle. The output is machine-read
  only, so there's no debuggability cost.
- **`cost_estimator` MCP tool docs** reference Opus 4.8 in their
  examples.

### Fixed

- **Build prune missed a nested `sharp` / `@img` copy (~16 MB).**
  `postbuild` only swept the top-level + `.pnpm` `node_modules`; Next's
  file tracer had copied the platform libvips binary into a real
  `next/node_modules/@img`. A new recursive sweep removes
  `@img` / `sharp` / `typescript` wherever they nest, plus the AMP
  validator, capsize font-metrics, babel bundles, and `next/font`
  loaders — none of which ccgauge's configuration loads.

### Internal

- `postbuild` prune is now two-pass: top-level / `.pnpm`
  (pre-materialize) + a recursive `pruneModulesTree` (post-materialize)
  that only walks `node_modules` trees, never package source. Each
  Next-internal removal carries a comment naming the standing
  assumption (no `next/image` optimization, no AMP, no `next/font`)
  that keeps it safe.
- The standalone smoke gate is reverse-tested: removing a
  production-required Next runtime makes every page 500 and the gate
  exits non-zero, so it provably catches a broken prune rather than
  silently passing.

## [1.1.1] — 2026-05-29

A polish-and-harden release: motion across the dashboard and marketing
site, a token-accounting fix in the Codex parser, indexer concurrency
hardening, and a large code-cleanup pass. No breaking changes — drop-in
over 1.1.0.

### Highlights

- **Silent live data on the Overview.** The homepage now refreshes its
  KPIs, the live 5h block, and the cost-by-model chart every 30s via
  `router.refresh()` — no full page reload, no scroll reset, no
  loading flash. Pauses while the tab is hidden.
- **Motion pass.** A coherent "instruments powering on" animation layer:
  a single sliding indicator glides under the active tab (top nav,
  segmented pickers, the trend metric toggle) instead of bars popping
  in/out; dashboard cards stagger in on first paint; cost-by-model bars
  grow from the left. All entrance animations honor
  `prefers-reduced-motion` and do **not** replay on the 30s auto-refresh.
- **Codex token double-count fix (parser v5).** A session that emitted a
  `last_token_usage` event followed by a `total_token_usage` event could
  count the `last` tranche twice, inflating tokens and cost. The parser
  now advances its running total after a `last`-only event so the
  subsequent `total` event dedups correctly. `parserVersion` bumped
  `codex-v4-effort → codex-v5-last-total-prev` (stale on-disk caches
  re-parse automatically).

### Added

- **`<TabIndicator>` + `useTabIndicator` hook** — the shared sliding
  active-tab indicator (measure via `offsetLeft`/`offsetWidth`, animate
  position + width). Two variants: `pill` (segmented controls) and
  `underline` (top nav). One primitive drives the nav, both segmented
  pickers, and the trend metric toggle.
- **`--ease-out-soft` design token** — the brand easing curve now has a
  single source in `app/globals.css`; Tailwind's `ease-out-soft` utility
  and the `@keyframes` entrance animations both reference it.

### Changed

- **`ccgauge report --dashboard` visuals** rebuilt on established
  libraries (`boxen` rounded-corner KPI tiles, `cli-table3` breakdown
  tables, `chalk` truecolor, `string-width`/`cli-truncate` for correct
  CJK/emoji width, `figures` for cross-platform symbols). Truecolor is
  forced on so 24-bit brand colors survive non-TTY parents. The plain
  text `report` output is unchanged.
- **README tightened ~48%** (EN + ZH, exact parity) — punchier hero, a
  "Why ccgauge stands out" block, a "What's new" callout, and the
  website link (chengzuopeng.github.io/ccgauge). All functional
  reference tables preserved.
- **Marketing site polish** — theme-aware Models screenshot card,
  system-default theme, localized `CodeBlock`, copy-to-clipboard
  failure UX, plus the site-wide motion pass.
- **Codebase-wide comment / verbosity cleanup** — trimmed ~1,900 lines
  of explanatory comments and dead whitespace across `lib/`,
  `components/`, `app/`, `scripts/`, and `site/`. No behavior change.

### Fixed

- **Indexer concurrency hardening.** All mutations of the file index
  (init scan, force-rescan, poll, watcher reconcile) now serialize
  through one queue so an incremental update can't interleave with a
  `clear()` + full rescan. `forceRescan()` awaits the memoized first
  init before touching the map, closing a race that could drop records.
- **No transient empty snapshot during force-rescan.** `runRescan()`
  now cancels any pending debounced snapshot-rebuild timer before
  `files.clear()`, so that timer can't fire mid-rescan and publish a
  half-empty snapshot.
- **`isIndexing` status reported synchronously** — flipped before the
  rescan queues rather than inside the deferred callback, so the
  Settings page / MCP status no longer shows "idle" while a rescan is
  pending.
- **Codex token double-count** (see Highlights — parser v5).
- **CSV export project filter** now resolves canonical (worktree-
  collapsed) cwds, matching the Usage page; previously a project filter
  on a repo with git worktrees silently dropped worktree rows.

### Internal

- New Codex parser v5 regression tests (`last`-only → `total` dedup,
  calendar of token tranches); `parser-versions.json` bumped in lockstep.
- De-duplicated the sliding-indicator `<span>` (was copy-pasted across
  three components) into `<TabIndicator>`; removed a dead `groupRef`
  alias in `SegmentedPicker`.

## [1.1.0] — 2026-05-23

Two new user-facing features and a marketing-site routing overhaul.

The **Usage** page learns a custom date range — a real `react-day-picker`
calendar replacing the original native `<input type="date">`, with proper
brand theming and locale (en / zh-CN) tracking. The **CLI** learns a rich
TUI dashboard (`ccgauge report --dashboard` / `-d`) that fans the existing
JSON report shape into KPI tiles, a stacked vertical-bar trend chart, a
two-column breakdown, and a 7×24 activity heatmap — useful in a terminal
when the dashboard's web UI isn't an option. The **marketing site** drops
the `/en/...` prefix so canonical URLs sit at the root (with 301-style
static redirects from every old path so existing bookmarks / search
results still resolve).

### Highlights

- **Custom date range on `/usage`** — `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`
  URL contract, click-pick via `react-day-picker` (mode=range) with a
  themed popover that follows the existing light/dark theme + EN/ZH
  language toggle, edge middleware redirects malformed URLs to the
  default range with a clean HTTP 307 (no skeleton-flash from a
  Server-Component-level redirect).
- **`ccgauge report --dashboard` / `-d`** — one-screen TUI rendering of
  the existing report data. KPI tiles (Total tokens / Cost / Cache saved
  / Cache hit / Conversations / Active 5h block), a stacked vertical bar
  trend chart with 1/8-cell precision, a two-column breakdown, a 7×24
  day×hour heatmap, plus a footer with the active filter scope. Falls
  back to the standard text layout when stdout is below 80 columns. The
  plain `report` output is unchanged.
- **Marketing site at root URLs** — English pages move from `/en/cli/`,
  `/en/features/`, etc. to plain `/cli/`, `/features/`, etc. Every old
  `/en/...` path keeps working via static meta-refresh redirects (works
  on GH Pages' static hosting; honored by search engines as a 301).

### Added

- **`react-day-picker`** (devDependency) — themed via existing brand
  tokens, no extra theme prop needed. Light/dark theme + EN/ZH locale
  both follow the dashboard's own switches automatically.
- **`bg.elevated` Tailwind utility** mapping the pre-existing
  `--bg-elevated` CSS var, so popovers / dropdowns can share the same
  one-tier-above-surface fill via a normal Tailwind class.
- **`middleware.ts`** at repo root — Edge runtime, scoped to `/usage`.
  Rewrites `?range=custom` with missing or invalid `from` (incl.
  calendar-overflow shapes like `2025-02-30`) back to `?range=7d`
  with a clean HTTP 307. Other query params (models, projects, sort,
  …) are preserved.
- **`lib/range.ts` exports** — `parseCustomRange(from, to)` with
  round-trip calendar validation; `'custom'` added to `USAGE_RANGES`.
- **`scripts/test-range.mjs` fixtures** — 9 new assertions covering
  `parseCustomRange` happy path, from-only open-ended, malformed
  ISO, calendar overflow (Feb 30 / Apr 31 / non-leap Feb 29), leap
  year (2024-02-29).
- **`bin/cli.mjs` `report` flags** — `-d, --dashboard`, `--width <n>`
  (override `process.stdout.columns`), `--no-banner`, `--compact`
  (skip the trend chart to save vertical space).
- **`lib/cli-report/ansi.ts`** — shared TUI primitives (24-bit
  truecolor palette aligned with the web dashboard's `--chart-*` CSS
  vars; Unicode box / bar / sparkline / vertical-stacked-column /
  two-column helpers, with ANSI-aware visible-length math).
- **`lib/cli-report/dash.ts`** — the new dashboard renderer entry
  (banner / 6 KPI tiles / stacked trend / double-column breakdown /
  day×hour heatmap / footer).
- **`/en/*` legacy URL redirects** in `site/astro.config.mjs` — 5
  paths (`/en/`, `/en/cli/`, `/en/features/`, `/en/mcp/`,
  `/en/privacy/`) emit static meta-refresh HTML pointing at the
  new canonical root URL. Destinations are pre-prefixed with
  `basePath` so GH Pages project builds get the full
  `https://chengzuopeng.github.io/ccgauge/...` target.

### Changed

- **`/usage` Range picker** — gains a Custom button after the
  segmented preset chips. When the active range is `custom`, the
  button shows the picked date range (`May 19 – May 21` / `5月19日 –
  5月21日`) and is highlighted with the brand fill. Switching to any
  preset auto-strips `from` / `to` from the URL.
- **Marketing site i18n routing** — `prefixDefaultLocale: true` →
  `false`. English pages now live at `/`, `/cli/`, `/features/`,
  `/mcp/`, `/privacy/`. Chinese pages still under `/zh/...`.
  `BaseLayout`'s hreflang / canonical use the new path shape.
- **`/api/usage` and `/api/export/usage`** — accept `range=custom`;
  reject missing/invalid `from` with `400 invalid_custom_range` so
  the contract matches the page redirect.
- **`/api/export/usage` filename** — when `range=custom`, the
  filename embeds the literal `from_to` dates the user typed
  (instead of `dates.from.toISOString().slice(0, 10)` which drifted
  by ±1 day for non-UTC machines).
- **`globals.css` imports `react-day-picker/style.css`** at the top
  (CSS `@import` must be first), with ~10 `--rdp-*` variable
  overrides + a few `.rdp-*` selectors scoped to `.rdp-root` so the
  calendar matches the dashboard's brand colors, radii, today
  indicator, and weekday header treatment without per-render
  classNames.

### Fixed

- **`parseCustomRange` calendar overflow** — `2025-02-30` /
  `2025-04-31` / non-leap `2025-02-29` used to silently normalise
  to the next valid date via `new Date(...)`. We now round-trip the
  parsed Y-M-D back through the constructed Date and reject any
  shift, so a typo can't surface as off-month data labelled with
  the typed month.
- **Custom range CSV export filename — TZ drift** —
  `dates.from.toISOString().slice(0, 10)` shifted from-date by one
  day for non-UTC machines (Asia/Shanghai's `2026-05-22 00:00`
  serialises as `2026-05-21T16:00:00.000Z`). Filename now echoes
  the raw URL params instead.
- **`/usage?range=custom` with no valid `from`** — used to silently
  degrade to no-bounds (= all-time data) on the page render while
  the URL still said "custom". The new Edge middleware short-circuits
  to a real 307 BEFORE any RSC streaming starts (a server-component
  `redirect()` only produces a 1-second meta-refresh in Next 15's
  streaming context).
- **Dashboard heatmap + footer scope** — `renderHeatmap` and
  `renderFooter` previously read raw `scan.records`, so a
  `--range 7d --source codex` run still claimed 20k+ "records in
  scope" from the full scan. Both now use the same filtered record
  set the KPI tiles / trend / breakdown are computed from.
- **Dashboard Active 5h block respects `--source`** — used to
  always probe Claude first and fall back to Codex, so
  `report -d --source codex` could surface a Claude window the user
  explicitly excluded. `pickActiveBlock` now branches on
  `data.source`: `claude` / `codex` show only that provider's
  window; `all` keeps the prefer-Claude-fall-back-to-Codex order.

### Internal

- **`filterRecordsForReport(scan, sources, opts)`** exported from
  `lib/cli-report/index.ts` — applies the same source / range /
  model / project filter that `computeReportData` uses internally,
  but returns the records instead of aggregated totals. Used by the
  dashboard renderer so its heatmap and footer scope stay
  consistent with the KPI tiles / trend / breakdown.
- **`computeActivityStats(records, { source: 'all' })`** — when
  records are already pre-filtered upstream, passing `'all'` skips
  a redundant per-record source filter. The dashboard heatmap
  switched to this pattern.

## [1.0.5] — 2026-05-19

CLI ergonomics overhaul + a brand-new `turns` / `conversations`
metric exposed in MCP and CLI report. Plus one P1 fix that resurrected
`ccgauge mcp` (silently exiting since 1.0.3's in-process refactor).

### Highlights

- **`turns` / "Conversations" metric** added to MCP responses and CLI
  report. A turn is one user prompt — the same unit the dashboard's
  usage table rows, and `usage trend → Conversations` toggle, already
  count. A single turn typically fans out to 10–20× more `requests`
  via tool loops, reasoning steps, and sub-agents, so `turns` is the
  better signal for "how often did I actually talk to the model".
  All three surfaces now share `lib/turns.ts → summarizeTurns()`.
- **15+ CLI fixes + UX polish** — `ccgauge -r 7d` now produces a
  helpful root error instead of `start: unknown option`; bare
  `ccgauge` is the documented shortcut for `ccgauge start` again;
  `ccgauge status` returns systemd-style exit 3 when not running;
  `ccgauge stop` no longer kills unrelated processes after a reboot
  (PID identity is verified); `ccgauge logs -f` no longer
  duplicates lines under heavy write rates; foreground server starts
  via `spawn` (matches background path); and a dozen smaller things.
- **New `ccgauge doctor` command** — one-screen diagnostic dumping
  version, environment, build artifacts, background-service state,
  and per-provider scan stats. The recommended first step for any
  bug report.
- **P1 fix: `ccgauge mcp` now stays alive.** 1.0.3 refactored the
  subcommand to run in-process via `await import()`, but a stray
  `process.exit(0)` after `runStdioServer()` killed the process right
  after the JSON-RPC transport opened, before any LLM client could
  finish `initialize`. The smoke test now drives `node bin/cli.mjs
  mcp` directly so this CLI-wrapper layer can never regress silently
  again.

### Added

- **`ccgauge doctor`** — single-shot diagnostic command. Prints
  ccgauge version + node / platform, ccgauge-relevant env vars
  (`CCGAUGE_*`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `NO_COLOR`,
  `FORCE_COLOR`), build-artifact presence, background-service state,
  and the indexer probe from `ccgauge mcp --check`. Plain text so
  it pastes into a GitHub issue cleanly.
- **MCP `turns` field** in every analytical tool's response shape:
  - `usage_summary` — `totals.turns`, `bySource.{claude,codex}.turns`.
  - `usage_by_time` — `buckets[i].totals.turns` and per-source
    breakdown; turns attribute to the bucket of their **earliest**
    record (same convention as the dashboard's overview chart).
  - `usage_by_model` — `models[i].turns` (turn is counted under
    the model of its first record; sums across models equal the
    scope's `totals.turns`).
  - `usage_by_project` — `projects[i].turns` (by turn's first cwd).
  - `usage_by_session` — `sessions[i].turns` (one session can hold
    many turns; CLI users / LLMs comparing "long session vs many
    short sessions" finally have the right number).
  - `daily_summary`, `weekly_summary`, `recent_activity` — same
    fields flow through their nested totals / per_day / sessions.
  - `cost_estimator` is unchanged (pure pricing, no turn concept).
- **CLI report `Convos` field** in `ccgauge report` output:
  - **Tokens section** gets a new `Convos / Requests` line, so the
    two activity counts read side-by-side.
  - **Top-N breakdown table** (model / project / session) gets a
    new `Convos` column between the dimension label and `Reqs`.
  - JSON output (`--json`) carries `totals.turns`, `trend[i].turns`,
    `breakdown[i].turns`.
- **`lib/turns.ts → summarizeTurns()`** helper — given a (filtered)
  record slice plus the full user / parent context, returns one
  `TurnSummary` per distinct turn root with its `firstTimestamp`,
  `firstModel`, `cwd`, `sessionId`, `source`. The single source of
  truth shared by dashboard / MCP / CLI report.
- **`SessionSummary.projectLabel`** — worktree-aware display label
  (`"ai-self-web (playwright)"` instead of bare `"playwright"`),
  matching the usage table. Drives the `/sessions` page, the
  session-detail header, and CLI report's session breakdown.

### Changed

- **`ccgauge` (no subcommand)** is the documented shortcut for
  `ccgauge start` again. A regression in 1.0.4's `normalizeArgv`
  refactor made bare `ccgauge` print root help and exit 1.
- **`ccgauge status` exit code** is now systemd-style 3 when no
  background service is running, so shell scripts can `if ccgauge
  status; then …`. **`--json` mode** intentionally still exits 0
  (the consumer is a script that should read `payload.running`),
  so `ccgauge status --json | jq` under `set -e` keeps working.
- **`ccgauge mcp` runs in-process via `await import()` + the bundle
  exports `runStdioServer` / `printCheck`.** Saves ~80–150 ms vs
  the old spawn-a-child design and removes a brittle signal-
  forwarding shim. (1.0.3 introduced this; 1.0.5 fixes the
  `process.exit(0)` regression that broke it for real users.)
- **`ccgauge mcp --check`** — verifies the bundle, boots the
  indexer, prints one line per provider with scanned dirs + record
  counts, and exits. Lets users debug "Claude Desktop doesn't see
  ccgauge tools" without spinning up an MCP client.
- **`--color` / `--no-color` / `FORCE_COLOR` / `NO_COLOR`** all
  resolve through a single `shouldUseColor()` helper now, with the
  documented precedence (`--no-color` highest, then env vars, then
  `isTTY`). Previously the report's color flag was hard-AND'd with
  `isTTY`, so `FORCE_COLOR=1 ccgauge report | tee log` lost colour.
- **`ccgauge start` foreground** uses `spawn` instead of `fork`.
  Next.js standalone doesn't use IPC; `fork` was opening an unused
  channel and the parent's `process.exit(0)` was racing the child's
  teardown on Ctrl+C. Now matches the background path's `spawn` +
  exit-code forwarding.
- **`--quiet`** silences Next.js's stderr too. Previously only stdout
  was ignored, so warnings still leaked. (Background mode is
  unaffected — it has always logged to a file.)
- **`ccgauge restart --dir ""`** clears the inherited override
  instead of silently re-reading the previous run's `dataDir` from
  `state.json`. Uses commander's `getOptionValueSource('dir') ===
  'cli'` instead of `!opts.dir` truthy check.
- **Background-start failure messages** now include the last 5
  lines of `~/.ccgauge/ccgauge.log`, so users don't have to discover
  `ccgauge logs` to learn that EADDRINUSE / their override path
  doesn't exist / etc. caused the silent timeout.
- **"Build artifact not found"** errors from `start` / `report` /
  `mcp` are unified into one `missingArtifactError(...)` helper.
  Includes `node --version` / `ccgauge --version` / `platform` so
  bug reports don't lose those.
- **`[ccgauge] error:`** prefix is now consistent on stderr
  diagnostics (was a mix of `[ccgauge]`, `[ccgauge-mcp]`, and bare
  prose). stdout user-facing messages stay unprefixed.
- **`/sessions` project column** uses `projectLabel` (worktree-aware)
  so rows for `…/.claude/worktrees/playwright` read
  `ai-self-web (playwright)` — matching the usage table.
- **CLI report's session breakdown** (`--by session`) `sub` text
  also uses `projectLabel`, for the same reason.
- **README / README.zh-CN** Commands table gains `ccgauge doctor`;
  Troubleshooting gains a "anything unexpected → ccgauge doctor"
  lead; MCP troubleshooting points at `ccgauge mcp --check`.

### Fixed

- **`ccgauge mcp` exited immediately after the JSON-RPC handshake**
  (P1 regression from 1.0.3): the in-process CLI wrapper called
  `process.exit(0)` after `await runStdioServer()`, but
  `runStdioServer` returns as soon as `server.connect(transport)`
  finishes the handshake — the long-running stdin readline is what
  holds the process alive. Removed the exit; documented with a
  `CRITICAL:` comment so it can't come back. Smoke test now runs
  through `node bin/cli.mjs mcp` so the CLI wrapper is on the
  covered path.
- **`ccgauge -r 7d -s codex` reported `start: unknown option '-r'`**
  instead of "did you mean `report`?". `normalizeArgv` now only
  injects `start` when every flag belongs to `start`'s own option
  set; otherwise it leaves argv alone and lets commander surface
  its own root-level error (which lists subcommands).
- **`ccgauge logs -f` duplicated lines under heavy write rates.**
  The follow loop used `stat().size` as the read cursor but didn't
  cap the `createReadStream`'s upper bound, so a chunk written
  between `stat` and the read could appear in both ticks. Now
  pins `end: s.size - 1`.
- **`ccgauge stop` could kill unrelated processes after a reboot.**
  `process.kill(pid, 0)` only checks PID liveness, and PID space
  recycles aggressively across boots. `state.json` now records a
  `bootId` (~ system uptime) and a `cmdMarker` (`"next-server"`),
  and `isProcessRunning` verifies both — falling back to the bare
  kill(0) on Windows where `ps` isn't available.
- **`test-mcp-server.mjs` flake** caused by top-N truncation: a
  tool that's in claude-only top-10 can land #11 in the merged
  all top-10 once codex contributes more competitors. The
  per-tool count comparison now skips tools that didn't survive
  the merged truncation (the broader "source filter is a no-op"
  check below catches the real bug it was originally meant to).
- **`/usage` project filter listed worktree leaves** as if they
  were independent projects (`affectionate-sammet-00dc35`,
  `agitated-diffie-5c15fe`, …), out of sync with `/projects`
  which already collapses worktrees under their canonical repo
  root. The dropdown now lists canonical cwds only; the
  `projects` URL param semantics changed from exact-cwd to
  canonical-cwd matching, and the aggregator's `projects` filter
  is bypassed in favour of a canonical-aware pre-filter so a
  single record under `…/.claude/worktrees/X` still counts when
  the user picks its main repo.

### Performance

- **Aggregator hot loop** — `withinRange` predicate used to call
  `Date#toISOString()` + `Array.includes()` once per record. Each
  entry-point function now hoists those into a `prepareOpts` step:
  ISO strings computed once, `models` / `projects` materialized as
  `Set` for O(1) membership. Measurable on the MCP `weekly_summary`
  / `usage_by_*` paths over year-scale histories; invisible for the
  single-pass dashboard aggregators.
- **MCP indexer's 30 s polling fallback** is now **off by default**.
  fs.watch's `recursive: true` handles changes reliably on modern
  macOS / Linux / Windows; the polling fallback was originally
  there for flaky network mounts and FUSE setups. The web
  dashboard's indexer **keeps polling ON** (user expects fresh
  data when they alt-tab back). Override either default with
  `CCGAUGE_POLL_FALLBACK={0,1}`.
- **`get-port` / `open` are lazy-imported** — only loaded by `start`
  / `restart` / `open`. Short-lived commands like `mcp`, `status`,
  `logs`, `report`, `--version` shave ~20–30 ms cold-start each.
  Matters most for `ccgauge mcp`, which LLM clients spawn per
  conversation.

### Internal

- **`summarizeTurns()`** in `lib/turns.ts` is the single source of
  truth for turn-level metadata; dashboard, MCP, and CLI report all
  consume it. Same parent-chain walk + synthetic-user skip as
  `buildTurnIndex` (which it builds on top of).
- **`TurnsContext`** in `lib/mcp/formatters.ts` packages
  `{ users, parentMap }` so per-source aggregator helpers can
  re-derive turn boundaries without re-plumbing args through every
  call site.
- **`SessionSummary` carries `projectLabel`** (worktree-aware) in
  addition to `projectName` (plain basename). Populated once by
  `aggregateBySession` via `resolveProjectLabel` (per-cwd cache).
- **`bootId()` helper** in `bin/cli.mjs` (`Date.now() - os.uptime()
  * 1000`, rounded) — a coarse system-boot timestamp used to tell
  pre-reboot PIDs from post-reboot ones.
- **`shouldUseColor()` + `ansiPalette()`** in `bin/cli.mjs` — used
  by `printReady` so the startup banner respects `NO_COLOR` and
  doesn't leave `^[[1m...` mojibake when piped to `tee` / CI.
- **Smoke test runs through the CLI wrapper.** `scripts/test-mcp-
  server.mjs` now spawns `node bin/cli.mjs mcp` instead of `node
  dist/mcp/server.mjs`, so any regression in the CLI wrapper
  (signal handling, lifecycle, exit-code shaping) is caught here.

## [1.0.4] — 2026-05-18

Correctness fixes + much stronger test coverage, plus a brand refresh
and a marketing-site restructure. No new runtime features.

### Fixed

- **Windows path sanitization.** `sanitizeForUser` now also strips
  forward-slashed, JSON-escaped, and long-path (`\\?\`) variants of
  `homedir()`, not just the literal `C:\Users\<name>` form. macOS /
  Linux behaviour unchanged.
- **5h-block empty state** follows the active source —
  `?source=codex` no longer says "Send a message in Claude Code".
  Same fix on the Codex tab inside the All view.
- **`combineTimeBuckets` shared-reference bug.** Shallow-cloned model
  entries were aliased back into the indexer's aggregator cache, so
  downstream mutations could poison subsequent reads. Deep-cloned on
  insertion; pinned by a new test.
- **`safeMcpHandler` non-Error throws** are now wrapped + scrubbed
  before re-throw; the previous branch silently fell through, shipping
  unscrubbed payloads into the MCP envelope.

### Added

- **6 test / drift scripts**, all wired into `pnpm test`:
  `test-turns`, `test-source-merge`, `test-cost-from-usage`,
  `test-range` (fixture-based unit tests for the four core code
  paths), plus `check-parser-versions` and `check-readme-images` (CI
  drift guards for silently-stale-cache and broken-npm-image
  regressions).

### Changed

- **Refined gauge brand mark**, unified across the dashboard, the
  marketing site, and both favicons. Cleaner geometry (centre at
  (32, 41), radius 18; arc + needle terminating on the dial rim),
  Indigo-400 → -600 gradient background, white-ring pivot. New shared
  `<LogoMark>` component on the marketing site so its Nav + Footer
  now use the same mark as the dashboard.
- **Marketing site is source-only.** Removed `site/package.json` and
  `site/pnpm-lock.yaml`; Astro deps live in root `devDependencies`,
  commands are explicit `pnpm site:*`. Still excluded from the npm
  tarball (`pnpm pack --dry-run | grep -c '^site/'` → `0`).
- **Theme-aware product screenshots.** New `<ThemedScreenshot>`
  component swaps between dark / light captures via the
  `.theme-light` class on `<html>`. 24 captures (6 pages × 2 locales
  × 2 themes) generated by an expanded `scripts/screenshots.mjs`.
- **OG cards** regenerated at higher fidelity.
- **`cost_estimator` MCP tool** description spells out that reasoning
  tokens are already counted inside `output_tokens` — don't
  double-count.
- **Activity heatmap tooltip** finally renders the share / of-peak
  labels that were defined but never used.
- **`CacheCreationBlock` type** extracted in `parse-jsonl.ts`.
- **CLI `readState()`** type-guards `pid` / `url` / `logFile`.

### Internal

- MCP server warm-up comment clarifies the fire-and-forget
  `getMcpIndexerReady()` is a cold-start shave — tool handlers still
  await the same memoized init promise.
- `AGENTS.md` + bundled READMEs updated for the source-only site
  layout and the new `pnpm site:*` command set.

## [1.0.3] — 2026-05-15

A focused **MCP server** correctness + performance + ergonomics pass,
plus a docs catch-up for the marketing site and the bundled READMEs.
Dashboard runtime is unchanged from 1.0.2. The MCP server adds a 9th
tool (`cost_estimator`), gets ~4× faster on weekly summaries, halves
its bundle size, and ships a `ccgauge mcp --check` self-test.

### Highlights

- **9 MCP tools** — added `cost_estimator(source, model, input_tokens,
  output_tokens, …)` for pure pricing what-ifs (no record lookup).
  Pairs with `usage_summary` for "if I run X more on Opus 4.7, what
  does it add to my month-to-date?".
- **`weekly_summary` is ~4× faster.** Rewrote the per-day trend from
  8 full record-set passes (1 totals + 7 daily totals × 2 internal
  source filters) down to a single `timeBuckets('day')` call + a
  7-slot skeleton merge. Same JSON shape out, including zero-fill
  for empty days.
- **MCP bundle 810 KB → 379 KB.** esbuild `minify: true` +
  `external: ['fsevents']` shaves 53% off the published tarball's
  MCP slice with no runtime behaviour change.
- **`ccgauge mcp --check`** — verifies the bundle, boots the indexer,
  and prints one line per provider (files / records / scanned dirs).
  Lets users debug "Claude Desktop doesn't see ccgauge tools"
  without spinning up an MCP client first.

### Added

- `cost_estimator` MCP tool — uses the provider's built-in
  per-1M-token pricing table; does NOT consult usage history.
  Useful for budgeting and cap planning.
- `ccgauge mcp --check` self-test command.
- README cross-references for both new entry points (`mcp --check`,
  `cost_estimator`) in en + zh.
- `__SERVER_VERSION__` injected by esbuild from `package.json#version`
  so the server's MCP handshake always agrees with the npm release.

### Changed

- **`ccgauge mcp` runs in-process.** The CLI subcommand used to
  spawn a second Node process for the bundled server (`spawn(node,
  [bundle])`); it now `await import()`s the bundle and calls
  `runStdioServer()` directly. Saves ~80–150 ms per invocation and
  removes a brittle signal-forwarding shim.
- **MCP responses are compact JSON.** Drop the `JSON.stringify(...,
  null, 2)` pretty-print on every tool response — LLMs don't read
  indentation but pay for it. ~30–50% smaller responses for the
  heavier tools (`weekly_summary`, `usage_by_session`).
  `CCGAUGE_MCP_PRETTY=1` re-enables.
- **Default limits on `usage_by_model` (20) and `usage_by_project`
  (20).** The cap existed as a max; the default is now the same
  value. A user asking "what did I work on this year" with hundreds
  of projects no longer gets a 200-entry payload.
- **`recent_activity` defaults to a 30-day window** (`days` arg to
  widen). Previously aggregated every session across the user's
  full CLI lifetime just to return the top 10 by `end_time` — cost
  grew linearly with history.
- **Day-aligned named ranges.** `7d` / `30d` / `90d` now map to
  `[start-of(N-1 days ago), end-of-today]` like `today` /
  `yesterday` / `this_week` already did. Previously `7d` was a
  rolling 7×24h window, so summing seven `daily_summary` calls
  didn't equal one `usage_summary({range:"7d"})` — they do now.
- **README Highlights refreshed** (en + zh). New top-level subsections
  for `ccgauge report` (CLI) and `ccgauge mcp` (MCP server) so the
  two no-server entry points are visible in the first scroll.
  Cross-provider section updated for 1.0.2's tri-state switcher +
  real provider logos + worktree-aware Projects collapsing.
  Drill-down section mentions the Tokens / Conversations trend toggle.

### Fixed

- **`parseDateLike` no longer accepts calendar-overflow dates with
  a time suffix.** `2026-02-31T00:00:00` used to silently roll
  forward to March 3 (JS `new Date()` normalises invalid dates);
  now both the bare-date branch and the time-suffix branch reject
  it. Affects every MCP date arg, the dashboard's `from`/`to` URL
  params, and `ccgauge report --since`/`--until`.
- **`SERVER_VERSION` no longer hardcoded** to `0.4.0`. Now sourced
  from `package.json#version` at bundle time, so the MCP server's
  `initialize` response reports the same version as the npm release
  it shipped in.
- **README `range: "14d"` example was bogus** — the schema enum
  doesn't accept `14d`, so following the README's project-breakdown
  prompt produced an error. Replaced with the explicit-`from`/`to`
  form. Same fix in `README.zh-CN.md`.

### Performance

| Metric | Before | After |
| --- | --- | --- |
| `dist/mcp/server.mjs` size | 810 KB | **379 KB** (-53%) |
| `weekly_summary` record-set passes | 8 (+ 2 internal source filters each) | **2** |
| `recent_activity` aggregation scope | every session ever | **last 30 days** |
| MCP response JSON byte count (typical) | indented | **~half** |
| Aggregator `withinRange` Date#toISOString() calls | per record × N filters | **once per call** |

### Security / privacy

- **MCP tool errors are scrubbed of `$HOME` paths** before they
  reach the SDK's error envelope. Belt-and-suspenders today (the
  only user-visible throws are clean date-arg validators), but
  defends against future error paths that might wrap an indexer
  error. Extracted the existing `sanitizeForUser` from the indexer
  module into a shared `lib/sanitize` so both layers use one
  definition.

### Internal

- `lib/aggregator/index.ts` — entry-point functions now hoist
  `from/to → ISO string` and `models/projects → Set` once per
  call instead of recomputing them per record. Measurable on the
  `weekly_summary` hot path; invisible for the dashboard's
  single-pass aggregators.
- New `lib/mcp/text-result.ts` — single source of truth for the
  MCP response wrapper. `lib/mcp/safe-handler.ts` — HOF that wraps
  tool callbacks with the path-scrub guard.
- `parseDayArg` moved from `tools/activity.ts` to `mcp/context.ts`
  next to `parseDateRange` so the two share a single implementation
  of the "today / yesterday / monday / YYYY-MM-DD" parser.
- 30 s polling fallback in the indexer is now **off by default for
  the MCP instance** and **on by default for the dashboard**.
  Override with `CCGAUGE_POLL_FALLBACK={0,1}`. The MCP server runs
  in a background daemon spawned by an LLM client and shouldn't
  keep the host warm just to catch the rare `fs.watch(recursive)`
  miss.
- `AGENTS.md` documents the `site/` sub-project, the v4 sidechain
  merge invariant, a release checklist, and the
  `raw.githubusercontent.com` hero-image fragility. Two new
  "intentionally NOT supported" items: folding `site/` into a pnpm
  workspace, and letting `site/` leak into the npm tarball.

### Docs (doesn't ship to npm)

- Marketing site (`site/`) catches up to 1.0.2: features page
  covers All view + conversation-count toggle + worktree merging;
  homepage hero, "Multi-source analytics" card, and ScreenshotFrame
  now use three distinct screenshots; hardcoded `v1.0.0` eyebrows
  removed.
- `site/public/images/README.md` rewritten as a single-source-of-
  truth inventory (file → used-by → source), with the prompt
  catalogue trimmed to filenames that actually exist. Legacy
  placeholder SVGs moved to an explicit "kept but unused"
  subsection.
- `site/public/robots.txt` no longer points at a non-existent
  `sitemap-index.xml`.

## [1.0.2] — 2026-05-15

This release brings the dashboard the long-requested **All view** (one
nav tab to see Claude + Codex merged), real provider logos in place of
the old colored-letter chips, and a switchable **Usage trend** that
finally lets you look at *conversations per day* the same way you'd
count rows in the usage table.

### Highlights

- **Tri-state source switcher** in the nav: `全部 · Claude · Codex`,
  with the All button leading so the merged-scope option reads first.
  Each button now shows the provider's real brand mark (Claude's
  orange burst, Codex's blue cloud) instead of a `C`/`X` letter chip.
  Persists via `?source=all` URL param + cookie; hides itself entirely
  when only one provider is detected on disk.
- **All-view dispatch pattern.** The aggregator contract is unchanged
  (still requires a single `ProviderId`); the page layer runs it per
  provider and merges via new `lib/source-merge.ts` helpers
  (`combineTotals` / `combineTimeBuckets`). List aggregations concat
  per source and re-sort. All seven pages and five API routes
  dispatch this way; `ProjectSummary` / `SessionSummary` carry a
  `source` field so mixed-source rows are unambiguous.
- **Usage trend: Tokens / Conversations toggle** on the overview. The
  trend section title changed to "Usage trend" with a segmented
  control between the existing stacked-token view and a new
  per-day **conversation count**. The conversation metric rolls API
  calls up to their user-prompt root via `buildTurnIndex`, then
  groups turns by the day of their earliest record — so the bar
  values match the usage-table row count 1:1.
- **Worktree-aware Projects.** All worktrees of the same repo now
  collapse into a single project row. Detection is pure-path first
  (matches both standard `/.git/worktrees/` and Claude Code's
  `/.claude/worktrees/` layout, so even worktree directories that
  have since been deleted from disk still merge correctly via their
  historical `cwd`). The detail page filters records by canonical
  match, so old bookmarks pointing at a worktree path still resolve;
  the session count is reconciled via sessionId Set union so the
  card matches the detail-page KPIs.

### Added

- `public/claude-logo.webp` and `public/codex-logo.png` — provider
  brand marks shipped as static assets. `ProviderAdapter` gets a new
  `logoSrc` field; settings page data-source list, Projects card
  source badges (All view), and Models card source badges all
  consume it.
- `lib/source-merge.ts` — `combineTotals` and `combineTimeBuckets`
  helpers that merge per-source aggregator output into a single
  flat view for the All scope.
- `lib/source.ts` — `EffectiveSource = ProviderId | 'all'` type;
  `resolveSource()` now decodes `?source=all` / `cookie=all`;
  `filterBySource()` short-circuits for `'all'`; `expandSources()`
  hands back the dispatch list `['claude'] | ['codex'] |
  ['claude','codex']`.
- `components/overview-trend-card.tsx` — client wrapper that holds
  the Tokens / Conversations toggle state and swaps between the
  existing `TokenStackChart` and the new `ConversationsBarChart`.
- `components/charts/conversations-bar-chart.tsx` — single-color
  brand bar chart whose `dataKey` is `turns`. Tooltip highlights
  the conversation count and surfaces the raw request count as a
  footnote so users can cross-check the two metrics in place.
- `components/block-progress-switcher.tsx` — client wrapper that
  renders the 5h-block card with an in-header tab control for the
  All view (switches between Claude's and Codex's blocks in place,
  replacing the inactive "live" pill in the top-right slot).
- `lib/project-label.ts` — `canonicalCwd` field on `LabelResult` and
  exported `resolveCanonicalCwd(cwd)` helper. Path-pattern matching
  (`<repo>/.git/worktrees/<name>` and `<repo>/.claude/worktrees/<name>`)
  runs ahead of the `fs.readFileSync('.git')` lookup so deleted
  worktrees still resolve to their main repo.

### Changed

- **Source switcher button order is now `All · Claude · Codex`**
  (previously `Claude · Codex · All` or single-provider). Plain
  letter chips are replaced with logo images everywhere — settings
  page data-source list, Projects card source badges, Models card
  source badges.
- **Usage trend section retitled** "用量趋势" / "Usage trend"
  (was "Token 用量趋势" / "Token usage trend"); description is
  now metric-dependent ("stacked by token type" vs "conversations
  per day").
- **Overview 5h block panel** for the All view is now a single
  card with an in-header tab switcher between providers. Defaults
  to whichever side has the heavier current block by cost so the
  user lands on the more interesting number. The original two-card
  side-by-side layout was tried and rejected — 5h windows can't be
  summed across providers (different rate-limit clocks), so a single
  switchable card communicates the constraint better.
- **Usage table default columns** trimmed to
  `Time · Prompt · Model · Project · Total` (Duration and Tools
  moved out of defaults). Storage key bumped `cols.v3 → cols.v4`
  so existing visibility prefs are reset to the new defaults.
- **Projects detail page** filter changed from exact `r.cwd === cwd`
  to canonical match (`resolveCanonicalCwd(r.cwd) === canonicalCwd`),
  so a single page now serves records from every worktree of the
  same repo. Old bookmarks pointing at a worktree path still work
  — they resolve to the same canonical and find the union of
  records.
- **Overview KPI tiles for All view** sum across providers via
  `combineTotals`; the Cost footnote is hidden in the All view
  (decided UX) because the merged number mixes Codex's "API
  equivalent" with Claude's API-exact value, so any single
  disclaimer would mislead one side.
- **Marketing site** got a `features` page with a bilingual
  screenshot gallery (`ScreenshotGallery.astro` + new screenshots
  under `docs/screenshots/` and `site/public/images/screenshots/`).
  Homepage feature cards now use the new feature thumbnails
  (`feature-cli/heatmap/i18n/mcp/privacy`); Open Graph images
  shipped as `og-default.png` and `og-cli.png`.

### Fixed

- **Usage table horizontal jitter on row expand.** Child rows in
  the Time column carried a `pl-5` (left-padding) for visual indent,
  which fed `table-layout: auto` and forced every column to
  re-balance widths each time a row toggled open. Replaced with
  `inline-block translate-x-5` — pure visual offset, doesn't enter
  the layout-box measurement, so column widths stay pinned and the
  table no longer jitters horizontally when you click a row.
- **Worktree projects double-counted** — multiple worktree `cwd`s
  for the same repo previously appeared as separate cards on the
  Projects page with their tokens / cost split between them. They
  now collapse to a single canonical card; the detail page unions
  records across all worktree `cwd`s of the same repo. Session
  count is reconciled via `sessionId` Set union so the card matches
  the detail page's KPIs.

### Internal

- `TokenStackDatum` got an optional `turns?: number` field so the
  same payload shape can drive both the stacked-token and
  conversation charts; consumers that don't care (sessions /
  models / projects detail pages) can leave it unset.
- `OverviewTrendCard` is a client component, but `Section` stays
  server-rendered — only the trend card's content + right-slot
  cross the client boundary, so the page header and SEO surface
  don't lose SSR.
- `mergeWorktreeProjects` in `app/projects/page.tsx` recomputes
  unique session counts by scanning the underlying records (Set of
  `sessionId` per `(source, canonicalCwd)` key) instead of summing
  pre-aggregated counts — the latter double-counts sessions that
  span multiple worktree cwds.
- Ad-hoc `*.png` files dropped at the repo root by playwright-mcp
  verification runs and the `.playwright-mcp/` artefact directory
  are now `.gitignore`d.

## [1.0.1] — 2026-05-13

### Fixed

- **Usage table no longer splits a single conversation when a sub-agent is
  invoked.** Claude Code stores each sub-agent invocation in its own
  `<parent-session-uuid>/subagents/agent-*.jsonl` file. The synthesised
  first user record in that file had `parentUuid: null`, breaking the
  chain back to the parent session — so the originating human prompt and
  the sub-agent's work appeared as two separate rows in the usage table,
  with token cost split across both.

  The Claude parser now marks every record with `isSidechain: true` and
  flags the sub-agent's first user as `isSynthetic`. The indexer runs a
  cross-file post-link pass on every snapshot rebuild that re-attaches
  the sub-agent's first user to the parent session's most-recent prior
  assistant. `buildTurnIndex` then walks past the synthetic user and
  groups the sub-agent's assistants under the originating human turn.

  Result: one user prompt = one row in the usage table, regardless of
  how many sub-agents it spawned. Click-to-expand shows all sub-agent
  tool calls inline as children. Cost attribution now correctly bills
  the originating prompt for the full work it triggered.

### Changed

- Claude parser version bumped to `claude-v4-sidechain-merge`. Existing
  persisted index entries with the previous parser version are
  automatically re-parsed on next startup; no manual cache cleanup
  required.

### Internal

- New `lib/data-loader/link-sidechain.ts` — pure function exposing
  `linkSidechainParents()` for testability; called by the indexer's
  `rebuildSnapshotNow`. Idempotent; safe to re-run on every snapshot.
- `AssistantRecord` / `UserRecord` now carry an optional `isSidechain`
  flag (sourced from raw JSONL); useful for future UI markers ("📎
  sub-agent" badge) and for the post-link pass.
- Marketing site scaffold landed under `site/` (Astro + Tailwind,
  bilingual, deploys independently to a static host). Excluded from
  the npm tarball via `.npmignore`.

## [1.0.0] — 2026-05-12

A polish release. Everything from 0.x — Claude + Codex parsers, the web
dashboard, the CLI report, the MCP server — is now considered stable and
documented. Calling it **1.0** to signal feature-complete: the data layer,
the cost math, the turn grouping, and the published-tarball shape are all
settled. Future minor versions will keep the existing surfaces working.

### Highlights

- **Overview "Activity" card** — sessions, messages, total tokens, active
  days, current/longest streak, peak hour, favorite model, plus a 7×24
  day-of-week × hour-of-day heatmap with hover tooltips (messages +
  tokens + share-of-total + share-of-peak). Heat-map cells size to the
  container so the card looks right at any width. Includes a tongue-in-
  cheek "you've used ~N× more tokens than _The Little Prince_" comparison.
- **Conversation-turn grouping handles Skills correctly.** When Claude
  Code invokes a `Skill`, it injects a synthetic `Base directory for this
  skill: ...` user message that previously fragmented a single
  conversation into 2–3 rows in the usage table. We now flag these
  injections (also `<system-reminder>` blocks and `Caveat:` preludes) as
  synthetic — they skip turn-boundary detection but still surface as the
  per-call "prompt" on child rows so you can tell which Skill produced
  each API call.
- **`ccgauge report` (CLI)** — formatted terminal usage report. Tokens +
  Cost summary, trend bar chart, top-N breakdown table, all 0.2 s end to
  end. Supports `--range`, `--source`, `--by model|project|session`,
  `--since/--until`, `--model/--project` filters, `--json` machine
  output, and `--level call|turn` for CSV-style detail.
- **MCP-aware ergonomics.** The Codex parser records the `effort` field
  from `turn_context` and surfaces it in the usage table model column
  (e.g. `GPT-5.2 Codex · high`). The 5h-block card now carries a small
  disclaimer ("wall-clock progress of the 5h window — not your plan
  quota") so users don't confuse our local block tracker with Anthropic's
  actual rate-limit counter.

### Added

- **Activity stats** — `lib/aggregator/activity.ts` computes streaks /
  heat-map / favorite model / token-comparison; rendered by
  `components/activity-stats.tsx` on the overview.
- **Silent auto-refresh on the usage page** — `components/auto-refresh.tsx`
  re-runs the server render every 15 s via `router.refresh()`. No spinner,
  no scroll reset, no search/expand state loss; pauses on hidden tabs.
- **Overview show/hide toggle** on the usage page —
  `components/overview-toggle.tsx` hides the KPI grid + trend chart for
  users who only want the table. State persists to localStorage and is
  applied pre-paint by the no-flash script so collapsed users don't see
  a flash.
- **Token-breakdown popover** in the usage table — hover the total cell
  to see input / output / cache-read / cache-create tokens with their
  per-component cost.
- **Codex `effort` field** plumbed from JSONL → AssistantRecord →
  UsageTableRow → model column display.
- **Per-call "direct prompt"** on child rows — surfaces skill metadata
  (`Base directory for this skill: /Users/.../skills/mf-commit`) on the
  individual API calls inside a Skill block, while the parent turn row
  shows the real human prompt.
- **CSV export overhaul** (`app/api/export/usage/route.ts`):
  - UTF-8 BOM so Excel for Windows / Mac opens it without mojibake.
  - Expanded column set: `turn_started_at`, `turn_ended_at`, `source`,
    `model_short`, `effort`, `reasoning_tokens`, `project_name`,
    `project_path`, `user_prompt`, etc.
  - `?level=turn` for one row per conversation turn instead of one per
    API call.
  - Filename embeds range + level (e.g.
    `ccgauge-usage-claude-7d-turn-2026-05-12.csv`).
- **Cross-platform CLI hardening** (`bin/cli.mjs`):
  - `safeKill(pid, signal)` wraps `process.kill` with `ESRCH` tolerance.
  - `windowsHide: true` on the background `spawn` so Windows doesn't flash
    a console window.
  - `restart` inherits the previous session's `port / host / dir / log`
    when the user doesn't override them.
  - `0.0.0.0 / ::` is rewritten to `127.0.0.1` for the browser-open URL.
  - `getPort` candidates widened to 20 ports past the preferred.
  - `waitForUrl` per-attempt `AbortSignal.timeout(500)`.
  - `logs --follow` uses incremental `createReadStream` instead of
    reading the whole file every tick.
  - `state.json` carries a `version` field; readers ignore unknown shapes.
- **`AGENTS.md`** — working agreement for AI coding agents editing the
  repo. Architecture invariants, common pitfalls, "first file to open"
  table for typical symptoms.

### Changed

- **Default theme is `dark`** (previously `system`). Existing users keep
  their explicit choice.
- **Tools column visible by default** in the usage table; `STORAGE_KEY`
  bumped to `cols.v3` so existing visibility prefs are reset to the new
  defaults.
- **SegmentedPicker (range / granularity) active state** matches the
  source-switcher: brand-color fill instead of muted gray. Visible in
  both the page header (`今天 / 7天 / 30天 / 90天 / 全部`) and Section
  headers (`小时 / 天 / 周 / 月`).
- **Page header layout** on the usage page — model / project filters
  moved from the Trend section's right slot up to the page header
  alongside the range picker. They apply to all of KPI / trend / table,
  so they belong at the page level rather than scoped to one card.
- **Overview header** dropped the `costToday` and `activeSessions` KPI
  cards — they overlapped with the existing trend chart + activity
  stats.
- **5h block card** — `{pct}% elapsed` renamed to `Time elapsed {pct}%`
  / `时间进度 {pct}%`, with a disclaimer line clarifying it's wall-clock
  progress, not plan quota.
- **CLI option `-h, --host` → `-H, --host`.** `-h` now reliably resolves
  to `--help` for `ccgauge start` and friends. Long form `--host` is
  unchanged.
- **CLI auto-open semantics:** foreground opens the browser by default
  (`--no-open` to disable); background never auto-opens (`ccgauge open`
  to open the running one).
- **Build pipeline:** moved from `prepublishOnly` to `prepack` so
  `pnpm pack` also runs the build. Build now strips `@img/sharp-*`
  binaries + the bundled `typescript` package from `.next/standalone` so
  the published tarball is cross-platform (no `.node` / `.dylib` files
  ship). Tarball is ~6.8 MB compressed.
- **pnpm `node-linker = hoisted`** in `.npmrc`. Next.js standalone +
  pnpm's default isolated layout produced tarballs missing top-level
  `node_modules/next` (npm pack drops symlinks). Hoisted sidesteps it.
- **i18n / Chinese day-of-week labels** changed from one-char (`一 / 二`)
  to full `周一 / 周二 / …` for clarity.

### Fixed

- **Skill-injection turn splitting** — see Highlights.
- **5h block height** in the overview row now matches the activity card.
- **Nav scrollbar artefact** — the nav's `overflow-x-auto` rendered a
  thin gray scrollbar track on macOS even when content didn't overflow,
  which read as a divider against the navbar background. Replaced
  `scrollbar-thin` with a `nav-scroller` rule that hides the bar
  entirely.
- **Activity heatmap labels** — y-axis now shows every row (was every
  other), x-axis labels every 3 hours (was every 6).

### Notes for users upgrading from 0.4.x

- No data-file or storage migration is required. Cached entries are
  re-parsed automatically on first run (`parserVersion` bumped to
  `claude-v3-synthetic-flag` and `codex-v4-effort`).
- Two localStorage keys you may want to clear if you want pristine
  defaults: `ccgauge.usage.cols.*` (column visibility) and
  `ccgauge.usage.overview.hidden` (overview collapsed). Otherwise we
  honor whatever you had.
- If you scripted around the CSV column order, note that headers have
  been renamed (`cost` → `cost_usd`, `input` → `input_tokens`, etc.)
  and new columns were added. The metadata header (lines starting with
  `#`) now also lists `level=call|turn`.

## [0.4.0] — 2026-05-05

This release ships an **MCP (Model Context Protocol) server** so any
MCP-aware LLM client (Claude Desktop, Cursor, Cline, your own agent…)
can query your Claude Code + Codex CLI usage history through structured
tools. The on-disk index introduced in 0.3.0 is reused, so the MCP
server boots cold in ~110 ms and answers warm calls in O(1).

### Added

- **MCP server** (`ccgauge mcp`) — stdio JSON-RPC server bundled as
  `dist/mcp/server.mjs` (esbuild single-file ESM, ~800 KB). Wires into
  Claude Desktop / Cursor / Cline / generic MCP clients via standard
  `{ command, args }` config blocks. Documented in the README.
- **8 MCP tools**:
  - `usage_summary` — totals + per-source breakdown for any window
  - `usage_by_time` — bucketed time-series (hour / day / week / month)
  - `usage_by_model` — per-model cost share
  - `usage_by_project` — per-project cost share + last-activity
  - `usage_by_session` — session list with title / model / duration / cost
  - `daily_summary` — "what did I do on day X" with sessions grouped by project
  - `weekly_summary` — 7-day roll-up with per-day cost trend + top sessions / projects
  - `recent_activity` — N most recently active sessions
- **1 MCP resource** — `ccgauge://providers` (detected providers, dirs,
  record counts, indexer status).
- **`source: 'all'` (default)** on every analytical tool — the response
  carries combined totals **and** a `bySource: { claude, codex }`
  breakdown so the LLM can answer combined or provider-specific
  questions in a single call.
- **Reasoning-tokens breakdown** in the dashboard's token-total hover
  card and per-message session timeline. `output_tokens` still includes
  reasoning for OpenAI billing parity; the new `reasoning_tokens` field
  is display-only and never double-counted.
- **Per-named indexer instance** — `getIndexer(name)` lets the web
  dashboard and the MCP server have independent persisted caches
  (`index-v2.json` vs `index-mcp-v2.json`) so they never fight for the
  same on-disk state file.
- **Strict input validation** for MCP date arguments — invalid `range`,
  `from`, `to`, or `daily_summary.date` values are rejected at parse
  time (zod refinement) and at runtime (defensive throws), instead of
  silently falling back to all-time data.

### Fixed

- **`top_tools` now respects `source`** in `daily_summary` /
  `weekly_summary`. Previously it ignored the source arg and returned
  identical tool counts for `claude` / `codex` / `all`, mixing
  per-provider stats together.
- **`usage_by_time` now carries `reasoning_tokens` per bucket.** The
  field was hard-coded to 0, breaking any "reasoning over time"
  question even though the `usage_summary` total was correct.

### Changed

- Codex parser bumped to `codex-v3-reasoning-detail` (schema change to
  expose `reasoning_tokens`); persisted entries from earlier parsers
  are auto-invalidated on next startup.
- `lib/aggregator/index.ts` exports `bucketKey` so external callers
  (the MCP layer) can re-bucket records under the same key scheme.

## [0.3.1] — 2026-05-05

### Fixed

- README screenshots and the English ↔ 简体中文 cross-link now use
  absolute GitHub URLs so the npm package page renders the hero image
  inline and the language switcher no longer 404s. Relative paths only
  resolve on GitHub, not on `npmjs.com`.

### Added

- `repository`, `homepage`, `bugs`, and `author` fields in
  `package.json` so the npm sidebar links back to GitHub Issues / repo
  / maintainer profile.

## [0.3.0] — 2026-05-05

This release adds **OpenAI Codex CLI** as a first-class data source alongside
Claude Code, ships a background-indexed data layer for instant page
navigation, and overhauls the `/usage` page so it no longer ships megabytes
of HTML to the browser.

### Added

- **Multi-provider support.** New `lib/providers/` adapter layer; toggle
  between **Claude Code** and **OpenAI Codex CLI** from the nav bar.
  Source persists via `?source=` URL param + cookie. Adding a third
  provider is a single new file plus a one-line registry entry.
- **Background indexer** (`lib/data-loader/indexer.ts`) — `fs.watch`-driven,
  with a 30 s polling fallback and per-file `mtime+size` deduplication.
  Pages now read an in-memory snapshot in O(1) instead of triggering a
  scan on every navigation.
- **Persisted index** at `~/.ccgauge/cache/index-vN.json`, with schema
  versioning and per-entry `parserVersion` so semantic parser fixes
  auto-invalidate stale records on the next startup. Restart goes from
  ~750 ms full scan to ~110 ms cache restore.
- **Server-side pagination** for `/usage`. URL-driven search / sort /
  page; only the current page's 25 turns are sent to the client.
  Real-data HTML payload drops from **~3.58 MB to ~40 KB** (89× smaller).
- **Streaming CSV export** (`/api/export/usage`) with formula-injection
  guard (escapes leading `=`, `+`, `-`, `@`).
- **Source switcher** in the nav with brand-coloured active state, plus
  `prefetch={false}` on tabs so opening the dashboard doesn't preload
  every heavy page.
- **`reasoning_tokens` breakdown** surfaced in token-total hover cards and
  the session timeline, so OpenAI users can see how much of their output
  was reasoning (typically the dominant cost driver).
- **Indexer status panel** in **Settings**: last indexed at, index
  duration, active watchers, loaded-from-disk flag, recent errors.
- **Unified API error handler** (`lib/api/error-handler.ts`) — every
  route returns structured JSON 500 with a sanitized message instead of
  HTML stack pages. Indexer errors leaked through `/api/scan` are
  scrubbed of `$HOME` paths.
- **Codex parser smoke test** (`pnpm test`) covering token-count
  semantics, parser version, reasoning-detail emission, and pricing.

### Changed

- **Brand colour** moved from Anthropic orange to Indigo so the
  dashboard's chrome doesn't clash with the (warm) Claude / Codex
  per-provider chips.
- **Overview header counts** now reflect the **active source** instead
  of mixing Claude + Codex global totals.
- **Codex parser** rewritten to derive each emitted record's tokens
  from the forward delta of `total_token_usage`, fixing a ~26 %
  over-count caused by duplicate / refresh `token_count` events
  (Codex now bills $134.63 instead of $165.63 for the same 70-file
  dataset).
- **Output token convention** for Codex: `output_tokens` includes
  reasoning tokens (matches OpenAI Responses API billing); reasoning
  is exposed separately as a display-only breakdown that does not
  double-count.
- **Codex parser timestamp fallback chain** (event → session_meta →
  last valid → file mtime → now) so events without a timestamp don't
  break sort or time bucketing.
- **Internationalised settings** with Codex / Claude data source
  display names, indexer status keys, and reasoning breakdown labels.

### Fixed

- **Nav bar shake on tab switch.** `html { overflow-y: scroll }` reserves
  the scrollbar gutter so navigations between short and tall pages no
  longer shift the centred nav horizontally.
- **`forceRescan` race condition.** Concurrent `POST /api/scan` calls
  are now coalesced onto a single in-flight Promise, so the in-memory
  index Map can't be wiped mid-scan.
- **Provider root not detected post-startup.** The poll loop re-detects
  data directories every 30 s, so a Codex/Claude install that appears
  after launch is picked up automatically.
- **Search debounce leak** — `UsageTable` clears its pending `router.push`
  timer on unmount so navigating away mid-typing doesn't yank you back
  to `/usage`.
- **`?page=NaN` / non-numeric inputs** were rendering an undefined page.
  Strict `Number.isFinite` guard, falls back to page 1.
- **`stats.durationMs` was misleading** after the indexer split work
  across phases. It now reflects the wall-clock from work start to
  snapshot ready.
- **Fast Refresh resets** during dev: indexer instance is stored on
  `globalThis` so HMR doesn't re-scan on every code save.

### Security

- **CSV formula injection guard** in `/api/export/usage`: cells starting
  with `=`, `+`, `-`, `@`, `\t`, or `\r` are prefixed with `'` so
  spreadsheet apps render them as text instead of executing as formulas.
- **Path sanitisation** in indexer error history: absolute paths
  containing the OS username are rewritten to `~` before being exposed
  via `/api/scan` and the Settings UI.

### Performance

| Metric                         | Before         | After      |
| ------------------------------ | -------------- | ---------- |
| `/usage?codex&all` HTML        | 3.58 MB        | **40 KB**  |
| `/usage?claude&7d` HTML        | 1.57 MB        | **34 KB**  |
| TTFB (warm)                    | 36–57 ms       | **15–19 ms** |
| Cold start with persisted cache | 747 ms (rescan) | **110 ms (restore)** |

## [0.2.0] — 2026-04-30

- One-click language + theme toggles refined in the header.
- Internal site-wide UX cleanup ahead of multi-provider support.

## [0.1.x]

- Initial public release as `ccgauge`: local Next.js dashboard for
  Claude Code token usage, cost, and 5-hour block tracking.

[1.1.4]: https://github.com/chengzuopeng/ccgauge/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/chengzuopeng/ccgauge/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/chengzuopeng/ccgauge/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/chengzuopeng/ccgauge/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.5...v1.1.0
[1.0.5]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/chengzuopeng/ccgauge/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/chengzuopeng/ccgauge/compare/v0.4.0...v1.0.0
[0.4.0]: https://github.com/chengzuopeng/ccgauge/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/chengzuopeng/ccgauge/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/chengzuopeng/ccgauge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/chengzuopeng/ccgauge/compare/v0.1.1...v0.2.0
