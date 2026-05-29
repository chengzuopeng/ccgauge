'use client';

import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { DEFAULT_LOCALE, type Locale, tFn } from './dict';
import { LOCALE_COOKIE } from './shared';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<Ctx>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (k) => k,
});

const LS_KEY = 'ccgauge.locale';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function I18nProvider({ initialLocale, children }: { initialLocale: Locale; children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    try {
      const ls = localStorage.getItem(LS_KEY) as Locale | null;
      if (ls && ls !== initialLocale && (ls === 'en' || ls === 'zh')) {
        document.cookie = `${LOCALE_COOKIE}=${ls}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
        router.refresh();
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback(
    (l: Locale) => {
      try {
        localStorage.setItem(LS_KEY, l);
      } catch {}
      document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`;
      router.refresh();
    },
    [router],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => tFn(initialLocale, key, vars),
    [initialLocale],
  );

  const value = useMemo<Ctx>(() => ({ locale: initialLocale, setLocale, t }), [initialLocale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function useT() {
  return useContext(I18nContext).t;
}
