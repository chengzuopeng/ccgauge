'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/context';
import { useTabIndicator } from '@/components/use-tab-indicator';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { Logo } from '@/components/logo';
import { SourceSwitcher } from '@/components/source-switcher';
import type { ProviderId } from '@/lib/providers/types';

const ITEMS = [
  { href: '/', tk: 'nav.overview', exact: true },
  { href: '/usage', tk: 'nav.usage' },
  { href: '/sessions', tk: 'nav.sessions' },
  { href: '/projects', tk: 'nav.projects' },
  { href: '/models', tk: 'nav.models' },
  { href: '/settings', tk: 'nav.settings' },
];

const GITHUB_URL = 'https://github.com/chengzuopeng/ccgauge';

interface ProviderInfo {
  id: ProviderId;
  shortLabel: string;
  fg: string;
  bg: string;
  displayEn: string;
  displayZh: string;
  /** Optional path to a brand-logo image (under /public). When set,
   *  SourceSwitcher renders the image instead of the colored letter chip. */
  logoSrc?: string;
}

interface Props {
  availableProviders: ProviderId[];
  initialSource: ProviderId | 'all';
  providerInfos: ProviderInfo[];
}

export function Nav({ availableProviders, initialSource, providerInfos }: Props) {
  const pathname = usePathname();
  const t = useT();
  const activeItem = ITEMS.find((it) =>
    it.exact ? pathname === it.href : pathname === it.href || pathname.startsWith(it.href + '/'),
  );
  const activeHref = activeItem?.href ?? '';
  const { containerRef: navRef, rect } = useTabIndicator<HTMLElement>(activeHref);
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg-base/85 backdrop-blur-md supports-[backdrop-filter]:bg-bg-base/70">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center gap-2 sm:gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight whitespace-nowrap shrink-0 text-text-primary hover:opacity-90 transition-opacity"
          aria-label="ccgauge home"
        >
          <Logo className="w-7 h-7" />
          <span className="hidden xs:inline sm:inline">ccgauge</span>
          <span className="text-xs text-text-tertiary font-normal hidden lg:inline">
            {t('brand.tagline')}
          </span>
        </Link>
        <nav
          ref={navRef}
          className="relative flex-1 min-w-0 flex items-center gap-0.5 overflow-x-auto nav-scroller"
          aria-label="Primary"
        >
          {/* One underline that glides to the active item (instead of a
              per-item bar that pops in/out). Inset 8px to match the old
              left-2/right-2 look; hidden until measured. */}
          {rect && (
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-[12px] h-[2px] bg-brand rounded-full transition-[transform,width] duration-200 ease-out-soft"
              style={{ transform: `translateX(${rect.left + 8}px)`, width: Math.max(0, rect.width - 16) }}
            />
          )}
          {ITEMS.map((it) => {
            const active = it.exact
              ? pathname === it.href
              : pathname === it.href || pathname.startsWith(it.href + '/');
            return (
              <Link
                key={it.href}
                href={it.href}
                prefetch={false}
                data-tab={it.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative px-2.5 sm:px-3 py-1.5 text-sm rounded-button font-medium whitespace-nowrap shrink-0',
                  'transition-colors duration-150',
                  active
                    ? 'text-text-primary'
                    : 'text-text-secondary hover:text-text-primary hover:bg-bg-surface-hi/60',
                )}
              >
                {t(it.tk)}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          <SourceSwitcher
            available={availableProviders}
            initial={initialSource}
            providers={providerInfos}
          />
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher />
            <ThemeSwitcher />
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="h-7 w-9 inline-flex items-center justify-center rounded-md border border-border bg-bg-surface text-text-secondary hover:text-text-primary hover:bg-bg-surface-hi hover:border-border-hi transition-colors"
              title="GitHub"
              aria-label="GitHub"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.09 3.29 9.4 7.86 10.93.58.1.79-.25.79-.55v-2.1c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.68 1.25 3.34.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.45.11-3.03 0 0 .96-.31 3.15 1.18a10.94 10.94 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.24 2.74.12 3.03.73.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.68.41.36.78 1.06.78 2.14v3.18c0 .31.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
