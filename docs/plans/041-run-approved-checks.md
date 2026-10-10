# Plan 041: the Incubator can run the owner-approved check commands itself

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 6 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** On a repository the Incubator did not build, the owner approves the commands the coding agent may run (ADR-025). Until now the Incubator never ran them itself, so whether the work passes was only the agent's own report. Plan 042 will have the Incubator verify the work when the agent stops. This plan adds the piece that runs the commands: `runChecks(commands, cwd, tools, opts)` in a new module `packages/core/src/check-run.ts`.

- Each approved command is run with no shell: the program is the first word, the rest are its arguments. The commands were validated at approval (`validateChecks` in `packages/core/src/checks.ts`), so they contain no shell syntax.
- The program is found the same way the agent's environment finds it. A catalog tool such as `flutter`, which may live off PATH, comes from `locateTool` (`packages/core/src/stacks.ts`). Everything else comes from PATH.
- On Windows, `bash` resolves to Git's own `bash.exe`, never to the `bash.exe` under `%SystemRoot%\System32`, which is WSL. Git Bash is the shell the coding agent itself uses.
- A program that is not installed gives `missing`, not `failed`: the work is then unverified, which is different from broken.
- Output is cut to its last 40 lines (at most 4000 characters) and cleaned with `cleanAgentText`. It is what plan 042 shows the owner and passes to the next part of the agent.

## Work items

### 1. Core: the module

Create `packages/core/src/check-run.ts` with exactly:

```ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import { InterruptedError, PolicyError } from '@incubator/runtime';
import { STACK_CATALOG } from '@incubator/spec';
import { validateChecks } from './checks.js';
import { cleanAgentText } from './handoff.js';
import { locateTool, type ToolsDeps } from './stacks.js';

/** One approved check command, run by the Incubator itself after the agent stops (plan 041). */
export interface CheckRun {
  command: string;
  /** `missing`: the program is not installed here, so the work is unverified, not failed. */
  result: 'passed' | 'failed' | 'missing';
  exitCode: number | null;
  /** The end of its output, for the owner and for the agent's next part. */
  tail: string;
}

/** How long one check may run: a full Flutter test run or a Docker-backed SQL suite takes minutes. */
export const CHECK_TIMEOUT_MS = 20 * 60_000;

/**
 * Where a check's program runs from: a catalog tool found off PATH (for example `flutter` under the
 * owner's home), Git's own bash on Windows (never WSL's), or PATH. Null when it is not installed.
 */
export async function checkProgram(
  program: string,
  tools: ToolsDeps,
  platform: NodeJS.Platform = process.platform,
): Promise<{ bin: string; batch: boolean } | null> {
  // why: the validator lowercases the program and drops `.exe`, so `BASH` and `bash.exe` must resolve the same way.
  const name = program.toLowerCase().replace(/\.exe$/, '');
  const pre = STACK_CATALOG.flatMap((s) => s.prerequisites ?? []).find((p) => p.tool === name);
  if (pre) {
    const loc = await locateTool(pre, tools);
    return loc ? { bin: loc.path, batch: true } : null;
  }
  if (name === 'bash' && platform === 'win32') {
    // why: the bash.exe under Windows' System32 is WSL; the agent's shell, and the scripts' bash, is Git's.
    const git = await tools.exec.which('git');
    if (!git) return null;
    for (const up of ['..', path.join('..', '..')]) {
      const candidate = path.resolve(path.dirname(git.path), up, 'bin', 'bash.exe');
      if (existsSync(candidate)) return { bin: candidate, batch: false };
    }
    return null;
  }
  const found = await tools.exec.which(program);
  return found ? { bin: found.path, batch: true } : null;
}

function tailOf(text: string, timedOut: boolean): string {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').slice(-40).join('\n');
  const body = cleanAgentText(lines.length > 4000 ? lines.slice(-4000) : lines, 4000) ?? '';
  return timedOut ? `timed out\n${body}` : body;
}

/** Runs each approved check command in `cwd`, in order, with no shell (plan 041). */
export async function runChecks(
  commands: readonly string[],
  cwd: string,
  tools: ToolsDeps,
  opts: { env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckRun[]> {
  // why: these commands run on the owner's computer, so the approval rules are checked again here.
  if (validateChecks(commands).length > 0)
    throw new PolicyError('check commands refused', { code: 'check_command' });
  const runs: CheckRun[] = [];
  for (const command of commands) {
    const [program, ...args] = command.split(' ');
    // why: `./gradlew test` names a file in the repository, so it is looked up from the folder it runs in.
    const prog = await checkProgram(
      program!.includes('/') ? path.resolve(cwd, program!) : program!,
      tools,
    );
    if (!prog) {
      runs.push({
        command,
        result: 'missing',
        exitCode: null,
        tail: `${program!} was not found on this computer`,
      });
      continue;
    }
    try {
      const r = await tools.exec.run(prog.bin, args, {
        cwd,
        timeoutMs: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
        allowBatch: prog.batch,
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      // why: a stop pressed while a check runs resolves as an aborted exit, not a throw.
      if (r.aborted) throw new InterruptedError(`${command} was stopped`);
      runs.push({
        command,
        result: r.code === 0 && !r.timedOut ? 'passed' : 'failed',
        exitCode: r.code,
        tail: tailOf(`${r.stdout}\n${r.stderr}`, r.timedOut),
      });
    } catch (err) {
      if (err instanceof InterruptedError) throw err;
      runs.push({
        command,
        result: 'failed',
        exitCode: null,
        tail: tailOf(err instanceof Error ? err.message : String(err), false),
      });
    }
  }
  return runs;
}
```

