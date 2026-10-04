// git exports GIT_DIR and friends to a hook. The pre-push hook runs the unit tests, so every git the
// tests spawn inherits them; without the Exec guard a scratch `git init` rewrote the real repository
// (twice: core.bare = true in the config shared by all worktrees). These tests stand in for that
// hook with scratch repositories. Never point them at a real .git.
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import { FakeGitHub } from './github.js';
import { createGitOps } from './gitops.js';

const HOOK_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'];
const saved = Object.fromEntries(HOOK_VARS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of HOOK_VARS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

async function git(cwd: string, ...args: string[]): Promise<string> {
  const r = await nodeExec.run(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
    { cwd, timeoutMs: 30_000 },
  );
  if (r.code !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A scratch main checkout with a linked worktree, the layout of the incident. */
async function scratchWorktree() {
  const root = tmp('hook-env-');
  const main = path.join(root, 'main');
  const wt = path.join(root, 'wt');
  mkdirSync(main);
  await git(main, 'init', '-q', '-b', 'main');
  await git(main, 'commit', '-q', '--allow-empty', '-m', 'base');
  await git(main, 'worktree', 'add', '-q', wt, '-b', 'wt-branch');
  return {
    main,
    wtGitDir: await git(wt, 'rev-parse', '--absolute-git-dir'),
    mainGitDir: path.join(main, '.git'),
    sharedConfig: () => readFileSync(path.join(main, '.git', 'config'), 'utf8'),
  };
}

describe('git children inside a git hook', () => {
  it('gitops.init in another directory does not re-initialise the hooked worktree', async () => {
    const s = await scratchWorktree();
    const before = s.sharedConfig();
    expect(before).toMatch(/bare = false/);
    process.env['GIT_DIR'] = s.wtGitDir;
    process.env['GIT_COMMON_DIR'] = s.mainGitDir;

    const dir = tmp('hook-env-other-');
    await createGitOps(nodeExec).init(dir, 'main');

    expect(s.sharedConfig()).toBe(before);
    expect(existsSync(path.join(dir, '.git'))).toBe(true);
  });

  // git exports a subset of these to a hook; either subset must leave the hooked repository alone.
  const shapes: Record<
    string,
    (s: { mainGitDir: string; main: string }) => Record<string, string>
  > = {
    'GIT_DIR only': (s) => ({ GIT_DIR: s.mainGitDir }),
    'every repository variable': (s) => ({
      GIT_DIR: s.mainGitDir,
      GIT_WORK_TREE: s.main,
      GIT_INDEX_FILE: path.join(s.mainGitDir, 'index'),
      GIT_COMMON_DIR: s.mainGitDir,
      GIT_PREFIX: '',
    }),
  };

  it.each(Object.keys(shapes))(
    'FakeGitHub.createRepo builds its own bare repository (%s)',
    async (shape) => {
      const s = await scratchWorktree();
      const before = s.sharedConfig();
      Object.assign(process.env, shapes[shape]?.(s));

      const gh = new FakeGitHub(nodeExec);
      const ref = { owner: 'octo', name: 'app' };
      await gh.createRepo({ ...ref, ownerType: 'user', visibility: 'private', description: 'x' });

      expect(s.sharedConfig()).toBe(before);
      const fake = readFileSync(path.join(fileURLToPath(gh.remoteUrl(ref)), 'config'), 'utf8');
      expect(fake).toMatch(/bare = true/);
    },
  );
});
