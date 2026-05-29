import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

const isGhPages = process.env.GH_PAGES === '1';
const ghOwner = process.env.GH_PAGES_USER ?? 'chengzuopeng';
const ghRepo = process.env.GH_PAGES_REPO ?? 'ccgauge';
const siteUrl = isGhPages ? `https://${ghOwner}.github.io` : 'https://ccgauge.dev';
const basePath = isGhPages ? `/${ghRepo}` : undefined;

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