### 2. Core: export it

In `packages/core/src/index.ts`:

Find:

```text
export * from './handoff.js';
```

Replace with:

```text
export * from './handoff.js';
export * from './check-run.js';
```

### 3. Core: the comment that said the Incubator never runs them

In `packages/core/src/checks.ts`:

Find:

```text
 * build (ADR-025). The Incubator never runs them: they become `Bash(<command>:*)` entries in the
 * agent's allowed-tool list, so the agent can run them and nothing else.
```

Replace with:

```text
 * build (ADR-025). They become `Bash(<command>:*)` entries in the agent's allowed-tool list, so the
 * agent can run them and nothing else; the Incubator runs the same commands itself (`runChecks`, plan 041)
 * to verify the work when the agent stops.
```

### 4. Test: running checks

Create `packages/core/src/check-run.test.ts` with exactly:

```ts
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
```

### 5. Nothing else

Do not change `packages/core/src/engine.ts`: plan 042 calls `runChecks`.

### 6. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/check-run.ts packages/core/src/check-run.test.ts packages/core/src/index.ts packages/core/src/checks.ts
```

## Touched files and markers

| File                                  | Marker                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `packages/core/src/check-run.ts`      | `export async function runChecks(`                                      |
| `packages/core/src/index.ts`          | `export * from './check-run.js';`                                       |
| `packages/core/src/checks.ts`         | `the Incubator runs the same commands itself (\`runChecks\`, plan 041)` |
| `packages/core/src/check-run.test.ts` | `running the approved checks (plan 041)`                                |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/check-run.test.ts packages/core/src/checks.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
the unit tests pass, including "runs each command with no shell and reports passed, failed or missing" and "finds Git's own bash on Windows, never WSL's"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                      | Why                                                     | Mechanical check                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| The commands go through a shell           | the easy way to run a string                            | `runChecks` calls `tools.exec.run(bin, args)`; `Exec` spawns with `shell: false`; the test's commands carry no shell syntax and still run        |
| A missing tool is reported as a failure   | the run would then keep going for nothing               | the test expects `missing` with a null exit code for an unknown program                                                                          |
| WSL's bash runs the repository's scripts  | the `bash.exe` under System32 comes first on some PATHs | the test gives `which('bash')` the WSL path and expects Git's `bin\bash.exe` instead                                                             |
| The tail keeps the start of a long output | the failure is at the end                               | the test prints 60 lines and expects `line 59` and the error, not `line 0`                                                                       |
| A stop is swallowed as a failed check     | `InterruptedError` must reach the engine                | `runChecks` throws `InterruptedError` for an aborted run and rethrows it from its catch; a test aborts a running check and expects the rejection |

## Review rounds

| Round | Finding                                                                                                                       | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner chose that the Incubator verifies the work itself when the agent stops; this plan adds the runner, plan 042 uses it | CLOSED |
