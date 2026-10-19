import type { Exec, ExecResult } from '@incubator/runtime';
import { describe, expect, it } from 'vitest';
import { appRunSteps, appUrl, runAppSteps, waitForUrl, type AppStepResult } from './app-run.js';
import type { StandUpFacts } from './standup.js';

const facts = (pack: string, platform = 'wordpress-plugin'): StandUpFacts =>
  ({
    runId: 'r1',
    name: 'Demo',
    slug: 'demo',
    pack,
    platform,
    guide: {},
  }) as unknown as StandUpFacts;

/** An Exec that records each PowerShell command and answers from a queue of exit codes. */
function fakeExec(codes: (number | null)[], shell = true) {
  const commands: string[] = [];
  const exec: Exec = {
    which: () => Promise.resolve(shell ? { path: 'powershell', kind: 'native' } : null),
    run(_bin, args) {
      commands.push(String(args.at(-1)));
      const code = codes.shift() ?? 0;
      return Promise.resolve({
        code,
        signal: null,
        stdout: code === 0 ? 'fine' : 'boom',
        stderr: '',
        timedOut: false,
      } satisfies ExecResult);
    },
  };
  return { exec, commands };
}

describe('start the app (plan 064)', () => {
  it('knows where each stack answers, and that a library has nowhere', () => {
    expect(appUrl({ pack: 'wordpress' })).toBe('http://localhost:8080');
    expect(appUrl({ pack: 'node-web' })).toBe('http://localhost:3000');
    expect(appUrl({ pack: 'python-service' })).toBe('http://localhost:8000');
    expect(appUrl({ pack: 'node-lib' })).toBeNull();
  });

  it('leaves the project check out and starts node-web and python in Docker last', () => {
    for (const pack of ['wordpress', 'node-web', 'python-service']) {
      const steps = appRunSteps(facts(pack));
      expect(steps.length).toBeGreaterThan(3);
      expect(steps.some((s) => s.command === 'node scripts/check.mjs quick')).toBe(false);
    }
    expect(appRunSteps(facts('node-web')).at(-1)?.command).toBe('docker compose up -d --build');
    expect(appRunSteps(facts('python-service')).at(-1)?.command).toBe(
      'docker compose up -d --build',
    );
    expect(appRunSteps(facts('wordpress')).at(-1)?.command).not.toContain('--build');
    expect(
      appRunSteps(facts('node-lib')).every((s) => s.command !== 'docker compose up -d --build'),
    ).toBe(true);
  });

  it('runs the steps in order and reports each', async () => {
    const { exec, commands } = fakeExec([]);
    const seen: AppStepResult[] = [];
    const steps = appRunSteps(facts('node-web'));
    expect(await runAppSteps(exec, '.', steps, undefined, (r) => seen.push(r))).toBe(true);
    expect(seen.map((r) => r.title)).toEqual(steps.map((s) => s.title));
    expect(commands.map((c) => c.replace('; exit $LASTEXITCODE', ''))).toEqual(
      steps.map((s) => s.command),
    );
    expect(seen.every((r) => r.ok)).toBe(true);
  });

  it('stops at the first step that fails and keeps what it printed', async () => {
    const { exec, commands } = fakeExec([0, 0, 1]);
    const seen: AppStepResult[] = [];
    const steps = appRunSteps(facts('node-web'));
    expect(await runAppSteps(exec, '.', steps, undefined, (r) => seen.push(r))).toBe(false);
    expect(seen).toHaveLength(3);
    expect(commands).toHaveLength(3);
    expect(seen[2]).toMatchObject({ ok: false, code: 1, tail: 'boom' });
  });

  it('fails the first step, without throwing, when PowerShell is missing', async () => {
    const { exec, commands } = fakeExec([], false);
    const seen: AppStepResult[] = [];
    expect(
      await runAppSteps(exec, '.', appRunSteps(facts('wordpress')), undefined, (r) => seen.push(r)),
    ).toBe(false);
    expect(commands).toHaveLength(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tail).toContain('not installed');
  });

  it('waits for the address to answer, and gives up after the time allowed', async () => {
    let calls = 0;
    expect(await waitForUrl('http://x', () => Promise.resolve(++calls >= 3), 5000, 1)).toBe(true);
    expect(calls).toBe(3);
    expect(await waitForUrl('http://x', () => Promise.reject(new Error('down')), 30, 5)).toBe(
      false,
    );
  });
});
