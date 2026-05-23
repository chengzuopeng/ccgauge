import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Deploy mode is decided at build time:
//
// - **GH Pages (default for the CI workflow)** — set `GH_PAGES=1`. The
//   build is wired for `https://<owner>.github.io/<repo>/` (project
//   page, not org/user page), so we set `site` to that origin and `base`
//   to `/<repo>`. All canonical URLs, OG tags, and internal links pick
//   up the prefix automatically.
//
// - **Custom domain (when DNS + CNAME are in place)** — leave `GH_PAGES`
//   unset. We use `https://ccgauge.dev` and no base path. To activate:
//     1. Create `site/public/CNAME` containing `ccgauge.dev`.
//     2. Point the domain's DNS at GitHub Pages (apex A records or a
//        `www` CNAME).
//     3. In repo Settings → Pages, enter the custom domain.
//
// - **Local dev (`pnpm site:dev`)** — also leaves `GH_PAGES` unset, so
//   the dev server runs at `/` like before. The placeholder `site` URL
//   only matters for absolute meta tags, which dev rarely cares about.
//
// Both `GH_PAGES_USER` and `GH_PAGES_REPO` can override defaults if the
// repo gets forked or renamed.
const isGhPages = process.env.GH_PAGES === '1';
const ghOwner = process.env.GH_PAGES_USER ?? 'chengzuopeng';
const ghRepo = process.env.GH_PAGES_REPO ?? 'ccgauge';
const siteUrl = isGhPages ? `https://${ghOwner}.github.io` : 'https://ccgauge.dev';
const basePath = isGhPages ? `/${ghRepo}` : undefined;

// Astro 4's `redirects` map doesn't auto-prefix destinations with the
// configured `base`, so we have to bake it in ourselves. In dev /
// custom-domain mode `basePath` is undefined and the prefix collapses
// to ''; under GH_PAGES it becomes '/ccgauge'.
const basePrefix = basePath ?? '';
const legacyEnRedirects = {
  '/en/': `${basePrefix}/`,
  '/en/cli/': `${basePrefix}/cli/`,
  '/en/features/': `${basePrefix}/features/`,
  '/en/mcp/': `${basePrefix}/mcp/`,
  '/en/privacy/': `${basePrefix}/privacy/`,
};

// https://astro.build/config
export default defineConfig({
  // Used for:
  //   - canonical / OG meta URLs
  //   - <link rel="alternate"> hreflang URLs in BaseLayout.astro
  site: siteUrl,
  // Only set under GH_PAGES. Astro treats `base: undefined` as `/`,
  // which keeps `pnpm site:dev` behaving exactly like before.
  base: basePath,
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  // Legacy URL compatibility. Before we switched to `prefixDefaultLocale: false`
  // the English pages lived at `/en/cli/`, `/en/features/`, etc. Anything
  // out in the wild (bookmarks, social shares, search index entries) will
  // 404 if we just delete those paths. Astro renders these as static
  // HTML files containing a `<meta http-equiv="refresh">` redirect, which
  // works on GH Pages' plain static hosting (no server-side rewrites
  // needed) and is honored by search engines as a 301-equivalent.
  // Destinations are pre-prefixed with `basePath` (see top of file)
  // because Astro 4's redirects API doesn't auto-prefix.
  redirects: legacyEnRedirects,
  integrations: [
    tailwind({ applyBaseStyles: false }),
    // NOTE: @astrojs/sitemap was deliberately omitted. Its 3.7+ releases
    // depend on an `astro:routes:resolved` hook that's only emitted by
    // Astro 5, while we're pinning to Astro 4 for plugin-ecosystem
    // stability. With only 10 generated pages, hand-rolling a static
    // sitemap.xml (or using Cloudflare's auto-sitemap) is cheaper than
    // upgrading the whole stack.
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {
      // English serves un-prefixed at the root (`/`, `/cli/`, …). Chinese
      // lives under `/zh/...`. `redirectToDefaultLocale` only applies when
      // the default locale is prefixed, so it's omitted here.
      prefixDefaultLocale: false,
    },
    fallback: { zh: 'en' },
  },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    cacheDir: '../node_modules/.vite/site',
    resolve: {
      alias: {
        '@': new URL('./src', import.meta.url).pathname,
      },
    },
  },
});
