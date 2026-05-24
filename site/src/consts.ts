/**
 * Site-wide constants. Imported by layouts and i18n helpers so renames /
 * URL changes happen in one place.
 */

export const SITE_TITLE = 'ccgauge';
export const SITE_TAGLINE_EN = 'Local usage dashboard for Claude Code & OpenAI Codex CLI';
export const SITE_TAGLINE_ZH = 'Claude Code 与 OpenAI Codex CLI 的本地用量看板';

/**
 * Compile-time fallback for canonical / OG / hreflang absolute URLs. In
 * normal use the real source of truth is `astro.config.mjs#site` (read at
 * runtime as `Astro.site` in `BaseLayout.astro`); this constant only kicks
 * in when `Astro.site` is undefined — e.g. an oddball test rig that
 * imports a layout outside of Astro's build pipeline. To switch deploy
 * hosts, edit `astro.config.mjs#site`, not this string.
 */
export const SITE_URL_FALLBACK = 'https://ccgauge.dev';

export const GITHUB_URL = 'https://github.com/chengzuopeng/ccgauge';
export const NPM_URL = 'https://www.npmjs.com/package/ccgauge';

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Theme storage key. Prefixed with `.site.` so it doesn't collide with the
 *  dashboard's `ccgauge.theme` if a user happens to run both on localhost. */
export const THEME_STORAGE_KEY = 'ccgauge.site.theme';
