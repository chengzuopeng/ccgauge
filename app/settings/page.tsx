import { getCachedScan, getScannedDirsBySource, getIndexerStatus } from '@/lib/data-loader/scan';
import { BUILTIN_PRICING } from '@/lib/pricing/builtin';
import { BUILTIN_PRICING_OPENAI } from '@/lib/providers/codex/pricing';
import { listProviders, detectAvailableProviders } from '@/lib/providers';
import type { ProviderId } from '@/lib/providers';
import { PageShell, Section } from '@/components/section';
import { ScanRefresh } from '@/components/scan-refresh';
import { PricingTable, type PricingRow } from '@/components/pricing-table';
import { LanguageSwitcher } from '@/components/language-switcher';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { getServerT, getServerLocale } from '@/lib/i18n/server';
import pkg from '../../package.json' assert { type: 'json' };

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const VERSION = pkg.version;

export default async function SettingsPage() {
  const t = await getServerT();
  const locale = await getServerLocale();
  const scan = await getCachedScan();
  const dirsBySource = getScannedDirsBySource();
  const available = await detectAvailableProviders();
  const providers = listProviders();
  const indexerStatus = getIndexerStatus();

  const pricingTablesBySource: Record<ProviderId, PricingRow[]> = {
    claude: Object.entries(BUILTIN_PRICING)
      .filter(([model]) => isClaudeModelShown(model))
      .map(([model, p]) => ({
        model,
        input: p.input,
        output: p.output,
        cacheCreation5m: p.cacheCreation5m,
        cacheCreation1h: p.cacheCreation1h,
        cacheRead: p.cacheRead,
      })),
    codex: Object.entries(BUILTIN_PRICING_OPENAI)
      .filter(([model]) => isCodexModelShown(model))
      .map(([model, p]) => ({
        model,
        input: p.input,
        output: p.output,
        cacheCreation5m: p.cacheCreation5m,
        cacheCreation1h: p.cacheCreation1h,
        cacheRead: p.cacheRead,
      })),
  };

  return (
    <PageShell title={t('settings.title')} desc={t('settings.subtitle')}>
      <Section title={t('settings.preferences.title')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between gap-4 p-3 rounded-button border border-border">
            <div>
              <div className="font-medium text-text-primary text-sm">{t('settings.preferences.language')}</div>
              <div className="text-xs text-text-tertiary mt-0.5">English / 中文</div>
            </div>
            <LanguageSwitcher />
          </div>
          <div className="flex items-center justify-between gap-4 p-3 rounded-button border border-border">
            <div>
              <div className="font-medium text-text-primary text-sm">{t('settings.preferences.theme')}</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {t('settings.theme.light')} / {t('settings.theme.dark')} / {t('settings.theme.system')}
              </div>
            </div>
            <ThemeSwitcher />
          </div>
        </div>
      </Section>

      <Section title={t('settings.dataSources.title')} desc={t('settings.dataSources.desc')}>
        <div className="space-y-5">
          {dirsBySource.map(({ source, dirs }) => {
            const provider = providers.find((p) => p.id === source)!;
            const isAvail = available.includes(source);
            const sourceStat = scan.bySource.find((s) => s.source === source);
            return (
              <div key={source} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={provider.logoSrc}
                      alt=""
                      aria-hidden
                      className="w-5 h-5 rounded-[4px] object-contain shrink-0"
                    />
                    <span className="text-sm font-semibold text-text-primary">
                      {provider.displayName[locale]}
                    </span>
                    {isAvail ? (
                      <span className="pill bg-success/10 text-success border border-success/20 text-xs">
                        {t('settings.dataSources.active')}
                      </span>
                    ) : (
                      <span className="pill bg-bg-surface-hi text-text-tertiary text-xs">
                        {t('settings.dataSources.notPresent')}
                      </span>
                    )}
                  </div>
                  {sourceStat && isAvail && (
                    <span className="text-xs text-text-tertiary num-mono">
                      {sourceStat.filesScanned} files · {sourceStat.assistantRecords.toLocaleString()} records
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {dirs.map((d) => {
                    const present = scan.stats.scannedDirs.includes(d);
                    return (
                      <div
                        key={d}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-button border border-border bg-bg-surface-hi/30"
                      >
                        <span className="num-mono text-sm text-text-primary truncate">{d}</span>
                        <span
                          className={`pill text-xs whitespace-nowrap ${
                            present
                              ? 'bg-success/10 text-success border border-success/20'
                              : 'bg-bg-surface-hi text-text-tertiary'
                          }`}
                        >
                          {present ? t('settings.dataSources.active') : t('settings.dataSources.notPresent')}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-xs text-text-secondary">
          {t('settings.dataSources.envHint', {
            env1: 'CCGAUGE_CONFIG_DIR / CLAUDE_CONFIG_DIR',
            env2: 'CCGAUGE_CODEX_DIR / CODEX_HOME',
            appendix: '/projects · /sessions',
          })}
        </div>
        <div className="mt-4">
          <ScanRefresh />
        </div>
      </Section>

      <Section title={t('settings.scanStats.title')} desc={t('settings.indexer.desc')}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Stat label={t('settings.scanStats.files')} value={String(scan.stats.filesScanned)} />
          <Stat label={t('settings.scanStats.records')} value={scan.stats.recordsParsed.toLocaleString()} />
          <Stat label={t('settings.scanStats.assistant')} value={scan.stats.assistantRecords.toLocaleString()} />
          <Stat
            label={t('settings.indexer.lastIndexedAt')}
            value={
              indexerStatus.lastIndexedAt
                ? new Date(indexerStatus.lastIndexedAt).toLocaleTimeString()
                : '—'
            }
          />
          <Stat
            label={t('settings.indexer.indexDuration')}
            value={indexerStatus.indexDurationMs != null ? `${indexerStatus.indexDurationMs} ms` : '—'}
          />
          <Stat
            label={t('settings.indexer.watchers')}
            value={String(indexerStatus.watchers)}
          />
          <Stat
            label={t('settings.indexer.loadedFromDisk')}
            value={indexerStatus.loadedFromDisk ? t('common.yes') : t('common.no')}
          />
          <Stat
            label={t('settings.indexer.status')}
            value={indexerStatus.isIndexing ? t('settings.indexer.indexing') : t('settings.indexer.idle')}
          />
        </div>
        {indexerStatus.errors.length > 0 && (
          <div className="mt-4 text-xs text-warning space-y-1">
            <div className="font-medium">{t('settings.indexer.recentErrors')}</div>
            <ul className="list-disc list-inside space-y-0.5 num-mono text-text-tertiary">
              {indexerStatus.errors.slice(-3).map((e, i) => (
                <li key={i} className="truncate" title={e}>
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {providers.map((p) => {
        const rows = pricingTablesBySource[p.id];
        if (!rows || rows.length === 0) return null;
        return (
          <Section
            key={p.id}
            title={`${p.displayName[locale]} · ${t('settings.pricing.title')}`}
            desc={p.costFootnoteKey ? t(p.costFootnoteKey) : t('settings.pricing.desc')}
          >
            <PricingTable rows={rows} />
          </Section>
        );
      })}

      <Section title={t('settings.about.title')} desc={t('settings.about.subtitle', { version: VERSION })}>
        <ul className="text-sm text-text-secondary space-y-1.5">
          <li>• {t('settings.about.line1')}</li>
          <li>• {t('settings.about.line2')}</li>
          <li>• {t('settings.about.line3')}</li>
          <li>• {t('settings.about.line4')}</li>
        </ul>
      </Section>
    </PageShell>
  );
}

// Display filters for the settings pricing tables. Underlying BUILTIN_PRICING
// keeps full data so legacy model usage still computes accurate costs; this
// only controls which rows are visible in the settings UI.
function isClaudeModelShown(model: string): boolean {
  if (model.startsWith('claude-fable-')) return true;
  if (model === 'claude-haiku-4-5') return true;
  // 8 位日期后缀不剥掉会被正则捕获成 minor（如 sonnet-4-20250514 → minor=20250514 ≥ 6 误放行）
  const m = model.replace(/-\d{8}$/, '').match(/^claude-(sonnet|opus)-(\d+)(?:-(\d+))?$/);
  if (!m) return false;
  const major = Number(m[2]);
  const minor = m[3] ? Number(m[3]) : 0;
  return major > 4 || (major === 4 && minor >= 6);
}

function isCodexModelShown(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gpt-5');
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-pad py-4">
      <div className="label">{label}</div>
      <div className="num-mid mt-1">{value}</div>
    </div>
  );
}
