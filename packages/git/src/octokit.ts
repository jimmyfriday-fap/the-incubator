import { Octokit } from '@octokit/rest';
import { retry } from '@octokit/plugin-retry';
import { throttling } from '@octokit/plugin-throttling';
import { PolicyError, ToolError, type SecretString } from '@incubator/runtime';
import type {
  BranchProtection,
  GitHubAdapter,
  Label,
  RepoInfo,
  RepoRef,
  TokenInfo,
} from './github.js';

const Kit = Octokit.plugin(retry, throttling);

interface HttpError {
  status?: number;
  message?: string;
}

const status = (e: unknown): number | undefined => (e as HttpError | null)?.status;

/** Maps an Octokit error to the exit-code contract; the message never carries request headers. */
function fail(what: string, e: unknown): never {
  const s = status(e);
  const msg = `${what}: ${s ? `HTTP ${s} ` : ''}${(e as HttpError | null)?.message ?? String(e)}`;
  if (s === 401 || s === 403 || s === 404 || s === 422)
    throw new PolicyError(msg, { code: `github_${s}` });
  throw new ToolError(msg, { code: 'github_error' });
}

async function orNull<T>(what: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (status(e) === 404) return null;
    return fail(what, e);
  }
}

export interface OctokitOptions {
  baseUrl?: string;
  userAgent?: string;
  /** Test seam: Octokit's fetch implementation. */
  fetch?: typeof fetch;
  retries?: number;
}

/** Live GitHub through @octokit/rest with retry and throttling plugins (TDD §4.4). */
export class OctokitGitHub implements GitHubAdapter {
  private readonly kit: InstanceType<typeof Kit>;

