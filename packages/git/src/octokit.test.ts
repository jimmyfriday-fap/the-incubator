import { describe, expect, it } from 'vitest';
import { PolicyError, SecretString, ToolError } from '@incubator/runtime';
import { OctokitGitHub } from './octokit.js';

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
type Route = (body: unknown, url: URL) => Reply;

/** A routed stand-in for fetch: `METHOD /path` → reply. Records every request. */
function api(routes: Record<string, Route | Reply>) {
  const seen: { key: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const headers = new Headers(init?.headers);
    seen.push({ key, body, auth: headers.get('authorization') });
    const r = routes[key];
    const reply: Reply =
      typeof r === 'function'
        ? r(body, url)
        : (r ?? { status: 404, body: { message: 'Not Found' } });
    return Promise.resolve(
      new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status: reply.status,
        headers: { 'content-type': 'application/json', ...(reply.headers ?? {}) },
      }),
    );
  };
  return { seen, fetch: fetchImpl };
}

const repoBody = {
  name: 'app',
  owner: { login: 'octo' },
  private: true,
  visibility: 'private',
  description: 'd',
  default_branch: 'main',
  html_url: 'https://github.com/octo/app',
};
const ref = { owner: 'octo', name: 'app' };
const make = (routes: Record<string, Route | Reply>, token = 'ghp_classic_token_1234') => {
  const a = api(routes);
  return {
    gh: new OctokitGitHub(new SecretString(token), { fetch: a.fetch, retries: 0 }),
    seen: a.seen,
  };
};

describe('OctokitGitHub', () => {
  it('reads token kind and scopes', async () => {
    const { gh, seen } = make({
      'GET /user': {
        status: 200,
        body: { login: 'octo' },
        headers: { 'x-oauth-scopes': 'repo, workflow' },
      },
    });
    expect(await gh.tokenInfo()).toEqual({
      login: 'octo',
      kind: 'classic',
      scopes: ['repo', 'workflow'],
    });
    expect(seen[0]!.auth).toBe('token ghp_classic_token_1234');
    const fine = make({ 'GET /user': { status: 200, body: { login: 'octo' } } }, 'github_pat_abc');
    expect((await fine.gh.tokenInfo()).kind).toBe('fine-grained');
    await expect(
      make({ 'GET /user': { status: 401, body: { message: 'Bad credentials' } } }).gh.tokenInfo(),
    ).rejects.toThrow(PolicyError);
  });

  it('gets and creates repositories for users and orgs', async () => {
    let created = false;
    const routes: Record<string, Route | Reply> = {
      'GET /repos/octo/app': () =>
        created ? { status: 200, body: repoBody } : { status: 404, body: { message: 'Not Found' } },
      'POST /user/repos': (b) => {
        created = true;
        expect(b).toMatchObject({ name: 'app', private: true, auto_init: false });
        return { status: 201, body: repoBody };
      },
      'POST /orgs/acme/repos': {
        status: 422,
        body: { message: 'name already exists on this account' },
      },
    };
    const { gh } = make(routes);
    expect(await gh.getRepo(ref)).toBeNull();
    expect(
      await gh.createRepo({ ...ref, ownerType: 'user', visibility: 'private', description: 'd' }),
    ).toMatchObject({ name: 'app', private: true, defaultBranch: 'main' });
    await expect(
      gh.createRepo({
        owner: 'acme',
        name: 'app',
        ownerType: 'org',
        visibility: 'internal',
        description: 'd',
      }),
    ).rejects.toThrow('already exists');
    expect(gh.remoteUrl(ref)).toBe('https://github.com/octo/app.git');
  });

  it('creates branches idempotently and reports unavailable protection as a policy finding', async () => {
    const { gh } = make({
      'GET /repos/octo/app/branches/production': { status: 200, body: { commit: { sha: 'abc' } } },
      'POST /repos/octo/app/git/refs': {
        status: 422,
        body: { message: 'Reference already exists' },
      },
      'PUT /repos/octo/app/branches/main/protection': {
        status: 403,
        body: { message: 'Upgrade to GitHub Pro' },
      },
    });
    await expect(gh.createBranch(ref, 'production', 'abc')).resolves.toBeUndefined();
    await expect(gh.createBranch(ref, 'production', 'def')).rejects.toThrow(PolicyError);
    expect(await gh.getBranchSha(ref, 'production')).toBe('abc');
    await expect(
      gh.setBranchProtection(ref, 'main', {
        requiredChecks: ['gate'],
        requirePr: true,
        requiredApprovals: 1,
        allowForcePush: false,
        allowDeletion: false,
      }),
    ).rejects.toMatchObject({ code: 'protection_unavailable' });
  });

  it('only creates missing labels and variables', async () => {
    const { gh, seen } = make({
      'GET /repos/octo/app/labels': { status: 200, body: [{ name: 'Lane:Security' }] },
      'POST /repos/octo/app/labels': { status: 201, body: {} },
      'GET /repos/octo/app/actions/variables/DEPLOY_ROOT': {
        status: 200,
        body: { name: 'DEPLOY_ROOT', value: 'x' },
      },
      'POST /repos/octo/app/actions/variables': { status: 201, body: {} },
    });
    expect(
      await gh.ensureLabels(ref, [
        { name: 'lane:security', color: 'b60205', description: 's' },
        { name: 'lane:infra', color: '0e8a16', description: 'i' },
      ]),
    ).toEqual(['lane:infra']);
    expect(
      await gh.ensureVariables(ref, {
        DEPLOY_ROOT: '__INCUBATOR_UNSET__',
        STAGING_URL: '__INCUBATOR_UNSET__',
      }),
    ).toEqual(['STAGING_URL']);
    expect(seen.find((s) => s.key === 'POST /repos/octo/app/actions/variables')!.body).toEqual({
      name: 'STAGING_URL',
      value: '__INCUBATOR_UNSET__',
    });
  });

  it('opens a pull request or returns the one already open, and maps server errors to ToolError', async () => {
    const { gh } = make({
      'POST /repos/octo/app/pulls': {
        status: 422,
        body: { message: 'A pull request already exists' },
      },
      'GET /repos/octo/app/pulls': {
        status: 200,
        body: [{ number: 7, html_url: 'https://github.com/octo/app/pull/7' }],
      },
      'GET /repos/octo/boom': { status: 500, body: { message: 'boom' } },
    });
    expect(
      await gh.openPr(ref, { head: 'incubator/adopt', base: 'main', title: 't', body: 'b' }),
    ).toEqual({ number: 7, url: 'https://github.com/octo/app/pull/7' });
    await expect(gh.getRepo({ owner: 'octo', name: 'boom' })).rejects.toThrow(ToolError);
  });
});
