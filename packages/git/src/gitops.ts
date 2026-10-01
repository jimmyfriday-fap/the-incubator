import { ToolError, type Exec, type SecretString } from '@incubator/runtime';

export interface GitIdentity {
  name: string;
  email: string;
}

export interface CommitOptions {
  identity: GitIdentity;
  /** ISO timestamp for author and committer (deterministic scaffold commits). */
  date?: string;
}

/**
 * Local git through the `git` binary (argv arrays, no shell). A token never appears in argv or in
 * a remote URL: it reaches git as an `http.extraHeader` through GIT_CONFIG_* environment variables.
 */
export interface GitOps {
  init(dir: string, branch?: string): Promise<void>;
  addAll(dir: string): Promise<void>;
  chmodX(dir: string, paths: readonly string[]): Promise<void>;
  commit(dir: string, message: string, opts: CommitOptions): Promise<string>;
  headSha(dir: string): Promise<string | null>;
  headMessage(dir: string): Promise<string | null>;
  push(dir: string, remote: string, refspec: string, token?: SecretString): Promise<void>;
  remoteSha(
    remote: string,
    ref: string,
    token?: SecretString,
    cwd?: string,
  ): Promise<string | null>;
  clone(
    remote: string,
    dir: string,
    opts?: { depth?: number; token?: SecretString },
  ): Promise<void>;
  /** Creates and checks out a new branch at HEAD. */
  checkoutNewBranch(dir: string, branch: string): Promise<void>;
  /** The checked-out branch, or null when HEAD is detached or unborn. */
  currentBranch(dir: string): Promise<string | null>;
  /** `git diff --name-status base..head` as [status, path] pairs. */
  diffNameStatus(dir: string, base: string, head: string): Promise<[string, string][]>;
  /** The URL of a remote, or null. */
  remoteGetUrl(dir: string, name?: string): Promise<string | null>;
}

const TIMEOUT = 5 * 60_000;

/** Environment that injects the token as an Authorization header for github.com only. */
export function tokenEnv(token: SecretString | undefined): Record<string, string> {
  if (!token || token.isEmpty) return {};
  const basic = Buffer.from(`x-access-token:${token.reveal()}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export function createGitOps(exec: Exec): GitOps {
  const git = async (
    args: string[],
    opts: { cwd?: string; env?: Record<string, string>; allowFail?: boolean; stdin?: string } = {},
  ) => {
    const r = await exec.run('git', args, {
      timeoutMs: TIMEOUT,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.stdin !== undefined ? { stdin: opts.stdin } : {}),
      env: { GIT_TERMINAL_PROMPT: '0', ...(opts.env ?? {}) },
    });
    if (r.code !== 0 && !opts.allowFail)
      throw new ToolError(
        `git ${args[0]} failed (exit ${r.code}): ${r.stderr.trim().split('\n').slice(-1)[0] ?? ''}`,
        {
          code: 'git_failed',
        },
      );
    return r;
  };
  return {
    async init(dir, branch = 'main') {
      await git(['init', '-q', '-b', branch], { cwd: dir });
    },
    async addAll(dir) {
      await git(['add', '-A'], { cwd: dir });
    },
    async chmodX(dir, paths) {
      if (paths.length) await git(['update-index', '--chmod=+x', '--', ...paths], { cwd: dir });
    },
    async commit(dir, message, { identity, date }) {
      const env: Record<string, string> = {
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
        ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
      };
      // why: the message goes on stdin, so no part of it is ever parsed as an argument.
      await git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-F', '-'], {
        cwd: dir,
        env,
        stdin: message,
      });
      return (await this.headSha(dir))!;
    },
    async headSha(dir) {
      const r = await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: dir, allowFail: true });
      return r.code === 0 ? r.stdout.trim() : null;
    },
    async headMessage(dir) {
      const r = await git(['log', '-1', '--format=%B'], { cwd: dir, allowFail: true });
      return r.code === 0 ? r.stdout.trim() : null;
    },
    async push(dir, remote, refspec, token) {
      await git(['push', '-q', remote, refspec], { cwd: dir, env: tokenEnv(token) });
    },
    async remoteSha(remote, ref, token, cwd) {
      const r = await git(['ls-remote', remote, ref], {
        env: tokenEnv(token),
        ...(cwd ? { cwd } : {}),
      });
      const line = r.stdout.split('\n').find((l) => l.endsWith(`\t${ref}`));
      return line ? line.split('\t')[0]! : null;
    },
    async checkoutNewBranch(dir, branch) {
      await git(['checkout', '-q', '-b', branch], { cwd: dir });
    },
    async currentBranch(dir) {
      const r = await git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: dir, allowFail: true });
      return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
    },
    async diffNameStatus(dir, base, head) {
      const r = await git(['diff', '--name-status', '--no-renames', `${base}..${head}`], {
        cwd: dir,
      });
      return r.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [st, ...rest] = l.split('\t');
          return [st!, rest.join('\t')] as [string, string];
        });
    },
    async remoteGetUrl(dir, name = 'origin') {
      const r = await git(['remote', 'get-url', name], { cwd: dir, allowFail: true });
      return r.code === 0 ? r.stdout.trim() : null;
    },
    async clone(remote, dir, opts = {}) {
      await git(
        [
          'clone',
          '-q',
          '-c',
          'core.autocrlf=false',
          // `text=auto` in the repo's own .gitattributes still checks out CRLF on Windows unless eol is pinned.
          '-c',
          'core.eol=lf',
          ...(opts.depth ? ['--depth', String(opts.depth)] : []),
          remote,
          dir,
        ],
        {
          env: tokenEnv(opts.token),
        },
      );
    },
  };
}
