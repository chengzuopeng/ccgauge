import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// Serving origin. The site runs on a custom domain, which is why
// `site/public/CNAME` exists — GitHub Pages reads that file from the published
// artifact to bind the domain. `SITE_URL` overrides it so a fork can build for
// its own host without editing this file.
const siteUrl = process.env.SITE_URL ?? 'https://ccgauge.linkdiary.cn';

// The sub-path the site is served from is OPT-IN via BASE_URL. A custom domain
// serves from the root, so nothing passes it today and local dev matches
// production exactly. It stays because dropping the domain would put the site
// back on project Pages at /<repo>, where a base is mandatory — set
// BASE_URL=/<repo> in the deploy workflow and everything else follows.
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
