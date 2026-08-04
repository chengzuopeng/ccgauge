import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Serving origin. GitHub Pages by default; CI passes the real owner so a fork
// deploys under its own account without editing this file.
const ghOwner = process.env.GH_PAGES_USER ?? 'chengzuopeng';
const siteUrl = `https://${ghOwner}.github.io`;

// The sub-path the site is served from is OPT-IN via BASE_URL. Unset — local
// dev, local builds — means "served from the root", so `pnpm site:dev` opens at
// :4321/ with no prefix to remember. The deploy workflow passes
// BASE_URL=/<repo> because GitHub project Pages serve from /<repo>; that is the
// only place a base is needed, and deriving it from the repo name there keeps
// a renamed repo or a fork working with no change here.
function normalizeBase(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}
const basePath = normalizeBase(process.env.BASE_URL);

// Redirect targets are written by hand, so they need '' rather than '/' at the
// root — `${'/'}/cli/` would emit a double slash.
const basePrefix = basePath === '/' ? '' : basePath;
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
