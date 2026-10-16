import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec, type Exec } from '@incubator/runtime';
import { createCommandVerifier, installCommands, installDependencies } from './verify.js';

function repo(check: string, extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-'));
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'scripts/check.mjs'), check);
  for (const [f, c] of Object.entries(extra)) writeFileSync(path.join(dir, f), c);
  return dir;
}

describe('installDependencies (plan 056)', () => {
  const fake = (installed: string[], code: number | null, throws = false) => {
    const calls: string[] = [];
    const exec = {
      which: (name: string) => Promise.resolve(installed.includes(name) ? { path: name } : null),
      run: (bin: string, args: readonly string[]) => {
        calls.push([bin, ...args].join(' '));
        if (throws) return Promise.reject(new Error('spawn failed'));
        return Promise.resolve({ code, signal: null, stdout: '', stderr: '', timedOut: false });
      },
    } as unknown as Exec;
    return { exec, calls };
  };

  it('runs the install of each manifest and reports ok', async () => {
    const { exec, calls } = fake(['composer'], 0);
    const dir = repo('', { 'composer.json': '{}' });
    expect(await installDependencies(exec, dir)).toEqual([
      { command: 'composer install', result: 'ok', note: '' },
    ]);
    expect(calls).toEqual(['composer install --no-interaction --no-progress']);
  });

  it('reports an installer that is not installed, without running anything', async () => {
    const { exec, calls } = fake([], 0);
    const dir = repo('', { 'composer.json': '{}' });
    expect(await installDependencies(exec, dir)).toEqual([
      { command: 'composer install', result: 'missing', note: 'composer is not installed' },
    ]);
    expect(calls).toEqual([]);
  });

  it('reports a failing install and one that cannot start, and never throws', async () => {
    const dir = repo('', { 'composer.json': '{}' });
    expect(await installDependencies(fake(['composer'], 1).exec, dir)).toEqual([
      { command: 'composer install', result: 'failed', note: 'composer install exited 1' },
    ]);
    expect(await installDependencies(fake(['composer'], 0, true).exec, dir)).toEqual([
      { command: 'composer install', result: 'failed', note: 'composer install could not run' },
    ]);
  });

  it('does nothing for a repository with no manifest', async () => {
    const { exec, calls } = fake(['composer'], 0);
    expect(await installDependencies(exec, repo(''))).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('command verifier', () => {
  it('derives install commands from manifests', () => {
    const dir = repo('', { 'package.json': '{}', 'pyproject.toml': '', 'composer.json': '{}' });
    expect(installCommands(dir).map(([c]) => c)).toEqual(['pnpm', 'uv', 'composer']);
  });

  it("runs each repository's own check and reports failing steps", async () => {
    const verify = createCommandVerifier(nodeExec);
    const ok = repo("process.stdout.write('✔ bom pass\\n'); process.exitCode = 0;");
    expect(await verify({ app: ok })).toEqual({
      ok: true,
      summary: `${path.basename(ok)}: check quick exit 0`,
    });
    const bad = repo(
      "process.stdout.write('✔ bom pass\\n✖ unit            fail   1.0s\\n'); process.exitCode = 2;",
    );
    const r = await verify({ app: bad });
    expect(r.ok).toBe(false);
    expect(r.summary).toContain('exit 2 (✖ unit fail 1.0s)');
  });

  it('copies the app into the paired tests repository before checking it', async () => {
    const verify = createCommandVerifier(nodeExec);
    const app = repo('process.exitCode = 0;', { 'marker.txt': 'app' });
    const tests = repo(
      "import { existsSync } from 'node:fs'; process.exitCode = existsSync('app/marker.txt') ? 0 : 2;",
    );
    expect((await verify({ app, paired: tests })).ok).toBe(true);
    expect(existsSync(path.join(tests, 'app', 'marker.txt'))).toBe(true);
  });
});
