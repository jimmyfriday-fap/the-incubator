// seedExistingRepo runs a plain `git init` in a scratch directory. Inside the pre-push hook git exports
// GIT_DIR, and an unguarded child then re-initialises the hooked repository instead (see
// packages/git/src/hook-env.test.ts). Scratch repositories only; never a real .git.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGitHub } from '@incubator/git';
import { nodeExec } from '@incubator/runtime';
import { seedExistingRepo } from './testing.js';

const HOOK_VARS = ['GIT_DIR', 'GIT_COMMON_DIR'];
const saved = Object.fromEntries(HOOK_VARS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of HOOK_VARS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await nodeExec.run(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
    { cwd, timeoutMs: 30_000 },
  );
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

describe('seedExistingRepo inside a git hook', () => {
  it('leaves the hooked worktree and its shared config alone', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'seed-hook-'));
    const main = path.join(root, 'main');
    const wt = path.join(root, 'wt');
    mkdirSync(main);
    await git(main, 'init', '-q', '-b', 'main');
    await git(main, 'commit', '-q', '--allow-empty', '-m', 'base');
    await git(main, 'worktree', 'add', '-q', wt, '-b', 'wt-branch');
    const config = path.join(main, '.git', 'config');
    const configBefore = readFileSync(config, 'utf8');
    const headBefore = await git(wt, 'rev-parse', 'HEAD');
    process.env['GIT_DIR'] = await git(wt, 'rev-parse', '--absolute-git-dir');
    process.env['GIT_COMMON_DIR'] = path.join(main, '.git');

    const github = new FakeGitHub(nodeExec);
    const { dir } = await seedExistingRepo(github, 'app', (d) => {
      mkdirSync(d, { recursive: true });
      writeFileSync(path.join(d, 'a.txt'), 'one\n');
      return Promise.resolve();
    });

    expect(readFileSync(config, 'utf8')).toBe(configBefore);
    delete process.env['GIT_DIR'];
    delete process.env['GIT_COMMON_DIR'];
    expect(await git(wt, 'rev-parse', 'HEAD')).toBe(headBefore);
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
    expect(await git(dir, 'log', '--format=%s')).toBe('existing');
  });
});
