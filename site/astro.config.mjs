import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// The site is published to GitHub Pages, so that is the default rather than an
// env-gated special case: a local `pnpm site:build` now emits the same
// canonical URLs and the same `/ccgauge` base as CI does. Before this, the
// non-CI branch pointed at an unused `ccgauge.dev`, which meant a link or
// sitemap entry could look right locally and break once deployed.
// CI still passes GH_PAGES_USER / GH_PAGES_REPO so a fork deploys to its own
// owner and repo without editing this file.
const ghOwner = process.env.GH_PAGES_USER ?? 'chengzuopeng';
const ghRepo = process.env.GH_PAGES_REPO ?? 'ccgauge';
const siteUrl = `https://${ghOwner}.github.io`;
const basePath = `/${ghRepo}`;

const basePrefix = basePath ?? '';
const legacyEnRedirects = {
  '/en/': `${basePrefix}/`,
  '/en/cli/': `${basePrefix}/cli/`,
  '/en/features/': `${basePrefix}/features/`,
  '/en/mcp/': `${basePrefix}/mcp/`,
  '/en/privacy/': `${basePrefix}/privacy/`,
};

export default defineConfig({

  site: siteUrl,

  base: basePath,
  trailingSlash: 'always',
  devToolbar: { enabled: false },

  redirects: legacyEnRedirects,
  integrations: [
    tailwind({ applyBaseStyles: false }),

  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh'],
    routing: {

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
