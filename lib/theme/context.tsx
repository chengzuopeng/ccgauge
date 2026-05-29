'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { DEFAULT_THEME, THEME_COOKIE, type Theme } from './shared';

interface Ctx {
  theme: Theme;
  resolved: 'light' | 'dark';
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<Ctx>({ theme: DEFAULT_THEME, resolved: 'dark', setTheme: () => {} });

const LS_KEY = 'ccgauge.theme';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'light') return 'light';
  if (t === 'dark') return 'dark';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function applyTheme(t: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveTheme(t);
  root.classList.remove('theme-light', 'theme-dark');
  root.classList.add(resolved === 'light' ? 'theme-light' : 'theme-dark');
  root.setAttribute('data-theme', resolved);
}

export function ThemeProvider({ initialTheme, children }: { initialTheme: Theme; children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    initialTheme === 'system' ? 'dark' : initialTheme,
  );

  useEffect(() => {
    try {
      const ls = localStorage.getItem(LS_KEY) as Theme | null;
      if (ls === 'light' || ls === 'dark' || ls === 'system') {
        if (ls !== initialTheme) {

          document.cookie = `${THEME_COOKIE}=${ls}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
        }
        setThemeState(ls);
        const r = resolveTheme(ls);
        setResolved(r);
        applyTheme(ls);
      } else {
        const r = resolveTheme(initialTheme);
        setResolved(r);
        applyTheme(initialTheme);
      }
    } catch {
      const r = resolveTheme(initialTheme);
      setResolved(r);
      applyTheme(initialTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const r = mq.matches ? 'light' : 'dark';
      setResolved(r);
      applyTheme('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(LS_KEY, t);
    } catch {}
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
    setThemeState(t);
    setResolved(resolveTheme(t));
    applyTheme(t);
  }, []);

  return <ThemeContext.Provider value={{ theme, resolved, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
