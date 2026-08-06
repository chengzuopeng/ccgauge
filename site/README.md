# ccgauge marketing site

The product website, served from two hosts (see Deploy). Built with [Astro 4](https://astro.build) + Tailwind v3,
bilingual (English + 简体中文), with full dark/light theme support and
zero JS framework runtime.

This directory is **source-only**. Commands and dependencies live in the repo
root `package.json`, and the site uses the root `node_modules` and root
`pnpm-lock.yaml`. The site is still excluded from the npm tarball via the main
repo's `package.json#files` allowlist (plus a `site/` line in `.npmignore` as
belt-and-suspenders).

## Develop

```bash
# From repo root:
pnpm install
pnpm site:dev           # http://localhost:4321
```

The dashboard (Next.js, in the parent repo) lives on `:3738` in dev, so
the two can run side by side without port collisions.

## Build & preview

```bash
# From repo root:
pnpm site:build         # outputs to site/dist
pnpm site:preview       # serves site/dist on :4322
```

## Project layout

```
site/
├─ astro.config.mjs           # i18n, integrations, site URL
├─ tailwind.config.cjs        # mirrors the dashboard's design tokens
├─ tsconfig.json
├─ scripts/
│  └─ gen-placeholders.mjs    # branded SVG placeholders for hero/feature/og
├─ public/
│  ├─ favicon.svg             # copied from main repo
│  ├─ robots.txt
│  └─ images/                 # placeholders + real screenshots
│     ├─ README.md            # image-replacement workflow + AI prompts
│     ├─ *.svg                # placeholders (replace with real WebP/PNG)
│     └─ screenshots/
│        └─ overview-*.png    # real dashboard captures
└─ src/
   ├─ consts.ts               # site title / URL / locale tuple / theme key
   ├─ env.d.ts
   ├─ styles/global.css       # tailwind directives + CSS-var design tokens
   ├─ i18n/
   │  ├─ ui.ts                # shared short strings (nav, CTAs, footer)
   │  └─ utils.ts              # useTranslations / switchLocaleUrl / localePath
   ├─ layouts/
   │  └─ BaseLayout.astro      # <head> + nav + footer + no-flash theme script
   ├─ components/              # Nav / Footer / LangSwitch / ThemeToggle / …
   └─ pages/
      ├─ index.astro           # English home (default locale, un-prefixed)
      ├─ features.astro        # 4 more English pages at the root
      ├─ cli.astro
      ├─ mcp.astro
      ├─ privacy.astro
      └─ zh/                   # 5-page Chinese mirror under /zh/...
```

## Internationalisation

- `astro.config.mjs` uses Astro's built-in i18n with
  `defaultLocale: 'en'`, `prefixDefaultLocale: false`. English renders
  un-prefixed at the root (`/`, `/cli/`, …); Chinese lives under
  `/zh/...`.
- Short reusable strings live in `src/i18n/ui.ts` (English + 中文).
- Long-form page copy is **inline** per `.astro` file — easier to scan
  one document than to grep across a translation table.
- The `<LangSwitch>` component preserves the current path segment when
  flipping between locales (`/cli/` ↔ `/zh/cli/`).

## Theming

- Three-state theme cycler in `ThemeToggle.astro`: `system → dark → light → system`.
  First-time visitors default to **system** (tracking `prefers-color-scheme`);
  the choice is persisted to `localStorage` under `ccgauge.site.theme`
  (prefix `.site.` so it doesn't collide with the dashboard's
  `ccgauge.theme`).
- An inline no-flash `<script>` in `BaseLayout.astro` applies the
  matching `<html class>` before paint. The default value in both the
  no-flash script and `ThemeToggle` must stay in sync.
- CSS variables in `src/styles/global.css` mirror the main dashboard's
  Indigo palette so transitioning between marketing site and product
  feels seamless.

## Images

See [`public/images/README.md`](./public/images/README.md) for:

- the **complete file inventory** (which page uses which screenshot or
  generated card)
- the **AI-generation prompt catalogue** for every `feature-*.webp` and
  `og-*.png`
