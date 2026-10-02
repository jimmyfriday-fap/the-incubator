import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretString, nodeExec } from '@incubator/runtime';
import { FakeGitHub } from './github.js';
import { createGitOps, tokenEnv } from './gitops.js';

const git = createGitOps(nodeExec);
const ident = {
  identity: { name: 'Incubator Test', email: 'test@example.invalid' },
  date: '2026-01-01T00:00:00Z',
};
const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

describe('GitOps', () => {
  async function repo(files: Record<string, string> = { 'a.txt': 'one\n' }) {
    const dir = tmp('gitops-repo-');
    await git.init(dir, 'main');
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      writeFileSync(path.join(dir, rel), body);
    }
    await git.addAll(dir);
    await git.commit(dir, 'chore: one', ident);
    return dir;
  }

  it('lists changes: modified, untracked (spaces included), renamed; ignored files stay out', async () => {
    const dir = await repo({
      'a.txt': 'one\n',
      'old name.txt': 'x\n',
      '.gitignore': 'secret.env\n',
    });
    expect(await git.status(dir)).toEqual([]);
    writeFileSync(path.join(dir, 'a.txt'), 'two\n');
    writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
    mkdirSync(path.join(dir, 'sub dir'));
    writeFileSync(path.join(dir, 'sub dir', 'b.txt'), 'b\n');
    writeFileSync(path.join(dir, 'secret.env'), 'TOKEN=1\n');
    renameSync(path.join(dir, 'old name.txt'), path.join(dir, 'renamed.txt'));
    await nodeExec.run('git', ['add', '-A', 'renamed.txt', 'old name.txt'], {
      cwd: dir,
      timeoutMs: 10_000,
    });
    const got = new Map((await git.status(dir)).map((e) => [e.path, e.code]));
    expect(got.get('a.txt')).toBe(' M');
    expect(got.get('new file.txt')).toBe('??');
    expect(got.get('sub dir/b.txt')).toBe('??');
    expect(got.get('renamed.txt')).toBe('R ');
    expect(got.has('old name.txt')).toBe(false);
    expect(got.has('secret.env')).toBe(false);
  });

  it('fetches a branch from another local repository, checks it out, and leaves the current branch alone', async () => {
    const owner = await repo();
    const clone = tmp('gitops-clone-');
    await git.clone(owner, path.join(clone, 'c'));
    const c = path.join(clone, 'c');
    await git.checkoutNewBranch(c, 'incubator/enhance-1');
    writeFileSync(path.join(c, 'plan.md'), 'plan\n');
    await git.addAll(c);
    const sha = await git.commit(c, 'feat: plan', ident);
    const before = await git.headSha(owner);
    await git.fetch(owner, c, 'refs/heads/incubator/enhance-1:refs/heads/incubator/enhance-1');
    expect(await git.currentBranch(owner)).toBe('main');
    expect(await git.headSha(owner)).toBe(before);
    await git.checkout(owner, 'incubator/enhance-1');
    expect(await git.currentBranch(owner)).toBe('incubator/enhance-1');
    expect(await git.headSha(owner)).toBe(sha);
    await expect(git.checkout(owner, 'no-such-branch')).rejects.toThrow('git checkout failed');
  });

  it('lists every remote with its URL, and nothing when there are none', async () => {
    const dir = tmp('gitops-remotes-');
    await git.init(dir, 'main');
    expect(await git.remotes(dir)).toEqual([]);
    await git.remoteAdd(dir, 'origin', 'https://gitlab.com/o/r.git');
    await git.remoteAdd(dir, 'github', 'https://github.com/octo/r.git');
    const all = await git.remotes(dir);
    expect(all.map((r) => r.name).sort()).toEqual(['github', 'origin']);
    expect(all.find((r) => r.name === 'github')?.url).toBe('https://github.com/octo/r.git');
    expect(await git.remotes(tmp('gitops-notrepo-'))).toEqual([]);
  });

  it('adds a remote once, accepts the same URL again, and refuses a different one', async () => {
    const dir = await repo();
    expect(await git.remoteGetUrl(dir)).toBeNull();
    await git.remoteAdd(dir, 'origin', 'https://github.com/octo/app.git');
    await git.remoteAdd(dir, 'origin', 'https://github.com/octo/app.git');
    expect(await git.remoteGetUrl(dir)).toBe('https://github.com/octo/app.git');
    await expect(git.remoteAdd(dir, 'origin', 'https://github.com/octo/other.git')).rejects.toThrow(
      'already points at',
    );
  });

  it('reads the configured identity, and commits as it when none is passed', async () => {
    const dir = await repo();
    const set = (k: string, v: string) =>
      nodeExec.run('git', ['config', k, v], { cwd: dir, timeoutMs: 10_000 });
    await nodeExec.run('git', ['config', '--unset-all', 'user.name'], {
      cwd: dir,
      timeoutMs: 10_000,
    });
    const none = await git.identity(dir);
    // A machine-wide identity may exist; the repository-level one is what this asserts below.
    await set('user.name', 'Owner Person');
    await set('user.email', 'owner@example.invalid');
    expect(await git.identity(dir)).toEqual({
      name: 'Owner Person',
      email: 'owner@example.invalid',
    });
    void none;
    writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    await git.addAll(dir);
    await git.commit(dir, 'feat: mine\n\nIncubator-Run: r9\n', {});
    const who = await nodeExec.run('git', ['log', '-1', '--format=%an <%ae>'], {
      cwd: dir,
      timeoutMs: 10_000,
    });
    expect(who.stdout.trim()).toBe('Owner Person <owner@example.invalid>');
  });

  it('never reads a source that starts with a dash as an option', async () => {
    const root = tmp('gitops-dash-');
    const src = path.join(root, '-weird');
    await git.init(src, 'main').catch(() => undefined);
    mkdirSync(src, { recursive: true });
    await git.init(src, 'main');
    writeFileSync(path.join(src, 'a.txt'), 'x\n');
    await git.addAll(src);
    await git.commit(src, 'chore: x', ident);
    // Run git from `root`, so the relative source "-weird" is exactly what a hostile path looks like.
    const inRoot = createGitOps({
      which: (n) => nodeExec.which(n),
      run: (b, a, o) => nodeExec.run(b, a, { ...o, cwd: root }),
    });
    await inRoot.clone('-weird', 'dest');
    expect(await git.headSha(path.join(root, 'dest'))).toBeTruthy();
  });

  it('reports the checked-out branch, and null when HEAD is unborn or detached', async () => {
    const dir = tmp('gitops-branch-');
    await git.init(dir, 'trunk');
    expect(await git.currentBranch(dir)).toBe('trunk');
    writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    await git.addAll(dir);
    const sha = await git.commit(dir, 'chore: one', ident);
    await git.checkoutNewBranch(dir, 'incubator/adopt-20260501');
    expect(await git.currentBranch(dir)).toBe('incubator/adopt-20260501');
    await nodeExec.run('git', ['checkout', '-q', '--detach', sha], { cwd: dir, timeoutMs: 10_000 });
    expect(await git.currentBranch(dir)).toBeNull();
    expect(await git.currentBranch(tmp('gitops-notgit-'))).toBeNull();
  });

  it('commits deterministically, marks executables and pushes to a bare remote', async () => {
    const gh = new FakeGitHub(nodeExec);
    const ref = { owner: 'octo', name: 'app' };
    await gh.createRepo({ ...ref, ownerType: 'user', visibility: 'private', description: 'x' });
    const make = async () => {
      const dir = tmp('gitops-');
      writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
      writeFileSync(path.join(dir, 'run.sh'), '#!/bin/sh\n');
      await git.init(dir);
      await git.addAll(dir);
      await git.chmodX(dir, ['run.sh']);
      const sha = await git.commit(dir, 'chore: scaffold\n\nIncubator-Run: r1\n', ident);
      return { dir, sha };
    };
    const a = await make();
    const b = await make();
    expect(a.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(b.sha).toBe(a.sha);
    expect(await git.headMessage(a.dir)).toBe('chore: scaffold\n\nIncubator-Run: r1');
    const mode = await nodeExec.run('git', ['ls-files', '-s', 'run.sh'], {
      cwd: a.dir,
      timeoutMs: 10_000,
    });
    expect(mode.stdout.startsWith('100755')).toBe(true);
    expect(await git.remoteSha(gh.remoteUrl(ref), 'refs/heads/main')).toBeNull();
    await git.push(a.dir, gh.remoteUrl(ref), 'HEAD:refs/heads/main');
    expect(await git.remoteSha(gh.remoteUrl(ref), 'refs/heads/main')).toBe(a.sha);
    expect(await gh.getBranchSha(ref, 'main')).toBe(a.sha);
    const clone = path.join(tmp('clone-'), 'c');
    await git.clone(gh.remoteUrl(ref), clone, { depth: 1 });
    expect(await git.headSha(clone)).toBe(a.sha);
    expect(await git.headSha(tmp('empty-'))).toBeNull();
  });

  it('clones with core.autocrlf=false so a user setting cannot rewrite line endings', async () => {
    const src = tmp('gitops-eol-src-');
    writeFileSync(path.join(src, 'a.txt'), 'one\ntwo\n');
    // A repository that marks its files as text: on Windows `core.eol` (native) would still give CRLF.
    writeFileSync(path.join(src, '.gitattributes'), '* text=auto\n');
    await git.init(src);
    await git.addAll(src);
    await git.commit(src, 'chore: eol', ident);
    const dst = path.join(tmp('gitops-eol-dst-'), 'clone');
    await git.clone(src, dst);
    const local = async (key: string) =>
      (
        await nodeExec.run('git', ['config', '--local', key], { cwd: dst, timeoutMs: 10_000 })
      ).stdout.trim();
    expect(await local('core.autocrlf')).toBe('false');
    expect(await local('core.eol')).toBe('lf');
    expect(readFileSync(path.join(dst, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
  });

  it('puts the token in the environment, never in argv, and fails with a ToolError', async () => {
    const env = tokenEnv(new SecretString('ghp_example_token_value'));
    expect(env['GIT_CONFIG_KEY_0']).toBe('http.https://github.com/.extraheader');
    expect(Buffer.from(env['GIT_CONFIG_VALUE_0']!.split(' ').pop()!, 'base64').toString()).toBe(
      'x-access-token:ghp_example_token_value',
    );
    expect(tokenEnv(undefined)).toEqual({});
    await expect(git.push(tmp('nogit-'), 'file:///nonexistent', 'HEAD:main')).rejects.toThrow(
      'git push failed',
    );
  });
});

describe('FakeGitHub', () => {
  it('records calls, keeps ensure* idempotent and injects failures before or after effects', async () => {
    const gh = new FakeGitHub(nodeExec, { protectionUnsupported: true });
    const ref = { owner: 'octo', name: 'svc' };
    expect(await gh.getRepo(ref)).toBeNull();
    gh.failAt = { method: 'createRepo', when: 'after' };
    await expect(
      gh.createRepo({ ...ref, ownerType: 'user', visibility: 'private', description: 'd' }),
    ).rejects.toThrow('injected failure after createRepo');
    expect(await gh.getRepo(ref)).toMatchObject({ name: 'svc', private: true });
    await expect(
      gh.createRepo({ ...ref, ownerType: 'user', visibility: 'private', description: 'd' }),
    ).rejects.toThrow('already exists');
    expect(
      await gh.ensureLabels(ref, [{ name: 'lane:security', color: 'b60205', description: 's' }]),
    ).toEqual(['lane:security']);
    expect(
      await gh.ensureLabels(ref, [{ name: 'LANE:security', color: 'b60205', description: 's' }]),
    ).toEqual([]);
    expect(await gh.ensureVariables(ref, { DEPLOY_ROOT: '__INCUBATOR_UNSET__' })).toEqual([
      'DEPLOY_ROOT',
    ]);
    expect(await gh.ensureVariables(ref, { DEPLOY_ROOT: 'changed' })).toEqual([]);
    expect(gh.repos.get('octo/svc')!.variables).toEqual({ DEPLOY_ROOT: '__INCUBATOR_UNSET__' });
    await expect(
      gh.setBranchProtection(ref, 'main', {
        requiredChecks: ['gate'],
        requirePr: true,
        requiredApprovals: 1,
        allowForcePush: false,
        allowDeletion: false,
      }),
    ).rejects.toThrow('GitHub Pro');
    gh.failAt = { method: 'openPr', when: 'before' };
    await expect(
      gh.openPr(ref, { head: 'a', base: 'main', title: 't', body: 'b' }),
    ).rejects.toThrow('before openPr');
    expect(await gh.openPr(ref, { head: 'a', base: 'main', title: 't', body: 'b' })).toEqual({
      number: 1,
      url: 'https://github.com/octo/svc/pull/1',
    });
    expect(await gh.tokenInfo()).toEqual({
      login: 'octo',
      kind: 'classic',
      scopes: ['repo', 'workflow'],
    });
    await expect(gh.getBranchSha({ owner: 'x', name: 'y' }, 'main')).rejects.toThrow('404');
    expect(gh.calls.map((c) => c.method)).toEqual([
      'getRepo',
      'createRepo',
      'getRepo',
      'createRepo',
      'ensureLabels',
      'ensureLabels',
      'ensureVariables',
      'ensureVariables',
      'setBranchProtection',
      'openPr',
      'openPr',
      'tokenInfo',
      'getBranchSha',
    ]);
  });
});
