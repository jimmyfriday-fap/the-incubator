import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitOps } from '@incubator/git';
import { nodeExec } from '@incubator/runtime';
import {
  HOOKS_GITATTRIBUTES,
  MEMBER_SESSION_END_COMMAND,
  STORE_HOOK_LINE,
  installMemorySystemProtected,
  mergeStoreAccess,
  storePreCommitHook,
} from './memory-install.js';

/** Plan 079 WI-1: what the Incubator installs in a store-mode system after the agent stops. */

const SEED = path.resolve(import.meta.dirname, '../../../assets/memory-seed');
const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `${name} `));

describe('installMemorySystemProtected', () => {
  const git = createGitOps(nodeExec);
  const g = (dir: string, ...args: string[]) =>
    nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 }).then((r) => r.stdout.trim());
  const code = (dir: string, ...args: string[]) =>
    nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 }).then((r) => r.code);

  beforeEach(() => {
    // Hermetic git: no machine-wide identity or hooks.
    const cfg = path.join(tmp('system gitcfg'), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function initRepo(dir: string, readme: string) {
    await g(dir, 'init', '-q', '-b', 'main');
    await g(dir, 'config', 'user.name', 'Owner Person');
    await g(dir, 'config', 'user.email', 'owner@example.invalid');
    writeFileSync(path.join(dir, 'README.md'), readme);
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', 'initial');
  }

  /** What the agent leaves behind: a committed store with the seed's scripts, and two committed members linked to it. */
  async function afterSystemAgent(weakHook = false) {
    const workspace = tmp('system ws');
    const store = path.join(workspace, 'shop-memory');
    mkdirSync(store);
    await initRepo(store, '# shop memory\n');
    mkdirSync(path.join(store, 'bin'), { recursive: true });
    mkdirSync(path.join(store, 'hooks'), { recursive: true });
    copyFileSync(path.join(SEED, 'bin', 'memory'), path.join(store, 'bin', 'memory'));
    copyFileSync(
      path.join(SEED, 'bin', 'redact-transcript.mjs'),
      path.join(store, 'bin', 'redact-transcript.mjs'),
    );
    if (weakHook)
      writeFileSync(path.join(store, 'hooks', 'pre-commit'), '#!/usr/bin/env bash\nexit 0\n');
    else
      copyFileSync(path.join(SEED, 'hooks', 'pre-commit'), path.join(store, 'hooks', 'pre-commit'));
    chmodSync(path.join(store, 'bin', 'memory'), 0o755);
    chmodSync(path.join(store, 'hooks', 'pre-commit'), 0o755);
    copyFileSync(path.join(SEED, 'templates', 'gitignore'), path.join(store, '.gitignore'));
    writeFileSync(path.join(store, 'memory.conf'), 'commit_policy=direct\n');
    writeFileSync(
      path.join(store, 'system.yaml'),
      'system: shop\nseed_version: 1.0.1\nstore_repo: shop-memory\nmembers:\n  - repo: api\n    path: ../api\n    role: member\n  - repo: web\n    path: ../web\n    role: member\n',
    );
    const page = (name: string, tier: string) =>
      `---\nname: ${name}\ntier: ${tier}\ndescription: ${name}\nlast_verified: 2026-11-03\n---\n- [2026-11-03] [bootstrap] A fact (src: README.md)\n`;
    mkdirSync(path.join(store, 'context', 'platform'), { recursive: true });
    writeFileSync(
      path.join(store, 'context', 'platform', 'conventions.md'),
      page('conventions', 'platform'),
    );
    for (const name of ['api', 'web']) {
      mkdirSync(path.join(store, 'context', 'projects', name), { recursive: true });
      writeFileSync(
        path.join(store, 'context', 'projects', name, 'failures.md'),
        page('failures', 'project'),
      );
    }
    mkdirSync(path.join(store, 'skills'), { recursive: true });
    writeFileSync(path.join(store, 'skills', '.gitkeep'), '');
    await g(store, '-c', 'alias.mem=!bin/memory index', 'mem');
    await g(store, 'add', '-A');
    await g(store, 'update-index', '--chmod=+x', '--', 'bin/memory', 'hooks/pre-commit');
    await g(store, 'commit', '-q', '-m', 'chore(memory): bootstrap');
    const members: { name: string; dir: string }[] = [];
    for (const name of ['api', 'web']) {
      const dir = path.join(workspace, name);
      mkdirSync(dir);
      await initRepo(dir, `# ${name}\n`);
      writeFileSync(
        path.join(dir, '.memory-link'),
        `system=shop\nrepo=${name}\npath=../shop-memory\nurl=\n`,
      );
      writeFileSync(path.join(dir, 'CLAUDE.md'), 'Memory lives in ../shop-memory.\n');
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '-m', `mem(link): connect ${name}`);
      members.push({ name, dir });
    }
    return { workspace, store, members, seed: SEED };
  }

  const install = (f: Awaited<ReturnType<typeof afterSystemAgent>>) =>
    installMemorySystemProtected({
      exec: nodeExec,
      git,
      seed: f.seed,
      store: f.store,
      members: f.members,
    });

  it('installs each member hook and settings, the store git hook, and passes steps 5 and 6', async () => {
    const f = await afterSystemAgent();
    const r = await install(f);
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    expect(r.checks.map((c) => `${c.step}:${c.status}`)).toEqual([
      'api:files:passed',
      'api:commit:passed',
      'web:files:passed',
      'web:commit:passed',
      'store-hook:passed',
      'E5:passed',
      'E6:api:passed',
      'E6:web:passed',
    ]);
    const storeSlashed = f.store.replace(/\\/g, '/');
    for (const m of f.members) {
      expect(readFileSync(path.join(m.dir, '.claude', 'hooks', '.gitattributes'), 'utf8')).toBe(
        HOOKS_GITATTRIBUTES,
      );
      const settings = JSON.parse(
        readFileSync(path.join(m.dir, '.claude', 'settings.json'), 'utf8'),
      ) as { hooks: { SessionEnd: { hooks: { command: string }[] }[] } };
      expect(settings.hooks.SessionEnd.flatMap((e) => e.hooks.map((h) => h.command))).toEqual([
        MEMBER_SESSION_END_COMMAND,
      ]);
      const local = JSON.parse(
        readFileSync(path.join(m.dir, '.claude', 'settings.local.json'), 'utf8'),
      ) as { env: { MEMORY_STORE_DIR: string }; permissions: { additionalDirectories: string[] } };
      expect(local.env.MEMORY_STORE_DIR).toBe(storeSlashed);
      expect(local.permissions.additionalDirectories).toEqual([storeSlashed]);
      expect(
        (await g(m.dir, 'ls-files', '-s', '.claude/hooks/memory-session-end')).startsWith('100755'),
      ).toBe(true);
      expect(await g(m.dir, 'ls-files', '.claude/settings.local.json')).toBe('');
      expect(await g(m.dir, 'log', '-1', '--format=%s')).toBe(
        'mem(link): install memory hook and settings (Incubator)',
      );
      expect(await g(m.dir, 'status', '--porcelain')).toBe('');
    }
    expect(readFileSync(path.join(f.store, '.git', 'hooks', 'pre-commit'), 'utf8')).toContain(
      STORE_HOOK_LINE,
    );
    expect(await g(f.store, 'status', '--porcelain')).toBe('');
  }, 180_000);

  it('a second run changes nothing', async () => {
    const f = await afterSystemAgent();
    await install(f);
    const heads = await Promise.all(f.members.map((m) => g(m.dir, 'rev-parse', 'HEAD')));
    const again = await install(f);
    expect(again.commit).toBeNull();
    expect(again.checks.filter((c) => c.step.endsWith(':commit')).map((c) => c.status)).toEqual([
      'skipped',
      'skipped',
    ]);
    expect(await Promise.all(f.members.map((m) => g(m.dir, 'rev-parse', 'HEAD')))).toEqual(heads);
    expect(await g(f.store, 'status', '--porcelain')).toBe('');
  }, 180_000);

  it('fails step 5 when the store hook accepts a line that is not dated, and leaves the store clean', async () => {
    const f = await afterSystemAgent(true);
    const before = await g(f.store, 'rev-parse', 'HEAD');
    const r = await install(f);
    expect(r.checks.find((c) => c.step === 'E5')).toMatchObject({ status: 'failed' });
    expect(await g(f.store, 'rev-parse', 'HEAD')).toBe(before);
    expect(await g(f.store, 'status', '--porcelain')).toBe('');
  }, 180_000);

  it('leaves a store hook that lets a well-formed line through (not just one that rejects everything)', async () => {
    const f = await afterSystemAgent();
    await install(f);
    const failures = path.join(f.store, 'context', 'projects', 'api', 'failures.md');
    writeFileSync(
      failures,
      `${readFileSync(failures, 'utf8')}- [2026-11-04] [human] Another fact (src: README.md)\n`,
    );
    await g(f.store, '-c', 'alias.mem=!bin/memory index', 'mem');
    await g(f.store, 'add', '-A');
    expect(
      await code(f.store, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'a dated line'),
    ).toBe(0);
  }, 180_000);

  it('reports a failed step 6 only when the hook fails, and skips it with self-tests off', async () => {
    const f = await afterSystemAgent();
    const r = await installMemorySystemProtected({
      exec: nodeExec,
      git,
      seed: f.seed,
      store: f.store,
      members: f.members,
      selfTests: false,
    });
    expect(r.checks.filter((c) => c.step.startsWith('E')).map((c) => c.status)).toEqual([
      'skipped',
      'skipped',
      'skipped',
    ]);
    expect(r.checks.find((c) => c.step === 'store-hook')).toMatchObject({ status: 'passed' });
  }, 180_000);
});

