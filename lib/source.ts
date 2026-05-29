import { cookies } from 'next/headers';
import {
  ALL_PROVIDER_IDS,
  coerceProviderId,
  DEFAULT_PROVIDER,
  detectAvailableProviders,
  isProviderId,
} from './providers';
import type { ProviderId } from './providers';

export const SOURCE_COOKIE = 'ccgauge_source';

export type EffectiveSource = ProviderId | 'all';

export function isEffectiveSource(v: unknown): v is EffectiveSource {
  return v === 'all' || isProviderId(v);
}

export function parseSourceParam(v: string | null | undefined): EffectiveSource {
  if (v === 'all') return 'all';
  return coerceProviderId(v);
}

export async function resolveSource(searchParam?: string | null): Promise<EffectiveSource> {
  const available = await detectAvailableProviders();
  const canBeAll = available.length >= 2;

  const fromUrl = searchParam ?? undefined;
  if (fromUrl === 'all' && canBeAll) return 'all';
  if (fromUrl && isProviderId(fromUrl)) return fromUrl;

  const c = await cookies();
  const cookieVal = c.get(SOURCE_COOKIE)?.value;
  if (cookieVal === 'all' && canBeAll) return 'all';
  const preferred = cookieVal && isProviderId(cookieVal) ? cookieVal : DEFAULT_PROVIDER;

  if (available.length > 0 && !available.includes(preferred)) return available[0];
  return preferred;
}

export function filterBySource<T extends { source: ProviderId }>(
  records: T[],
  source: EffectiveSource,
): T[] {
  if (source === 'all') return records;
  return records.filter((r) => r.source === source);
}

export function expandSources(source: EffectiveSource): ProviderId[] {
  if (source === 'all') return ALL_PROVIDER_IDS.slice();
  return [source];
}
