import { homedir } from 'node:os';

export function sanitizeForUser(s: string): string {
  const home = homedir();
  if (!home) return s;

  const variants = new Set<string>([home]);
  if (process.platform === 'win32') {

    variants.add(home.replace(/\\/g, '/'));

    variants.add(home.replace(/\\/g, '\\\\'));

    variants.add('\\\\?\\' + home);
    variants.add('\\\\?\\' + home.replace(/\\/g, '/'));
  }

  let out = s;
  for (const v of variants) {

    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), '~');
  }
  return out;
}