describe('mergeStoreAccess', () => {
  it('keeps every other key and adds the store once', () => {
    const first = mergeStoreAccess(
      JSON.stringify({ model: 'x', env: { A: '1' }, permissions: { allow: ['Read'] } }),
      'C:/Sites/shop-memory',
    );
    const parsed = JSON.parse(first) as Record<string, unknown>;
    expect(parsed).toEqual({
      model: 'x',
      env: { A: '1', MEMORY_STORE_DIR: 'C:/Sites/shop-memory' },
      permissions: { allow: ['Read'], additionalDirectories: ['C:/Sites/shop-memory'] },
    });
    expect(mergeStoreAccess(first, 'C:/Sites/shop-memory')).toBe(first);
  });

  it('starts from nothing, and refuses a file that is not a JSON object', () => {
    expect(JSON.parse(mergeStoreAccess(null, '/s'))).toEqual({
      env: { MEMORY_STORE_DIR: '/s' },
      permissions: { additionalDirectories: ['/s'] },
    });
    expect(() => mergeStoreAccess('[]', '/s')).toThrow(/not a JSON object/);
    expect(() => mergeStoreAccess('{', '/s')).toThrow(/not valid JSON/);
  });
});

describe('storePreCommitHook', () => {
  it('writes a new hook, appends to an existing one once, and is idempotent', () => {
    const fresh = storePreCommitHook(null);
    expect(fresh).toBe(`#!/usr/bin/env bash\nexec ${STORE_HOOK_LINE}\n`);
    expect(storePreCommitHook(fresh)).toBe(fresh);
    const appended = storePreCommitHook('#!/bin/sh\necho other');
    expect(appended).toBe(`#!/bin/sh\necho other\n${STORE_HOOK_LINE} || exit 1\n`);
    expect(storePreCommitHook(appended)).toBe(appended);
  });
});
