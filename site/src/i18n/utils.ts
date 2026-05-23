import { ui, type UIKey } from './ui';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../consts';

/**
 * Astro injects `import.meta.env.BASE_URL` at build time. It's always
 * defined and always carries a trailing slash:
 *   - dev / custom-domain build → `'/'`
 *   - GH Pages project build    → `'/ccgauge/'`
 *
 * Path helpers in this file all run through these two constants so the
 * same `localePath('en', 'cli')` call produces `/cli/` in dev and
 * `/ccgauge/cli/` on GH Pages — without callers ever thinking about it.
 */
const BASE = import.meta.env.BASE_URL || '/';
/** BASE without the trailing slash. `'' | '/ccgauge'`. Used for prefix
 *  concatenation; we put the slash back in deliberately at each call site. */
const BASE_NO_SLASH = BASE.replace(/\/+$/, '');

/**
 * Returns a `t(key, vars?)` function bound to a specific locale. Mirrors
 * the dashboard's `tFn` API so the mental model is portable.
 *
 * - `vars` placeholder syntax is `{name}` — replaced via simple regex.
 * - Falls back to the English string when a Chinese key is missing.
 */
export function useTranslations(locale: Locale) {
  const dict = ui[locale] ?? ui[DEFAULT_LOCALE];
  const fallback = ui[DEFAULT_LOCALE];
  return function t(key: UIKey, vars?: Record<string, string | number>): string {
    const raw = dict[key] ?? fallback[key] ?? key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] === undefined ? `{${k}}` : String(vars[k]),
    );
  };
}

/**
 * Strip the deploy base (e.g. `/ccgauge`) off a pathname if present, so
 * downstream logic only worries about the in-app part. Returns a path
 * that always starts with `/`.
 *
 *   stripBase('/ccgauge/en/cli/')  → '/en/cli/'  (with BASE='/ccgauge/')
 *   stripBase('/ccgauge')          → '/'         (with BASE='/ccgauge/')
 *   stripBase('/en/cli/')          → '/en/cli/'  (with BASE='/')
 */
function stripBase(pathname: string): string {
  if (!BASE_NO_SLASH) return pathname;
  if (pathname === BASE_NO_SLASH) return '/';
  if (pathname.startsWith(BASE_NO_SLASH + '/')) {
    return pathname.slice(BASE_NO_SLASH.length);
  }
  return pathname;
}

/**
 * Parse the leading locale segment from a pathname. The default locale
 * (English) renders un-prefixed at the in-app root, so a path like
 * `/cli/` (or `/ccgauge/cli/`) resolves to `'en'`. Only `/zh/...`
 * (or `/ccgauge/zh/...`) carries an explicit prefix.
 */
export function localeFromPath(pathname: string): Locale {
  const seg = stripBase(pathname).split('/').filter(Boolean)[0];
  return (LOCALES as readonly string[]).includes(seg) ? (seg as Locale) : DEFAULT_LOCALE;
}

/**
 * Strip both the deploy base AND the locale segment from `pathname`,
 * returning the part after the locale (un-rooted for easy reassembly).
 *
 *   stripLocalePrefix('/ccgauge/zh/cli/')  → 'cli'    (BASE='/ccgauge/')
 *   stripLocalePrefix('/ccgauge/cli/')     → 'cli'    (BASE='/ccgauge/')
 *   stripLocalePrefix('/ccgauge/zh/')      → ''
 *   stripLocalePrefix('/ccgauge/')         → ''
 *   stripLocalePrefix('/zh/cli/')          → 'cli'    (BASE='/')
 *   stripLocalePrefix('/')                  → ''
 */
function stripLocalePrefix(pathname: string): string {
  const parts = stripBase(pathname).split('/').filter(Boolean);
  if (parts.length === 0) return '';
  if ((LOCALES as readonly string[]).includes(parts[0])) {
    return parts.slice(1).join('/');
  }
  return parts.join('/');
}

/**
 * Swap the locale of `pathname` to `target`, preserving the rest of the
 * path AND the deploy base. Used by `<LangSwitch>` so clicking "中" on
 * `/cli/` lands on `/zh/cli/` (or `/ccgauge/zh/cli/` on GH Pages).
 *
 * English is the default locale and serves un-prefixed below the base.
 * Chinese lives under `<base>/zh/...`.
 *
 *   switchLocaleUrl('/ccgauge/cli/', 'zh')     → '/ccgauge/zh/cli/'
 *   switchLocaleUrl('/ccgauge/zh/cli/', 'en')  → '/ccgauge/cli/'
 *   switchLocaleUrl('/ccgauge/', 'zh')          → '/ccgauge/zh/'
 *   switchLocaleUrl('/ccgauge/zh/', 'en')       → '/ccgauge/'
 *   switchLocaleUrl('/cli/', 'zh')              → '/zh/cli/'        (dev)
 */
export function switchLocaleUrl(pathname: string, target: Locale): string {
  const rest = stripLocalePrefix(pathname);
  if (target === DEFAULT_LOCALE) {
    return rest ? `${BASE_NO_SLASH}/${rest}/` : `${BASE_NO_SLASH}/`;
  }
  return rest ? `${BASE_NO_SLASH}/${target}/${rest}/` : `${BASE_NO_SLASH}/${target}/`;
}

/**
 * Build an in-locale link, base-prefix included. English is un-prefixed;
 * only Chinese carries the `/zh/` segment.
 *
 *   localePath('en', '')         → '/'              (or '/ccgauge/')
 *   localePath('en', '/cli/')    → '/cli/'          (or '/ccgauge/cli/')
 *   localePath('zh', '')         → '/zh/'           (or '/ccgauge/zh/')
 *   localePath('zh', '/cli/')    → '/zh/cli/'       (or '/ccgauge/zh/cli/')
 */
export function localePath(locale: Locale, path: string): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const localeSeg = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const tail = clean ? `/${clean}/` : '/';
  return `${BASE_NO_SLASH}${localeSeg}${tail}`;
}

/**
 * Build a static asset URL under `public/`. Use this anywhere you'd
 * otherwise write `/favicon.svg`, `/images/...`, etc. — without it,
 * the path bypasses the deploy base and 404s on GH Pages project pages.
 *
 *   assetUrl('favicon.svg')                  → '/favicon.svg'
 *                                              '/ccgauge/favicon.svg'
 *   assetUrl('images/feature-cli.webp')      → '/images/feature-cli.webp'
 *                                              '/ccgauge/images/feature-cli.webp'
 *
 * Idempotent on already-prefixed strings: a leading slash is stripped
 * before concatenating, so `assetUrl('/images/foo.png')` works too.
 */
export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${BASE}${clean}`;
}
