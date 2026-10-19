export const LAUNCH_COOKIE = 'ccgauge_launch';

export const LAUNCH_FILTERS = ['all', 'interactive', 'exec'] as const;

export type LaunchFilter = (typeof LAUNCH_FILTERS)[number];

export function isLaunchFilter(v: unknown): v is LaunchFilter {
  return typeof v === 'string' && (LAUNCH_FILTERS as readonly string[]).includes(v);
}

export function matchesLaunch(rec: { launch?: 'exec' }, filter: LaunchFilter): boolean {
  if (filter === 'all') return true;
  return filter === 'exec' ? rec.launch === 'exec' : rec.launch !== 'exec';
}
