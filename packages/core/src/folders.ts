import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { GitOps, RepoRef } from '@incubator/git';
import { parseGitHubRef } from './adopt.js';

/** What the wizard may do with a folder: a new repository goes in it, or an existing one is updated. */
export type FolderPurpose = 'new' | 'existing';

export interface FolderVerdict {
  purpose: FolderPurpose;
  /** The normalized absolute path ("" when the input was not a usable path). */
  path: string;
  ok: boolean;
  exists: boolean;
  /** `new`: the folder exists and has nothing in it. */
  empty: boolean | null;
  /** `existing`: details of the repository. */
  git: {
    branch: string | null;
    head: string | null;
    clean: boolean;
    changed: string[];
    origin: RepoRef | null;
    /** A GitHub repository found on a remote other than `origin`, offered as the push target. */
    suggested: { remote: string; ref: RepoRef } | null;
  } | null;
  /** Reasons the folder cannot be used. Empty when `ok`. */
  problems: string[];
  /** Things worth knowing that do not block (for example, "no GitHub origin: push will be unavailable"). */
  warnings: string[];
}

const SHOWN_CHANGES = 8;

/**
 * Looks at a folder the owner chose (native dialog or typed path) without changing anything. Used by
 * the wizard to explain a choice before a run starts, and by the engine to re-check it when the run
 * resumes. Paths are never interpolated into commands: git gets them as `cwd`.
 */
export async function inspectFolder(
  git: Pick<GitOps, 'status' | 'headSha' | 'currentBranch' | 'remotes'>,
  input: string,
  purpose: FolderPurpose,
): Promise<FolderVerdict> {
  const verdict: FolderVerdict = {
    purpose,
    path: '',
    ok: false,
    exists: false,
    empty: null,
    git: null,
    problems: [],
    warnings: [],
  };
  const raw = input.trim();
  // why: a relative path would silently depend on the server's working directory.
  if (!raw || raw.includes('\0') || !path.isAbsolute(raw)) {
    verdict.problems.push('Choose a folder with the Browse button, or enter its full path.');
    return verdict;
  }
  const dir = path.resolve(raw);
  verdict.path = dir;
  verdict.exists = existsSync(dir);
  if (verdict.exists && !statSync(dir).isDirectory()) {
    verdict.problems.push('That path is a file, not a folder.');
    return verdict;
  }

  if (purpose === 'new') {
    if (verdict.exists) {
      verdict.empty = readdirSync(dir).length === 0;
      if (!verdict.empty)
        verdict.problems.push(
          'That folder is not empty. Choose an empty folder, or a new name to create one.',
        );
      else if (!writable(dir)) verdict.problems.push('You do not have permission to write there.');
    } else {
      const parent = path.dirname(dir);
      if (!existsSync(parent) || !statSync(parent).isDirectory())
        verdict.problems.push('The parent folder does not exist.');
      else if (!writable(parent))
        verdict.problems.push('You do not have permission to create it there.');
    }
    verdict.ok = verdict.problems.length === 0;
    return verdict;
  }

  if (!verdict.exists) {
    verdict.problems.push('That folder does not exist.');
    return verdict;
  }
  // `.git` is a directory in a normal clone and a file in a worktree or submodule.
  if (!existsSync(path.join(dir, '.git'))) {
    verdict.problems.push('That folder is not a git repository (there is no .git inside it).');
    return verdict;
  }
  const [status, head, branch, remotes] = await Promise.all([
    git.status(dir),
    git.headSha(dir),
    git.currentBranch(dir),
    git.remotes(dir),
  ]);
  const changed = status.map((e) => e.path);
  const originUrl = remotes.find((r) => r.name === 'origin')?.url ?? null;
  const originRef = originUrl ? parseGitHubRef(originUrl) : null;
  // why: a repository often keeps GitHub under another name (`github`, `upstream`) when origin is elsewhere.
  const others = originRef
    ? []
    : remotes.flatMap((r) => {
        const ref = r.name === 'origin' ? null : parseGitHubRef(r.url);
        return ref ? [{ remote: r.name, ref }] : [];
      });
  verdict.git = {
    branch,
    head,
    clean: changed.length === 0,
    changed: changed.slice(0, SHOWN_CHANGES),
    origin: originRef,
    suggested: others.length === 1 ? others[0]! : null,
  };
  if (!head)
    verdict.problems.push(
      'That repository has no commits yet. Make a first commit, then try again.',
    );
  if (!branch)
    verdict.problems.push('That repository is on a detached HEAD. Check out a branch first.');
  if (changed.length)
    verdict.problems.push(
      `That repository has ${changed.length} uncommitted change${changed.length === 1 ? '' : 's'}. Commit or stash them first, so your work stays separate from the update.`,
    );
  if (!originRef) {
    const tail =
      'Name a GitHub repository (owner/name) for the push and pull request, or finish with a local commit.';
    if (verdict.git.suggested) {
      const { remote, ref } = verdict.git.suggested;
      verdict.warnings.push(
        `This is a git repository. ${originSentence(originUrl)} The remote "${remote}" points to GitHub (${ref.owner}/${ref.name}), which is suggested for the push and pull request.`,
      );
    } else if (others.length > 1) {
      verdict.warnings.push(
        `This is a git repository. ${originSentence(originUrl)} Several remotes point to GitHub (${others.map((o) => `${o.ref.owner}/${o.ref.name}`).join(', ')}). ${tail}`,
      );
    } else {
      verdict.warnings.push(`This is a git repository. ${originSentence(originUrl)} ${tail}`);
    }
  }
  verdict.ok = verdict.problems.length === 0;
  return verdict;
}

/**
 * Only the host of a remote URL, never the URL itself: it can embed a token
 * (`https://user:token@host/...`), and the warning is shown on screen and logged.
 */
export function remoteHost(url: string): string | null {
  const scp = /^[^@/\s]+@([^:/\s]+):/.exec(url.trim());
  if (scp) return scp[1]!;
  try {
    return new URL(url.trim()).hostname || null;
  } catch {
    return null;
  }
}

function originSentence(originUrl: string | null): string {
  if (!originUrl) return 'It has no origin remote.';
  const host = remoteHost(originUrl);
  return host
    ? `Its origin points to ${host}, not GitHub.`
    : 'Its origin does not point to GitHub.';
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
