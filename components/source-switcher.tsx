'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { useT, useI18n } from '@/lib/i18n/context';
import type { ProviderId } from '@/lib/providers/types';

interface ProviderInfo {
  id: ProviderId;
  shortLabel: string;
  fg: string;
  bg: string;
  displayEn: string;
  displayZh: string;

  logoSrc?: string;
}

type Choice = ProviderId | 'all';

interface Props {
  available: ProviderId[];
  initial: Choice;
  providers: ProviderInfo[];
}

const COOKIE_NAME = 'ccgauge_source';

function setCookie(value: string) {
  if (typeof document === 'undefined') return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${oneYear}; SameSite=Lax`;
}

function deepLinkRoute(pathname: string): boolean {
  return /^\/sessions\/[^/]+|^\/projects\/[^/]+/.test(pathname);
}

function isChoice(v: string | null | undefined, available: ProviderId[]): v is Choice {
  if (!v) return false;
  if (v === 'all') return available.length >= 2;
  return (available as string[]).includes(v);
}

export function SourceSwitcher({ available, initial, providers }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useT();
  const { locale } = useI18n();
  const [pending, startTransition] = useTransition();
  const urlSource = searchParams.get('source');
  const urlChoice: Choice | null = isChoice(urlSource, available) ? (urlSource as Choice) : null;
  const [current, setCurrent] = useState<Choice>(urlChoice ?? initial);

  useEffect(() => {
    if (urlChoice && urlChoice !== current) setCurrent(urlChoice);
  }, [urlChoice, current]);

  if (available.length < 2) return null;

  const select = (id: Choice) => {
    if (id === current) return;
    setCurrent(id);
    setCookie(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('source', id);
    const target = deepLinkRoute(pathname)
      ? `/${pathname.split('/')[1]}?${params.toString()}`
      : `${pathname}?${params.toString()}`;
    startTransition(() => {
      router.push(target);
    });
  };

  const orderedProviders = providers.filter((p) => available.includes(p.id));

  return (
    <div
      role="group"
      aria-label={t('nav.source')}
      className="inline-flex items-center rounded-md border border-border bg-bg-surface p-0.5 gap-0.5"
      title={t('nav.source')}
    >
      <AllButton
        active={current === 'all'}
        label={t('source.all')}
        onSelect={() => select('all')}
        disabled={pending}
        providers={orderedProviders}
      />
      {orderedProviders.map((p) => {
        const isActive = p.id === current;
        const label = locale === 'zh' ? p.displayZh : p.displayEn;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => select(p.id)}
            aria-pressed={isActive}
            disabled={pending}
            className={`px-2.5 h-6 text-xs font-medium inline-flex items-center gap-1.5 rounded transition-colors ${
              isActive
                ? 'bg-brand-strong text-white shadow-sm'
                : 'text-text-tertiary hover:text-text-primary hover:bg-bg-surface-hi'
            }`}
          >
            <ProviderMark provider={p} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProviderMark({ provider }: { provider: ProviderInfo }) {
  if (provider.logoSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={provider.logoSrc}
        alt=""
        aria-hidden
        className="w-4 h-4 rounded-[3px] object-contain shrink-0"
      />
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none"
      style={{ background: provider.bg, color: provider.fg }}
    >
      {provider.shortLabel}
    </span>
  );
}

function AllButton({
  active,
  label,
  onSelect,
  disabled,
  providers,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
  disabled: boolean;
  providers: ProviderInfo[];
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      disabled={disabled}
      className={`px-2.5 h-6 text-xs font-medium inline-flex items-center gap-1.5 rounded transition-colors ${
        active
          ? 'bg-brand-strong text-white shadow-sm'
          : 'text-text-tertiary hover:text-text-primary hover:bg-bg-surface-hi'
      }`}
    >
      <span
        className="relative inline-flex items-center w-[26px] h-4 shrink-0"
        aria-hidden
      >
        {providers.slice(0, 2).map((p, i) => {

          const left = i === 0 ? 0 : 10;
          if (p.logoSrc) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.logoSrc}
                alt=""
                className="absolute w-4 h-4 rounded-[3px] object-contain"
                style={{ left, zIndex: providers.length - i }}
              />
            );
          }
          return (
            <span
              key={p.id}
              className="absolute inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold leading-none"
              style={{
                background: p.bg,
                color: p.fg,
                left,
                zIndex: providers.length - i,
              }}
            >
              {p.shortLabel}
            </span>
          );
        })}
      </span>
      <span>{label}</span>
    </button>
  );
}