- the **refresh workflow** for screenshots and OG art

Quickest path when the dashboard UI changed and the marketing screenshots
look stale:

```bash
# From repo root, regenerate dashboard screenshots (Playwright):
pnpm screenshots

# Copy them into the site, then rebuild:
cp docs/screenshots/*.png site/public/images/screenshots/
pnpm site:build
```

To re-generate the legacy placeholder SVGs (rarely needed — the site
ships real WebP / PNG now):

```bash
pnpm site:gen:placeholders
```

## Deploy

Both deployments are driven by `.github/workflows/deploy-site.yml` on any push
to `main` touching `site/**`, `package.json`, `pnpm-lock.yaml`, or the workflow
itself. Same source, two builds, because the two hosts serve differently:

| Host | URL | Job | Build env |
|---|---|---|---|
| GitHub Pages | `https://chengzuopeng.github.io/ccgauge/` | `build` + `deploy` | `BASE_URL=/<repo>`, `GH_PAGES_USER` |
| EdgeOne | `https://ccgauge.linkdiary.cn/` | `edgeone` | `SITE_URL=https://ccgauge.linkdiary.cn` |

`SITE_URL` sets the origin used for canonical / hreflang / og:url. Getting it
wrong is silent — relative links keep working while every absolute URL points
at the other host. `BASE_URL` is opt-in: unset means "served from the root",
which is what a custom domain and local dev both want. Pages needs it because
project Pages serve under `/<repo>`.

### Why EdgeOne is pushed from CI rather than connected to the repo

EdgeOne's Git integration cannot build this site. It picks the framework by
scanning the repo root, and this root is a Next.js app, so it loads
`@edgeone/opennextjs-pages` ~0.4s *before* it reads any build configuration,
then fails on a `next build` artifact an Astro build never produces:

    [plugins][✘] Error executing onBuild hook: ENOENT ... .next/required-server-files.json

Setting 框架预设 to "Other" only chooses the build command. Deleting the markers
from the build command doesn't work either — that was tried and reverted
(a9684ad / bfb59ef): the deploy still reported "Next.js project detected" four
seconds after both files were gone, emitting a byte-identical edge bundle
compiled from middleware that no longer existed. The detection result is
captured at plugin-load time, before any build command runs.

So CI builds the site and pushes the finished output, which never gives EdgeOne
a repo to inspect:

```bash
npx --yes edgeone pages deploy site/dist -n <project> -t <token>
```

### EdgeOne setup, and the two things that will bite you

- **The project must be `Upload` type.** A project created in the console by
  connecting a Git repo has Provider `Github`, and the CLI refuses it:
  *"This project type does not support direct folder or zip file deployment."*
  There is no way to convert one — delete it and let the CLI create the project
  on first deploy, then re-bind the custom domain, which the deletion releases.
- **`EDGEONE_API_TOKEN` must be a *repository* secret**, not an environment
  secret. Environment secrets are only visible to jobs that declare that
  `environment:`, and the `edgeone` job deliberately doesn't — it must not queue
  behind the Pages deployment. Settings → Secrets and variables → Actions →
  Repository secrets.
- `EDGEONE_PROJECT_NAME` (repository *variable*) overrides the project name,
  defaulting to `ccgauge`. Set it to point at a differently named project
  without editing the workflow.
- The deploy step skips with a notice when the token is absent, so forks and
  a not-yet-configured repo stay green instead of failing.

Token: EdgeOne console → API Token. Expiries from 1 day to 1 year are offered;
the deploy starts failing silently-ish (a red `edgeone` job) when it lapses.

## Why this isn't part of the npm package

The npm tarball is ~7 MB and contains only the dashboard + CLI + MCP runtime.
Shipping marketing-site source code and generated artwork would bloat install
times for every user who only wants to run `npx ccgauge`. The Astro build
dependencies live in root `devDependencies`, so they are available to
maintainers without becoming runtime dependencies. The main repo's
`package.json#files` whitelists exactly what publishes; `site/` is not on that
list.
