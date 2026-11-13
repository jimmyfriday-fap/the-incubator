import { readFileSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRemote } from './portfolio.js';

/** One repository of the Backshack set: its GitHub repo name and the folder it usually sits in (relative to the workspace root). */
export interface SystemRepo {
  name: string;
  hint: string;
}

/** The operator's eight repositories (plan 079 WI-2; backshack-agent-runner was dropped). */
export const BACKSHACK_SYSTEM_REPOS: readonly SystemRepo[] = [
  { name: 'backshack-workspace', hint: '.' },
  { name: 'backshack.cloud', hint: 'backshack-dev/app/public' },
  { name: 'backshack-generator', hint: 'backshack-generator' },
  { name: 'aiops.backshack.ai', hint: 'backshack-aiops' },
  { name: 'backshack-bow', hint: 'backshack-bow' },
  { name: 'datalake.backshack.ai', hint: 'backshack-datalake-dev' },
  { name: 'backshack-security-rig', hint: 'backshack-security-rig' },
  { name: 'stats.backshack.ai', hint: 'stats.backshack.ai' },
];

export type SystemRepoState = 'found' | 'not-found' | 'ambiguous';

export interface SystemRepoRow {
  repo: string;
  /** The chosen folder, or null (not found, or ambiguous). */
  dir: string | null;
  /** Every folder whose git origin matches, in scan order. */
  candidates: string[];
  state: SystemRepoState;
}

/** True when two folders are the same one (case-insensitive on Windows). */
export function sameFolder(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** `git`: a repository (its .git is a folder). `worktree`: a linked worktree (its .git is a file). */
function gitKind(dir: string): 'git' | 'worktree' | null {
  try {
    const s = statSync(path.join(dir, '.git'));
    return s.isDirectory() ? 'git' : s.isFile() ? 'worktree' : null;
  } catch {
    return null;
  }
}

/**
 * Finds the local folder of each repository by its git origin. Scans `root` itself and the folders up to 3 levels
 * below it; skips node_modules, dot-folders and linked worktrees; does not descend into a repository other than `root`.
 * With several folders for one repository the order is: a folder in `storeMembers`, then the hint folder, else ambiguous.
 */
export async function findSystemRepos(
  root: string,
  repos: readonly SystemRepo[],
  opts: { storeMembers?: readonly string[]; remoteOf: (dir: string) => Promise<string | null> },
): Promise<SystemRepoRow[]> {
  const base = path.resolve(root);
  const found: { dir: string; remote: string }[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    const kind = gitKind(dir);
    if (kind === 'worktree') return;
    if (kind === 'git') {
      const remote = normalizeRemote(await opts.remoteOf(dir));
      if (remote) found.push({ dir, remote });
      if (dir !== base) return;
    }
    if (depth >= 3) return;
    let names: string[];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      return;
    }
    for (const n of names) await walk(path.join(dir, n), depth + 1);
  };
  await walk(base, 0);
  const members = opts.storeMembers ?? [];
  const only = (list: string[]): string | null => (list.length === 1 ? list[0]! : null);
  return repos.map((r): SystemRepoRow => {
    const tail = `/${r.name.toLowerCase()}`;
    const candidates = found.filter((f) => f.remote.endsWith(tail)).map((f) => f.dir);
    let dir: string | null = null;
    if (candidates.length === 1) dir = candidates[0]!;
    else if (candidates.length > 1)
      dir =
        only(candidates.filter((c) => members.some((m) => sameFolder(m, c)))) ??
        only(candidates.filter((c) => sameFolder(c, path.resolve(base, r.hint))));
    const state: SystemRepoState =
      candidates.length === 0 ? 'not-found' : dir !== null ? 'found' : 'ambiguous';
    return { repo: r.name, dir, candidates, state };
  });
}

/**
 * A warning while the user-level Claude settings set MEMORY_STORE_DIR (it points every session at one store, which
 * is wrong once members have their own link). Read only: the Incubator never edits Claude settings.
 */
export function userStoreDirWarning(
  settingsFile: string = path.join(os.homedir(), '.claude', 'settings.json'),
): string | null {
  try {
    const v: unknown = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const env = (v as { env?: unknown } | null)?.env;
    const value =
      typeof env === 'object' && env !== null
        ? (env as Record<string, unknown>)['MEMORY_STORE_DIR']
        : undefined;
    return typeof value === 'string' && value !== ''
      ? 'MEMORY_STORE_DIR is set in your user-level Claude settings; remove it after the live run'
      : null;
  } catch {
    return null;
  }
}
