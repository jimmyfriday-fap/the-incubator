import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGitOps } from '@incubator/git';
import { nodeExec } from '@incubator/runtime';
import { inspectFolder, remoteHost } from './folders.js';

const git = createGitOps(nodeExec);
const ident = { identity: { name: 'T', email: 't@example.invalid' } };
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'folders test '));

async function repo(opts: { origin?: string; commit?: boolean; manifest?: boolean } = {}) {
  const dir = path.join(tmp(), 'my repo');
  mkdirSync(dir);
  await git.init(dir, 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'x\n');
  // A library manifest, so the repository has a stack pack unless a test says otherwise.
  if (opts.manifest !== false)
    writeFileSync(path.join(dir, 'package.json'), '{ "name": "my-repo", "main": "index.js" }\n');
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
    expect(none.warnings.join(' ')).toContain('This is a git repository.');
    expect(none.warnings.join(' ')).toContain('no origin remote');
    const other = await inspectFolder(
      git,
      await repo({ origin: 'https://gitlab.com/o/r.git' }),
      'existing',
    );
    expect(other.ok).toBe(true);
    expect(other.warnings.join(' ')).toContain('This is a git repository.');
    expect(other.warnings.join(' ')).toContain('Its origin points to gitlab.com, not GitHub.');
    expect(other.git?.suggested).toBeNull();
  });

  it('suggests the one GitHub remote that is not origin', async () => {
    const dir = await repo({ origin: 'https://gitlab.com/o/r.git' });
    await git.remoteAdd(dir, 'github', 'https://github.com/octo/app.git');
    const v = await inspectFolder(git, dir, 'existing');
    expect(v.ok).toBe(true);
    expect(v.git?.origin).toBeNull();
    expect(v.git?.suggested).toEqual({ remote: 'github', ref: { owner: 'octo', name: 'app' } });
    expect(v.warnings.join(' ')).toContain(
      'The remote "github" points to GitHub (octo/app), which is suggested',
    );
  });

  it('suggests nothing when several remotes point to GitHub, and lists them', async () => {
    const dir = await repo({ origin: 'https://gitlab.com/o/r.git' });
    await git.remoteAdd(dir, 'one', 'https://github.com/octo/one.git');
    await git.remoteAdd(dir, 'two', 'git@github.com:octo/two.git');
    const v = await inspectFolder(git, dir, 'existing');
    expect(v.git?.suggested).toBeNull();
    expect(v.warnings.join(' ')).toContain('Several remotes point to GitHub (octo/one, octo/two)');
  });

  it('keeps a GitHub origin as the target and does not suggest anything', async () => {
    const dir = await repo({ origin: 'https://github.com/octo/app.git' });
    await git.remoteAdd(dir, 'mirror', 'https://github.com/octo/mirror.git');
    const v = await inspectFolder(git, dir, 'existing');
    expect(v.git?.origin).toEqual({ owner: 'octo', name: 'app' });
    expect(v.git?.suggested).toBeNull();
    expect(v.warnings).toEqual([]);
  });

  it('never puts a credential from a remote URL into a warning', async () => {
    const dir = await repo({ origin: 'https://user:s3cret-token@gitlab.com/o/r.git' });
    const v = await inspectFolder(git, dir, 'existing');
    const text = v.warnings.join(' ');
    expect(text).toContain('gitlab.com');
    expect(text).not.toContain('s3cret-token');
    expect(text).not.toContain('user:');
  });
});

describe('inspectFolder: the stack pack', () => {
  it('says a supported repository has a pack', async () => {
    const v = await inspectFolder(
      git,
      await repo({ origin: 'https://github.com/octo/app.git' }),
      'existing',
    );
    expect(v.stack).toEqual({ supported: true, label: 'node-lib' });
    expect(v.warnings).toEqual([]);
  });

  it('warns, without blocking, when no pack fits, and names the ecosystem', async () => {
    const dir = await repo({ origin: 'https://github.com/octo/app.git', manifest: false });
    const none = await inspectFolder(git, dir, 'existing');
    expect(none.ok).toBe(true);
    expect(none.stack).toEqual({ supported: false, label: 'unrecognised stack' });
    expect(none.warnings).toEqual([
      'No Incubator stack pack fits this repository. It can be updated, but the canonical-pattern files are not available for it.',
    ]);
    const flutter = path.join(tmp(), 'flutter app');
    mkdirSync(flutter);
    await git.init(flutter, 'main');
    writeFileSync(path.join(flutter, 'pubspec.yaml'), 'name: app\n');
    await git.addAll(flutter);
    await git.commit(flutter, 'chore: one', ident);
    await git.remoteAdd(flutter, 'origin', 'https://github.com/octo/app.git');
    const v = await inspectFolder(git, flutter, 'existing');
    expect(v.ok).toBe(true);
    expect(v.stack).toEqual({ supported: false, label: 'Dart/Flutter' });
    expect(v.warnings.join(' ')).toContain(
      'This is a Dart/Flutter repository, which has no Incubator stack pack.',
    );
    expect((await inspectFolder(git, path.join(tmp(), 'new one'), 'new')).stack).toBeNull();
  });
});

describe('remoteHost', () => {
  it('reads only the host from https, ssh and scp-style URLs', () => {
    expect(remoteHost('https://user:tok@gitlab.com/o/r.git')).toBe('gitlab.com');
    expect(remoteHost('ssh://git@bitbucket.org/o/r.git')).toBe('bitbucket.org');
    expect(remoteHost('git@gitlab.example.com:o/r.git')).toBe('gitlab.example.com');
    expect(remoteHost('not a url')).toBeNull();
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
