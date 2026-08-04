
export const SITE_TITLE = 'ccgauge';
export const SITE_TAGLINE_EN = 'Local usage dashboard for Claude Code & OpenAI Codex CLI';
export const SITE_TAGLINE_ZH = 'Claude Code 与 OpenAI Codex CLI 的本地用量看板';

export const SITE_URL_FALLBACK = 'https://chengzuopeng.github.io/ccgauge';

export const GITHUB_URL = 'https://github.com/chengzuopeng/ccgauge';
export const NPM_URL = 'https://www.npmjs.com/package/ccgauge';

export const LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const THEME_STORAGE_KEY = 'ccgauge.site.theme';
