import path from 'node:path';
import os from 'node:os';

/**
 * The Windows user profile as seen from inside WSL, or null outside WSL.
 *
 * The Claude and Codex desktop apps run on the Windows side and write their
 * transcripts under `C:\Users\<name>\.claude` / `.codex`, which a ccgauge
 * running in WSL never sees through `os.homedir()`. Assumes the default
 * `/mnt/c` automount and a Windows account named like the Linux home folder;
 * anything else can still be pointed at with CLAUDE_CONFIG_DIR / CODEX_HOME.
 * Derived from `os.homedir()` (not `os.userInfo()`) so it honors $HOME, which
 * is how the tests keep the real user's data out of their scans.
 */
export function windowsHome(): string | null {
  if (process.platform !== 'linux' || !/microsoft/i.test(os.release())) return null;
  return path.join('/mnt/c/Users', path.basename(os.homedir()));
}
