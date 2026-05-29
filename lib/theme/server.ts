import { cookies } from 'next/headers';
import { DEFAULT_THEME, THEME_COOKIE, type Theme } from './shared';

export { THEME_COOKIE, DEFAULT_THEME, type Theme };

export async function getServerTheme(): Promise<Theme> {
  try {
    const c = await cookies();
    const v = c.get(THEME_COOKIE)?.value;
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {

  }
  return DEFAULT_THEME;
}
