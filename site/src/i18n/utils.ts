import { ui, type UIKey } from './ui';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../consts';

const BASE = import.meta.env.BASE_URL || '/';

const BASE_NO_SLASH = BASE.replace(/\/+$/, '');

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

function stripBase(pathname: string): string {
  if (!BASE_NO_SLASH) return pathname;
  if (pathname === BASE_NO_SLASH) return '/';
  if (pathname.startsWith(BASE_NO_SLASH + '/')) {
    return pathname.slice(BASE_NO_SLASH.length);
  }
  return pathname;
}

function stripLocalePrefix(pathname: string): string {
  const parts = stripBase(pathname).split('/').filter(Boolean);
  if (parts.length === 0) return '';
  if ((LOCALES as readonly string[]).includes(parts[0])) {
    return parts.slice(1).join('/');
  }
  return parts.join('/');
}

export function switchLocaleUrl(pathname: string, target: Locale): string {
  const rest = stripLocalePrefix(pathname);
  if (target === DEFAULT_LOCALE) {
    return rest ? `${BASE_NO_SLASH}/${rest}/` : `${BASE_NO_SLASH}/`;
  }
  return rest ? `${BASE_NO_SLASH}/${target}/${rest}/` : `${BASE_NO_SLASH}/${target}/`;
}

export function localePath(locale: Locale, path: string): string {
  const clean = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const localeSeg = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  const tail = clean ? `/${clean}/` : '/';
  return `${BASE_NO_SLASH}${localeSeg}${tail}`;
}

export function assetUrl(path: string): string {
  const clean = path.replace(/^\/+/, '');
  return `${BASE}${clean}`;
}

const INLINE_CODE_CLASSES =
  'font-mono text-xs px-1.5 py-0.5 rounded bg-bg-surface-hi border border-border text-text-primary';

export function renderInlineCode(s: string): string {
  return s.replace(/`([^`]+)`/g, `<code class="${INLINE_CODE_CLASSES}">$1</code>`);
}
