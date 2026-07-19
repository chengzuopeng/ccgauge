import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Nav } from '@/components/nav';
import { Providers } from '@/components/providers';
import { NoFlashScript } from '@/components/no-flash-script';
import { getServerLocale } from '@/lib/i18n/server';
import { getServerTheme } from '@/lib/theme/server';
import { tFn } from '@/lib/i18n/dict';
import { detectAvailableProviders, listProviders } from '@/lib/providers';
import { resolveSource } from '@/lib/source';
import { PricingWarmup } from '@/components/pricing-warmup';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: 'ccgauge — Claude Code & Codex Dashboard',
    description: tFn(locale, 'brand.tagline'),
    icons: {
      icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
      shortcut: '/favicon.svg',
      apple: '/favicon.svg',
    },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getServerLocale();
  const theme = await getServerTheme();
  const initialClass = theme === 'light' ? 'theme-light' : 'theme-dark';

  const available = await detectAvailableProviders();
  const initialSource = await resolveSource(null);
  const providerInfos = listProviders().map((p) => ({
    id: p.id,
    shortLabel: p.shortLabel,
    fg: p.color.fg,
    bg: p.color.bg,
    displayEn: p.displayName.en,
    displayZh: p.displayName.zh,
    logoSrc: p.logoSrc,
  }));

  return (
    <html lang={locale === 'zh' ? 'zh-CN' : 'en'} className={initialClass} suppressHydrationWarning>
      <head>
        <NoFlashScript />
      </head>
      <body className="min-h-screen bg-bg text-text-primary">
        <Providers locale={locale} theme={theme}>
          <Nav
            availableProviders={available}
            initialSource={initialSource}
            providerInfos={providerInfos}
          />
          <main>{children}</main>
          <PricingWarmup />
        </Providers>
      </body>
    </html>
  );
}
