import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGitOps } from '@incubator/git';
import { nodeExec } from '@incubator/runtime';
import { inspectFolder } from './folders.js';

const git = createGitOps(nodeExec);
const ident = { identity: { name: 'T', email: 't@example.invalid' } };
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'folders test '));

async function repo(opts: { origin?: string; commit?: boolean } = {}) {
  const dir = path.join(tmp(), 'my repo');
  mkdirSync(dir);
  await git.init(dir, 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  if (opts.commit !== false) {
    await git.addAll(dir);
    await git.commit(dir, 'chore: one', ident);
  }
  if (opts.origin) await git.remoteAdd(dir, 'origin', opts.origin);
  return dir;
}

describe('inspectFolder: a new solution', () => {
  it('accepts a missing folder under an existing parent, and an empty folder', async () => {
    const parent = tmp();
    const missing = await inspectFolder(git, path.join(parent, 'brand new'), 'new');
    expect(missing).toMatchObject({ ok: true, exists: false, problems: [] });
    const empty = path.join(parent, 'empty one');
    mkdirSync(empty);
    expect(await inspectFolder(git, empty, 'new')).toMatchObject({
      ok: true,
      exists: true,
      empty: true,
    });
  });

  it('refuses a non-empty folder, a file, a missing parent and anything that is not a full path', async () => {
    const parent = tmp();
    writeFileSync(path.join(parent, 'keep.txt'), 'mine\n');
    const full = await inspectFolder(git, parent, 'new');
    expect(full).toMatchObject({ ok: false, empty: false });
    expect(full.problems.join(' ')).toContain('not empty');
    expect(
      (await inspectFolder(git, path.join(parent, 'keep.txt'), 'new')).problems.join(' '),
    ).toContain('is a file');
    expect(
      (await inspectFolder(git, path.join(parent, 'no', 'such', 'dir'), 'new')).problems.join(' '),
    ).toContain('parent folder does not exist');
    for (const bad of ['', '   ', 'relative/path', './x', 'a\0b'])
      expect((await inspectFolder(git, bad, 'new')).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe('inspectFolder: an existing solution', () => {
  it('reads the branch, head and GitHub origin of a clean repository', async () => {
    const dir = await repo({ origin: 'https://github.com/octo/my-repo.git' });
    const v = await inspectFolder(git, dir, 'existing');
    expect(v).toMatchObject({ ok: true, problems: [], warnings: [] });
    expect(v.git).toMatchObject({
      branch: 'main',
      clean: true,
      changed: [],
      origin: { owner: 'octo', name: 'my-repo' },
    });
    expect(v.git!.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('refuses uncommitted changes (naming them), a folder that is not a repository, and a repo with no commits', async () => {
    const dir = await repo({ origin: 'https://github.com/octo/r.git' });
    writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
    writeFileSync(path.join(dir, 'new file.txt'), 'n\n');
    const dirty = await inspectFolder(git, dir, 'existing');
    expect(dirty.ok).toBe(false);
    expect(dirty.problems.join(' ')).toContain('2 uncommitted changes');
    expect(dirty.git!.changed.sort()).toEqual(['a.txt', 'new file.txt']);

    expect((await inspectFolder(git, tmp(), 'existing')).problems.join(' ')).toContain(
      'not a git repository',
    );
    expect(
      (await inspectFolder(git, path.join(tmp(), 'gone'), 'existing')).problems.join(' '),
    ).toContain('does not exist');
    const unborn = await repo({ commit: false });
    expect((await inspectFolder(git, unborn, 'existing')).problems.join(' ')).toContain(
      'no commits yet',
    );
  });

  it('warns, without blocking, when there is no GitHub origin', async () => {
    const none = await inspectFolder(git, await repo(), 'existing');
    expect(none.ok).toBe(true);
    expect(none.warnings.join(' ')).toContain('no origin remote');
    const other = await inspectFolder(
      git,
      await repo({ origin: 'https://gitlab.com/o/r.git' }),
      'existing',
    );
    expect(other.ok).toBe(true);
    expect(other.warnings.join(' ')).toContain('not a GitHub repository');
  });

  it('refuses a detached HEAD', async () => {
    const dir = await repo();
    const sha = (await git.headSha(dir))!;
    await nodeExec.run('git', ['checkout', '-q', '--detach', sha], { cwd: dir, timeoutMs: 10_000 });
    expect((await inspectFolder(git, dir, 'existing')).problems.join(' ')).toContain(
      'detached HEAD',
    );
  });
});
