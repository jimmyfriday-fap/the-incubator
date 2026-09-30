import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PolicyError, ToolError, type Exec } from '@incubator/runtime';

export interface RepoRef {
  owner: string;
  name: string;
}

export interface RepoInfo extends RepoRef {
  private: boolean;
  visibility: 'private' | 'public' | 'internal';
  description: string;
  defaultBranch: string;
  htmlUrl: string;
}

export interface TokenInfo {
  login: string;
  kind: 'classic' | 'fine-grained' | 'unknown';
  /** Classic tokens only; fine-grained tokens are verified by probing at publish. */
  scopes: string[];
}

export interface Label {
  name: string;
  color: string;
  description: string;
}

export interface BranchProtection {
  requiredChecks: string[];
  requirePr: boolean;
  requiredApprovals: number;
  allowForcePush: false;
  allowDeletion: false;
}

/** The GitHub operations publish and adopt need (TDD §4.4). Every method is idempotent-friendly. */
export interface GitHubAdapter {
  tokenInfo(): Promise<TokenInfo>;
  getRepo(ref: RepoRef): Promise<RepoInfo | null>;
  createRepo(
    ref: RepoRef & {
      ownerType: 'user' | 'org';
      visibility: RepoInfo['visibility'];
      description: string;
    },
  ): Promise<RepoInfo>;
  getBranchSha(ref: RepoRef, branch: string): Promise<string | null>;
  createBranch(ref: RepoRef, branch: string, sha: string): Promise<void>;
  setBranchProtection(ref: RepoRef, branch: string, rules: BranchProtection): Promise<void>;
  ensureLabels(ref: RepoRef, labels: readonly Label[]): Promise<string[]>;
  /** Creates the variables that do not exist yet; never overwrites a value. Returns created names. */
  ensureVariables(ref: RepoRef, vars: Readonly<Record<string, string>>): Promise<string[]>;
  openPr(
    ref: RepoRef,
    pr: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }>;
  /** Where git pushes (https for GitHub; a local bare repository for the fake). */
  remoteUrl(ref: RepoRef): string;
}

export type GitHubMethod = Exclude<keyof GitHubAdapter, 'remoteUrl'>;

export interface FakeCall {
  method: GitHubMethod;
  args: unknown[];
}

/**
 * In-memory GitHub for tests (TDD §4.4): records every call for sequence snapshots, injects failures
 * (`failAt`, before or after the effect) and backs each repository with a real bare git repository,
 * so pushes and branch SHAs are tested for real.
 */
export class FakeGitHub implements GitHubAdapter {
  readonly calls: FakeCall[] = [];
  readonly repos = new Map<
    string,
    RepoInfo & {
      labels: Label[];
      variables: Record<string, string>;
      protection: Record<string, BranchProtection>;
      prs: { number: number; head: string; base: string; title: string; body: string }[];
    }
  >();
  readonly root: string;
  /** Fail the next call to `method`, either before its effect or after it (a simulated crash). */
  failAt: { method: GitHubMethod; when: 'before' | 'after'; status?: number } | null = null;

  constructor(
    private readonly exec: Exec,
    readonly opts: {
      login?: string;
      kind?: TokenInfo['kind'];
      scopes?: string[];
      root?: string;
      protectionUnsupported?: boolean;
    } = {},
  ) {
    this.root = opts.root ?? mkdtempSync(path.join(os.tmpdir(), 'fake-github-'));
  }

  private key(ref: RepoRef): string {
    return `${ref.owner}/${ref.name}`.toLowerCase();
  }

  private async call<T>(
    method: GitHubMethod,
    args: unknown[],
    effect: () => Promise<T> | T,
  ): Promise<T> {
    this.calls.push({ method, args: structuredClone(args) });
    const f = this.failAt?.method === method ? this.failAt : null;
    if (f?.when === 'before') {
      this.failAt = null;
      throw new ToolError(`injected failure before ${method}`, { code: 'injected' });
    }
    const out = await effect();
    if (f?.when === 'after') {
      this.failAt = null;
      throw new ToolError(`injected failure after ${method}`, { code: 'injected' });
    }
    return out;
  }

  private repo(ref: RepoRef) {
    const r = this.repos.get(this.key(ref));
    if (!r) throw new ToolError(`404 ${ref.owner}/${ref.name}`, { code: 'not_found' });
    return r;
  }

  private bare(ref: RepoRef): string {
    return path.join(this.root, ref.owner, `${ref.name}.git`);
  }

  remoteUrl(ref: RepoRef): string {
    return pathToFileURL(this.bare(ref)).href;
  }

