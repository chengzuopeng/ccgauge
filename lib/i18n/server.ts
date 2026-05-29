import { cookies } from 'next/headers';
import { DEFAULT_LOCALE, type Locale, tFn } from './dict';
import { LOCALE_COOKIE } from './shared';

export { LOCALE_COOKIE } from './shared';

export async function getServerLocale(): Promise<Locale> {
  try {
    const c = await cookies();
    const v = c.get(LOCALE_COOKIE)?.value;
    if (v === 'zh' || v === 'en') return v;
  } catch {

  }
  return DEFAULT_LOCALE;
}

export async function getServerT(): Promise<(key: string, vars?: Record<string, string | number>) => string> {
  const locale = await getServerLocale();
  return (key: string, vars?: Record<string, string | number>) => tFn(locale, key, vars);
}
