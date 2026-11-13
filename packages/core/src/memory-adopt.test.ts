import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nodeExec } from '@incubator/runtime';
import { readStoreSystem } from './memory-adopt.js';
import { fakePublishEngine } from './testing.js';

describe('adopting an existing store (plan 079 WI-2)', () => {
  const YAML =
    '# comment\nsystem: shop\nseed_version: 1.0.1\nstore_repo: shop-memory\nmembers:\n  - repo: api\n    path: ../api\n    role: member   # note\n  - repo: site.cloud\n    path: ../site/app/public\n    role: member\n  - repo: web\n    role: member\nexcluded:\n  - repo: other\n    reason: separate\n';

  beforeEach(() => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'member gitcfg ')), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function storeWith(yaml: string, conf?: string): Promise<string> {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'adopt store '));
    const store = path.join(tmp, 'shop-memory');
    mkdirSync(store, { recursive: true });
    writeFileSync(path.join(store, 'system.yaml'), yaml);
    if (conf) writeFileSync(path.join(store, 'memory.conf'), conf);
    const cwd = store;
    await nodeExec.run('git', ['init', '-q', '-b', 'main'], { cwd, timeoutMs: 30_000 });
    await nodeExec.run('git', ['add', '-A'], { cwd, timeoutMs: 30_000 });
    await nodeExec.run('git', ['commit', '-q', '-m', 'initial'], { cwd, timeoutMs: 30_000 });
    return store;
  }

  it('reads the system, the policy and every member folder', async () => {
    const store = await storeWith(YAML, 'commit_policy=direct\n');
    const s = readStoreSystem(store);
    expect(s.name).toBe('shop');
    expect(s.seedVersion).toBe('1.0.1');
    expect(s.storeCommitPolicy).toBe('direct');
    expect(s.members.map((m) => m.repo)).toEqual(['api', 'site.cloud', 'web']);
    const sitePath = s.members.find((m) => m.repo === 'site.cloud')!.dir;
    expect(sitePath).toBe(path.resolve(store, '../site/app/public'));
    const webPath = s.members.find((m) => m.repo === 'web')!.dir;
    expect(webPath).toBe(path.resolve(store, '../web'));
  });

  it('refuses a folder that is not a store, and a manifest with no members', () => {
    expect(() => readStoreSystem(os.tmpdir())).toThrowError(
      expect.objectContaining({ code: 'not_a_store' }),
    );
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'bad store '));
    const store = path.join(tmp, 'shop-memory');
    mkdirSync(store, { recursive: true });
    writeFileSync(path.join(store, 'system.yaml'), 'system: shop\n');
    expect(() => readStoreSystem(store)).toThrowError(
      expect.objectContaining({ code: 'bad_manifest' }),
    );
  });

  it('registers the system in the portfolio, writes nothing in the store, and a second run replaces it', async () => {
    const h = fakePublishEngine({ portfolio: true });
    const store = await storeWith(YAML, 'commit_policy=pr\n');
    const before = (
      await nodeExec.run('git', ['status', '--porcelain'], { cwd: store, timeoutMs: 30_000 })
    ).stdout;
    const first = await h.engine.adoptMemorySystem(store);
    expect(first.system.name).toBe('shop');
    expect(first.system.members.length).toBe(3);
    expect(first.system.storeCommitPolicy).toBe('pr');
    expect(h.engine.memorySystems().length).toBe(1);
    await h.engine.adoptMemorySystem(store);
    expect(h.engine.memorySystems().length).toBe(1);
    const after = (
      await nodeExec.run('git', ['status', '--porcelain'], { cwd: store, timeoutMs: 30_000 })
    ).stdout;
    expect(after).toBe(before);
    expect(after).toBe('');
    const headBefore = (
      await nodeExec.run('git', ['rev-parse', 'HEAD'], { cwd: store, timeoutMs: 30_000 })
    ).stdout.trim();
    await h.engine.adoptMemorySystem(store);
    const headAfter = (
      await nodeExec.run('git', ['rev-parse', 'HEAD'], { cwd: store, timeoutMs: 30_000 })
    ).stdout.trim();
    expect(headAfter).toBe(headBefore);
    await expect(h.engine.adoptMemorySystem(os.tmpdir())).rejects.toMatchObject({
      code: 'not_a_store',
    });
  });
});
