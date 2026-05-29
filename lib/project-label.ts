
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { projectNameFromCwd } from './utils';

interface LabelResult {

  label: string;

  isWorktree: boolean;

  mainName: string;

  worktreeName: string;

  canonicalCwd: string;
}

const cache = new Map<string, LabelResult>();

const GITDIR_PATTERN = /^(.+?)[/\\]\.git[/\\]worktrees[/\\]([^/\\]+)[/\\]?$/;

const CWD_WORKTREE_PATTERN = /^(.+?)[/\\](?:\.git|\.claude)[/\\]worktrees[/\\]([^/\\]+)(?:[/\\].*)?$/;

function resolveRaw(cwd: string): LabelResult {
  const fallbackName = projectNameFromCwd(cwd);
  if (!cwd) {
    return { label: fallbackName, isWorktree: false, mainName: fallbackName, worktreeName: '', canonicalCwd: cwd };
  }

  const pathMatch = CWD_WORKTREE_PATTERN.exec(cwd);
  if (pathMatch) {
    const mainRepoPath = pathMatch[1];
    const worktreeName = pathMatch[2];
    const mainName = basename(mainRepoPath) || mainRepoPath;
    return {
      label: `${mainName} (${worktreeName})`,
      isWorktree: true,
      mainName,
      worktreeName,
      canonicalCwd: mainRepoPath,
    };
  }

  try {
    const gitPath = `${cwd}/.git`;
    const s = statSync(gitPath);

    if (!s.isFile()) {
      return { label: fallbackName, isWorktree: false, mainName: fallbackName, worktreeName: '', canonicalCwd: cwd };
    }
    const text = readFileSync(gitPath, 'utf8').trim();

    const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
    const m = /^gitdir:\s*(.+)$/.exec(firstLine);
    if (!m) {
      return { label: fallbackName, isWorktree: false, mainName: fallbackName, worktreeName: '', canonicalCwd: cwd };
    }
    const gitdir = m[1].trim();
    const wt = GITDIR_PATTERN.exec(gitdir);
    if (!wt) {

      return { label: fallbackName, isWorktree: false, mainName: fallbackName, worktreeName: '', canonicalCwd: cwd };
    }
    const mainRepoPath = wt[1];
    const worktreeName = wt[2];
    const mainName = basename(mainRepoPath) || mainRepoPath;
    return {
      label: `${mainName} (${worktreeName})`,
      isWorktree: true,
      mainName,
      worktreeName,
      canonicalCwd: mainRepoPath,
    };
  } catch {
    return { label: fallbackName, isWorktree: false, mainName: fallbackName, worktreeName: '', canonicalCwd: cwd };
  }
}

export function resolveProjectLabel(cwd: string): string {
  const cached = cache.get(cwd);
  if (cached) return cached.label;
  const r = resolveRaw(cwd);
  cache.set(cwd, r);
  return r.label;
}

export function resolveProjectMeta(cwd: string): LabelResult {
  const cached = cache.get(cwd);
  if (cached) return cached;
  const r = resolveRaw(cwd);
  cache.set(cwd, r);
  return r;
}

export function resolveCanonicalCwd(cwd: string): string {
  return resolveProjectMeta(cwd).canonicalCwd;
}

export function clearProjectLabelCache(): void {
  cache.clear();
}
