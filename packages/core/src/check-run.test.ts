import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { InterruptedError, nodeExec, type Exec } from '@incubator/runtime';
import { checkProgram, runChecks } from './check-run.js';

const repo = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check run '));
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'scripts', 'ok.mjs'), "console.log('all good');\n");
  writeFileSync(
    path.join(dir, 'scripts', 'fail.mjs'),
    "for (let i = 0; i < 60; i++) console.log('line ' + i);\nconsole.error('2 tests failed');\nprocess.exit(3);\n",
  );
  return dir;
};
const tools = { exec: nodeExec, userHome: os.tmpdir() };

describe('running the approved checks (plan 041)', () => {
  it('runs each command with no shell and reports passed, failed or missing', async () => {
    const dir = repo();
    const runs = await runChecks(
      ['node scripts/ok.mjs', 'node scripts/fail.mjs', 'no-such-tool-plan041 test'],
      dir,
      tools,
    );
    expect(runs.map((r) => [r.command, r.result, r.exitCode])).toEqual([
      ['node scripts/ok.mjs', 'passed', 0],
      ['node scripts/fail.mjs', 'failed', 3],
      ['no-such-tool-plan041 test', 'missing', null],
    ]);
    expect(runs[0]!.tail).toContain('all good');
    // The tail keeps the end of the output, not the start.
    expect(runs[1]!.tail).toContain('2 tests failed');
    expect(runs[1]!.tail).toContain('line 59');
    expect(runs[1]!.tail).not.toContain('line 0\n');
    expect(runs[2]!.tail).toBe('no-such-tool-plan041 was not found on this computer');
  });

  it("finds Git's own bash on Windows, never WSL's", async () => {
    const git = mkdtempSync(path.join(os.tmpdir(), 'git install '));
    mkdirSync(path.join(git, 'cmd'));
    mkdirSync(path.join(git, 'bin'));
    writeFileSync(path.join(git, 'cmd', 'git.exe'), '');
    writeFileSync(path.join(git, 'bin', 'bash.exe'), '');
    const exec = {
      ...nodeExec,
      which: (name: string) =>
        Promise.resolve(
          name === 'git'
            ? { path: path.join(git, 'cmd', 'git.exe'), kind: 'native' as const }
            : { path: path.join(git, 'System32', 'bash.exe'), kind: 'native' as const },
        ),
    } as unknown as Exec;
    expect(await checkProgram('bash', { exec, userHome: os.tmpdir() }, 'win32')).toEqual({
      bin: path.join(git, 'bin', 'bash.exe'),
      batch: false,
    });
    // `BASH` and `bash.exe` are the same program to the approval rules, so they get the same bash.
    for (const alias of ['bash.exe', 'BASH'])
      expect(await checkProgram(alias, { exec, userHome: os.tmpdir() }, 'win32')).toEqual({
        bin: path.join(git, 'bin', 'bash.exe'),
        batch: false,
      });
    const noGit = { ...nodeExec, which: () => Promise.resolve(null) } as unknown as Exec;
    expect(await checkProgram('bash', { exec: noGit, userHome: os.tmpdir() }, 'win32')).toBeNull();
  });

  it('runs a program named by a path in the repository, and refuses what the approval rules refuse', async () => {
    const dir = repo();
    const runs = await runChecks(['./scripts/ok.mjs test'], dir, tools);
    expect(runs.map((r) => [r.result, r.exitCode])).toEqual([['passed', 0]]);
    await expect(runChecks(['sh -c id'], dir, tools)).rejects.toMatchObject({
      code: 'check_command',
    });
    await expect(runChecks(['../outside/run test'], dir, tools)).rejects.toMatchObject({
      code: 'check_command',
    });
  });

  it('a stop during a check reaches the caller, not a failed check', async () => {
    const dir = repo();
    writeFileSync(path.join(dir, 'scripts', 'slow.mjs'), 'setTimeout(() => {}, 20000);\n');
    const stop = new AbortController();
    setTimeout(() => stop.abort(), 500);
    await expect(
      runChecks(['node scripts/slow.mjs'], dir, tools, { signal: stop.signal }),
    ).rejects.toBeInstanceOf(InterruptedError);
  }, 20_000);
});
