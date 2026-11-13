import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import {
  BACKSHACK_SYSTEM_REPOS,
  findSystemRepos,
  userStoreDirWarning,
} from './backshack-system.js';

describe('finding the Backshack repositories (plan 079 WI-2)', () => {
  function tmp(): string {
    return mkdtempSync(path.join(os.tmpdir(), 'bs-system '));
  }

  async function repo(dir: string, origin: string): Promise<void> {
    mkdirSync(dir, { recursive: true });
    await nodeExec.run('git', ['init', '-q', '-b', 'main'], { cwd: dir, timeoutMs: 30_000 });
    await nodeExec.run('git', ['remote', 'add', 'origin', origin], { cwd: dir, timeoutMs: 30_000 });
  }

  const remoteOf = async (dir: string) => {
    const r = await nodeExec.run('git', ['config', '--get', 'remote.origin.url'], {
      cwd: dir,
      timeoutMs: 30_000,
    });
    return r.code === 0 ? r.stdout.trim() : null;
  };

  it('finds https and ssh remotes, the root itself, and a nested folder', async () => {
    const root = tmp();
    await repo(root, 'https://github.com/o/backshack-workspace.git');
    await repo(path.join(root, 'backshack-bow'), 'git@github.com:o/backshack-bow.git');
    await repo(
      path.join(root, 'backshack-dev', 'app', 'public'),
      'https://github.com/o/backshack.cloud',
    );

    const rows = await findSystemRepos(root, BACKSHACK_SYSTEM_REPOS, { remoteOf });
    const wsRow = rows.find((r) => r.repo === 'backshack-workspace')!;
    const bowRow = rows.find((r) => r.repo === 'backshack-bow')!;
    const cloudRow = rows.find((r) => r.repo === 'backshack.cloud')!;

    expect(wsRow.state).toBe('found');
    expect(wsRow.dir).toBe(root);
    expect(bowRow.state).toBe('found');
    expect(bowRow.dir).toBe(path.join(root, 'backshack-bow'));
    expect(cloudRow.state).toBe('found');
    expect(cloudRow.dir).toBe(path.join(root, 'backshack-dev', 'app', 'public'));

    const otherRows = rows.filter(
      (r) => !['backshack-workspace', 'backshack-bow', 'backshack.cloud'].includes(r.repo),
    );
    for (const r of otherRows) {
      expect(r.state).toBe('not-found');
      expect(r.dir).toBe(null);
    }
  });

  it('skips linked worktrees and node_modules and dot-folders', async () => {
    const root = tmp();
    const wtDir = path.join(root, '_wt', 'bow2');
    mkdirSync(wtDir, { recursive: true });
    writeFileSync(path.join(wtDir, '.git'), 'gitdir: elsewhere');
    await repo(path.join(root, 'node_modules', 'x'), 'https://github.com/o/backshack-generator');
    await repo(path.join(root, '.hidden', 'y'), 'https://github.com/o/backshack-generator');

    const rows = await findSystemRepos(root, BACKSHACK_SYSTEM_REPOS, { remoteOf });
    const genRow = rows.find((r) => r.repo === 'backshack-generator')!;
    expect(genRow.state).toBe('not-found');
    expect(genRow.dir).toBe(null);
  });

  it('prefers the store copy, then the hint folder, else reports ambiguous', async () => {
    const root = tmp();
    await repo(
      path.join(root, 'backshack-dev', 'app', 'public'),
      'https://github.com/o/backshack.cloud',
    );
    await repo(path.join(root, 'backshack-prod'), 'https://github.com/o/backshack.cloud');

    const rowsWithStore = await findSystemRepos(root, BACKSHACK_SYSTEM_REPOS, {
      storeMembers: [path.join(root, 'backshack-prod')],
      remoteOf,
    });
    const cloudRowWithStore = rowsWithStore.find((r) => r.repo === 'backshack.cloud')!;
    expect(cloudRowWithStore.state).toBe('found');
    expect(cloudRowWithStore.dir).toBe(path.join(root, 'backshack-prod'));

    const rowsWithHint = await findSystemRepos(root, BACKSHACK_SYSTEM_REPOS, {
      storeMembers: [],
      remoteOf,
    });
    const cloudRowWithHint = rowsWithHint.find((r) => r.repo === 'backshack.cloud')!;
    expect(cloudRowWithHint.state).toBe('found');
    expect(cloudRowWithHint.dir).toBe(path.join(root, 'backshack-dev', 'app', 'public'));

    const rootAmbig = tmp();
    await repo(path.join(rootAmbig, 'other-copy'), 'https://github.com/o/backshack.cloud');
    await repo(path.join(rootAmbig, 'backshack-prod'), 'https://github.com/o/backshack.cloud');

    const rowsAmbiguous = await findSystemRepos(rootAmbig, BACKSHACK_SYSTEM_REPOS, {
      storeMembers: [],
      remoteOf,
    });
    const cloudRowAmbiguous = rowsAmbiguous.find((r) => r.repo === 'backshack.cloud')!;
    expect(cloudRowAmbiguous.state).toBe('ambiguous');
    expect(cloudRowAmbiguous.dir).toBe(null);
    expect(cloudRowAmbiguous.candidates.length).toBe(2);
  });

  it('does not descend into a repository that is not the root', async () => {
    const root = tmp();
    await repo(path.join(root, 'outer'), 'https://github.com/o/something');
    await repo(path.join(root, 'outer', 'backshack-bow'), 'https://github.com/o/backshack-bow');

    const rows = await findSystemRepos(root, BACKSHACK_SYSTEM_REPOS, { remoteOf });
    const bowRow = rows.find((r) => r.repo === 'backshack-bow')!;
    expect(bowRow.state).toBe('not-found');
    expect(bowRow.dir).toBe(null);
  });

  it('warns while the user-level settings set MEMORY_STORE_DIR', () => {
    const tmp1 = mkdtempSync(path.join(os.tmpdir(), 'warn test '));
    const file1 = path.join(tmp1, 'settings.json');
    writeFileSync(file1, '{"env":{"MEMORY_STORE_DIR":"C:/x"}}');
    const warn = userStoreDirWarning(file1);
    expect(warn).toContain('MEMORY_STORE_DIR');

    const tmp2 = mkdtempSync(path.join(os.tmpdir(), 'warn test '));
    const file2 = path.join(tmp2, 'settings.json');
    writeFileSync(file2, '{}');
    expect(userStoreDirWarning(file2)).toBe(null);

    expect(userStoreDirWarning(path.join(tmp2, 'nonexistent.json'))).toBe(null);
  });
});