  tokenInfo(): Promise<TokenInfo> {
    return this.call('tokenInfo', [], () => ({
      login: this.opts.login ?? 'octo',
      kind: this.opts.kind ?? 'classic',
      scopes: this.opts.scopes ?? ['repo', 'workflow'],
    }));
  }

  getRepo(ref: RepoRef): Promise<RepoInfo | null> {
    return this.call('getRepo', [ref], () => {
      const r = this.repos.get(this.key(ref));
      if (!r) return null;
      const { labels: _l, variables: _v, protection: _p, prs: _pr, ...info } = r;
      return info;
    });
  }

  createRepo(ref: Parameters<GitHubAdapter['createRepo']>[0]): Promise<RepoInfo> {
    return this.call('createRepo', [ref], async () => {
      if (this.repos.has(this.key(ref)))
        throw new PolicyError(`422 ${ref.owner}/${ref.name} already exists`, {
          code: 'name_taken',
        });
      const dir = this.bare(ref);
      mkdirSync(dir, { recursive: true });
      const r = await this.exec.run('git', ['init', '-q', '--bare', '-b', 'main', dir], {
        timeoutMs: 60_000,
      });
      if (r.code !== 0) throw new ToolError(`fake: git init --bare failed: ${r.stderr}`);
      const info: RepoInfo = {
        owner: ref.owner,
        name: ref.name,
        private: ref.visibility !== 'public',
        visibility: ref.visibility,
        description: ref.description,
        defaultBranch: 'main',
        htmlUrl: `https://github.com/${ref.owner}/${ref.name}`,
      };
      this.repos.set(this.key(ref), {
        ...info,
        labels: [],
        variables: {},
        protection: {},
        prs: [],
      });
      return info;
    });
  }

  getBranchSha(ref: RepoRef, branch: string): Promise<string | null> {
    return this.call('getBranchSha', [ref, branch], async () => {
      this.repo(ref);
      const r = await this.exec.run(
        'git',
        ['--git-dir', this.bare(ref), 'rev-parse', '--verify', '-q', `refs/heads/${branch}`],
        { timeoutMs: 60_000 },
      );
      return r.code === 0 ? r.stdout.trim() : null;
    });
  }

  createBranch(ref: RepoRef, branch: string, sha: string): Promise<void> {
    return this.call('createBranch', [ref, branch, sha], async () => {
      this.repo(ref);
      const r = await this.exec.run(
        'git',
        ['--git-dir', this.bare(ref), 'update-ref', `refs/heads/${branch}`, sha, ''],
        { timeoutMs: 60_000 },
      );
      if (r.code !== 0) throw new ToolError(`422 cannot create ${branch}: ${r.stderr.trim()}`);
    });
  }

  setBranchProtection(ref: RepoRef, branch: string, rules: BranchProtection): Promise<void> {
    return this.call('setBranchProtection', [ref, branch, rules], () => {
      const r = this.repo(ref);
      if (this.opts.protectionUnsupported)
        throw new PolicyError(
          '403 Upgrade to GitHub Pro or make this repository public to enable this feature.',
          { code: 'protection_unavailable' },
        );
      r.protection[branch] = structuredClone(rules);
    });
  }

  ensureLabels(ref: RepoRef, labels: readonly Label[]): Promise<string[]> {
    return this.call('ensureLabels', [ref, labels], () => {
      const r = this.repo(ref);
      const created: string[] = [];
      for (const l of labels) {
        if (r.labels.some((x) => x.name.toLowerCase() === l.name.toLowerCase())) continue;
        r.labels.push({ ...l });
        created.push(l.name);
      }
      return created;
    });
  }

  ensureVariables(ref: RepoRef, vars: Readonly<Record<string, string>>): Promise<string[]> {
    return this.call('ensureVariables', [ref, vars], () => {
      const r = this.repo(ref);
      const created: string[] = [];
      for (const [k, v] of Object.entries(vars)) {
        if (k in r.variables) continue;
        r.variables[k] = v;
        created.push(k);
      }
      return created;
    });
  }

  openPr(
    ref: RepoRef,
    pr: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }> {
    return this.call('openPr', [ref, pr], () => {
      const r = this.repo(ref);
      // why: GitHub answers 422 for a second PR on the same head, and the real adapter then returns
      // the open one; the fake must do the same or a resume test could never notice a duplicate.
      const open = r.prs.find((x) => x.head === pr.head);
      if (open) return { number: open.number, url: `${r.htmlUrl}/pull/${open.number}` };
      const number = r.prs.length + 1;
      r.prs.push({ number, ...pr });
      return { number, url: `${r.htmlUrl}/pull/${number}` };
    });
  }
}
