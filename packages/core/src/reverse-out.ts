import type { RunState } from './state.js';

/**
 * Reversing out of a run that did not finish (plan 069): everything the run left on this machine goes, and
 * what it left on GitHub is only named. This file decides; the engine does it. It never deletes through a
 * shell and never deletes anything the plan does not list.
 */
export type ReverseAction =
  | { kind: 'remove-worktree'; repo: string; dir: string; dirtyCount: number }
  | { kind: 'delete-branch'; dir: string; branch: string; returnTo: string | null }
  | { kind: 'remove-run-folder'; dir: string };

export interface LeftBehind {
  what: string;
  url?: string;
}

export interface ReversePlan {
  allowed: boolean;
  /** Why not, in plain words, and a code for the API. */
  refusal?: { code: string; message: string };
  actions: ReverseAction[];
  /** What the run made that is not removed, so the owner can do it by hand. */
  leftBehind: LeftBehind[];
  /** The plan removes a worktree with uncommitted files: it needs the owner's explicit yes. */
  needsConfirm: boolean;
}

export interface ReverseFacts {
  state: RunState;
  working: boolean;
  /** The run's own folder under the Incubator home. */
  runFolder: string;
  /** The folder the run works in, when it names one. */
  dir: string | null;
  /** The branch checked out in `dir` now, and how many files `git status` lists there. */
  currentBranch: string | null;
  dirtyCount: number;
  /** For a Backshack run: its worktree and the repository it belongs to. */
  backshack: { repo: string; dir: string } | null;
}

const BRANCH_PREFIX = 'incubator/';

/** The branch a run put in the owner's folder (recorded at delivery or at the start of coding), or null. */
export function recordedBranch(state: RunState): string | null {
  const deliver = state.steps['deliver']?.data as { branch?: string } | undefined;
  const start = state.steps['code.start']?.data as { branch?: string | null } | undefined;
  const b = deliver?.branch ?? start?.branch ?? null;
  return b && b.startsWith(BRANCH_PREFIX) ? b : null;
}

/** The branch the owner was on before the run (an update run records it), or null. */
export function returnBranch(state: RunState): string | null {
  const base = state.steps['folder.base']?.data as { branch?: string | null } | undefined;
  return base?.branch ?? null;
}

/** What publishing made on GitHub, from the steps that record a created repository. */
export function leftOnGithub(state: RunState): LeftBehind[] {
  const out: LeftBehind[] = [];
  for (const [step, v] of Object.entries(state.steps)) {
    if (!step.endsWith('repo.create') || v.status !== 'ok') continue;
    const url = (v.data as { url?: string } | undefined)?.url;
    out.push({ what: 'a GitHub repository this run created', ...(url ? { url } : {}) });
  }
  return out;
}

export function planReverseOut(f: ReverseFacts): ReversePlan {
  const none = { actions: [], leftBehind: [], needsConfirm: false };
  const refuse = (code: string, message: string): ReversePlan => ({
    allowed: false,
    refusal: { code, message },
    ...none,
  });
  if (f.working) return refuse('working', 'The run is working: stop it first.');
  if (f.state.done && !f.state.cancelled)
    return refuse('finished', 'The run finished. Reversing out is only for runs that did not.');

  const actions: ReverseAction[] = [];
  const leftBehind: LeftBehind[] = [...leftOnGithub(f.state)];
  let needsConfirm = false;
  const branch = recordedBranch(f.state);

  if (f.backshack) {
    // The worktree is the run's own; it goes, and then its branch in the repository it came from.
    if (f.dirtyCount > 0) needsConfirm = true;
    actions.push({
      kind: 'remove-worktree',
      repo: f.backshack.repo,
      dir: f.backshack.dir,
      dirtyCount: f.dirtyCount,
    });
    const own = f.state.steps['deliver']?.data as { branch?: string } | undefined;
    const b = branch ?? own?.branch ?? null;
    if (b && b.startsWith(BRANCH_PREFIX))
      actions.push({ kind: 'delete-branch', dir: f.backshack.repo, branch: b, returnTo: null });
  } else if (branch && f.dir) {
    if (f.currentBranch === branch) {
      const back = returnBranch(f.state);
      if (f.dirtyCount > 0)
        return refuse(
          'dirty_tree',
          `${f.dir} has ${f.dirtyCount} uncommitted change(s) on ${branch}. Commit or stash them, then reverse out.`,
        );
      if (back && back !== branch)
        actions.push({ kind: 'delete-branch', dir: f.dir, branch, returnTo: back });
      else
        leftBehind.push({
          what: `the branch ${branch} in ${f.dir}: it is checked out and the branch to go back to was not recorded. Switch branches, then delete it`,
        });
    } else {
      actions.push({ kind: 'delete-branch', dir: f.dir, branch, returnTo: null });
    }
  }
  actions.push({ kind: 'remove-run-folder', dir: f.runFolder });
  return { allowed: true, actions, leftBehind, needsConfirm };
}