  constructor(
    private readonly token: SecretString,
    opts: OctokitOptions = {},
  ) {
    this.kit = new Kit({
      auth: token.reveal(),
      userAgent: opts.userAgent ?? 'the-incubator',
      ...(opts.baseUrl ? { baseUrl: opts.baseUrl } : {}),
      request: { ...(opts.fetch ? { fetch: opts.fetch } : {}) },
      // why: Octokit logs to the console by default; our logger and error mapping own the output.
      log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      retry: {
        enabled: opts.retries !== 0,
        retries: opts.retries ?? 2,
        doNotRetry: [400, 401, 403, 404, 422],
      },
      throttle: {
        enabled: opts.retries !== 0,
        onRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) =>
          retryCount < 2,
        onSecondaryRateLimit: (_after: number, _o: unknown, _k: unknown, retryCount: number) =>
          retryCount < 1,
      },
    });
  }

  remoteUrl(ref: RepoRef): string {
    return `https://github.com/${ref.owner}/${ref.name}.git`;
  }

  async tokenInfo(): Promise<TokenInfo> {
    try {
      const res = await this.kit.request('GET /user');
      const scopes = res.headers['x-oauth-scopes'];
      const fine = this.token.reveal().startsWith('github_pat_');
      return {
        login: res.data.login,
        kind: fine ? 'fine-grained' : scopes !== undefined ? 'classic' : 'unknown',
        scopes:
          typeof scopes === 'string'
            ? scopes
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      };
    } catch (e) {
      return fail('token check', e);
    }
  }

  async getRepo(ref: RepoRef): Promise<RepoInfo | null> {
    const res = await orNull(
      'get repository',
      this.kit.rest.repos.get({ owner: ref.owner, repo: ref.name }),
    );
    if (!res) return null;
    const d = res.data;
    return {
      owner: d.owner.login,
      name: d.name,
      private: d.private,
      visibility:
        (d.visibility as RepoInfo['visibility'] | undefined) ?? (d.private ? 'private' : 'public'),
      description: d.description ?? '',
      defaultBranch: d.default_branch,
      htmlUrl: d.html_url,
    };
  }

  async createRepo(
    ref: RepoRef & {
      ownerType: 'user' | 'org';
      visibility: RepoInfo['visibility'];
      description: string;
    },
  ): Promise<RepoInfo> {
    const common = {
      name: ref.name,
      description: ref.description,
      private: ref.visibility !== 'public',
      auto_init: false,
      has_wiki: false,
    };
    try {
      if (ref.ownerType === 'org')
        await this.kit.rest.repos.createInOrg({
          org: ref.owner,
          ...common,
          // why: the REST API accepts "internal" for enterprise orgs; the generated types omit it.
          visibility: ref.visibility as 'private' | 'public',
        });
      else await this.kit.rest.repos.createForAuthenticatedUser(common);
    } catch (e) {
      if (status(e) === 422)
        throw new PolicyError(`${ref.owner}/${ref.name} already exists or the name is invalid`, {
          code: 'name_taken',
        });
      return fail('create repository', e);
    }
    const info = await this.getRepo(ref);
    if (!info) throw new ToolError(`created ${ref.owner}/${ref.name} but cannot read it back`);
    return info;
  }

  async getBranchSha(ref: RepoRef, branch: string): Promise<string | null> {
    const res = await orNull(
      'get branch',
      this.kit.rest.repos.getBranch({ owner: ref.owner, repo: ref.name, branch }),
    );
    return res?.data.commit.sha ?? null;
  }

  async createBranch(ref: RepoRef, branch: string, sha: string): Promise<void> {
    try {
      await this.kit.rest.git.createRef({
        owner: ref.owner,
        repo: ref.name,
        ref: `refs/heads/${branch}`,
        sha,
      });
    } catch (e) {
      if (status(e) === 422 && (await this.getBranchSha(ref, branch)) === sha) return;
      fail(`create branch ${branch}`, e);
    }
  }

  async setBranchProtection(ref: RepoRef, branch: string, rules: BranchProtection): Promise<void> {
    try {
      await this.kit.rest.repos.updateBranchProtection({
        owner: ref.owner,
        repo: ref.name,
        branch,
        required_status_checks: { strict: true, contexts: rules.requiredChecks },
        enforce_admins: false,
        required_pull_request_reviews: rules.requirePr
          ? { required_approving_review_count: rules.requiredApprovals }
          : null,
        restrictions: null,
        allow_force_pushes: false,
        allow_deletions: false,
      });
    } catch (e) {
      if (status(e) === 403)
        throw new PolicyError(
          `branch protection on ${branch} is unavailable for this repository or plan`,
          {
            code: 'protection_unavailable',
          },
        );
      fail(`protect ${branch}`, e);
    }
  }

  async ensureLabels(ref: RepoRef, labels: readonly Label[]): Promise<string[]> {
    let have: { name: string }[];
    try {
      have = await this.kit.paginate(this.kit.rest.issues.listLabelsForRepo, {
        owner: ref.owner,
        repo: ref.name,
        per_page: 100,
      });
    } catch (e) {
      return fail('list labels', e);
    }
    const names = new Set(have.map((l) => l.name.toLowerCase()));
    const created: string[] = [];
    for (const l of labels) {
      if (names.has(l.name.toLowerCase())) continue;
      try {
        await this.kit.rest.issues.createLabel({ owner: ref.owner, repo: ref.name, ...l });
        created.push(l.name);
      } catch (e) {
        if (status(e) !== 422) fail(`create label ${l.name}`, e);
      }
    }
    return created;
  }

  async ensureVariables(ref: RepoRef, vars: Readonly<Record<string, string>>): Promise<string[]> {
    const created: string[] = [];
    for (const [name, value] of Object.entries(vars)) {
      const have = await orNull(
        'get variable',
        this.kit.rest.actions.getRepoVariable({ owner: ref.owner, repo: ref.name, name }),
      );
      if (have) continue;
      try {
        await this.kit.rest.actions.createRepoVariable({
          owner: ref.owner,
          repo: ref.name,
          name,
          value,
        });
        created.push(name);
      } catch (e) {
        if (status(e) !== 409) fail(`create variable ${name}`, e);
      }
    }
    return created;
  }

  async openPr(
    ref: RepoRef,
    pr: { head: string; base: string; title: string; body: string },
  ): Promise<{ number: number; url: string }> {
    try {
      const res = await this.kit.rest.pulls.create({ owner: ref.owner, repo: ref.name, ...pr });
      return { number: res.data.number, url: res.data.html_url };
    } catch (e) {
      if (status(e) === 422) {
        const open = await this.kit.rest.pulls.list({
          owner: ref.owner,
          repo: ref.name,
          head: `${ref.owner}:${pr.head}`,
          state: 'open',
        });
        const hit = open.data[0];
        if (hit) return { number: hit.number, url: hit.html_url };
      }
      return fail('open pull request', e);
    }
  }
}
