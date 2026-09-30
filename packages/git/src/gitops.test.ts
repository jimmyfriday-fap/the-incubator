import { mkdtempSync, writeFileSync } from 'node:fs';
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
