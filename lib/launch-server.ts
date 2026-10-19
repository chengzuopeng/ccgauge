import { cookies } from 'next/headers';
import { LAUNCH_COOKIE, isLaunchFilter, type LaunchFilter } from './launch';

export async function resolveLaunch(searchParam?: string | null): Promise<LaunchFilter> {
  if (isLaunchFilter(searchParam)) return searchParam;
  const c = await cookies();
  const fromCookie = c.get(LAUNCH_COOKIE)?.value;
  return isLaunchFilter(fromCookie) ? fromCookie : 'all';
}
