import type { RepoStatus } from '../api-types.js';

/** How often coming back to the window may ask GitHub again whether a repository moved on (plan 034). */
export const REMOTE_RECHECK_MS = 60_000;

/**
 * Whether coming back to the window should check the repository again (plan 029). A folder run reads its own
 * folder, which is cheap, and its answer counts the commits. An answer with no count (`commits: null`: a GitHub
 * run, which asks GitHub over the network, or nothing to compare yet) asks again at most once a minute.
 */
export function recheckOnFocus(last: RepoStatus | null, lastAskedAt: number, now: number): boolean {
  if (!last || last.commits !== null) return true;
  return now - lastAskedAt >= REMOTE_RECHECK_MS;
}
