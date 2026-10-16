# Plan 056: dependencies are installed before the coding agent starts, and a setup problem is shown when the agent stops

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 8 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/verify.ts` contains `export function installCommands(dir: string): [string, string[]][] {` and that `packages/core/src/engine.ts` contains `private async checkBaseline(`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** In a real new-project run (COI Tracker, a WordPress plugin) the coding agent could not run `composer install` (it may only run the repository's own `node scripts/check.mjs` and similar), and nothing else installed the dependencies: the generated SessionStart hook only installs when a lockfile exists, and a freshly built repository has none. `vendor/` was missing, the format, lint, typecheck and unit gates failed on missing tools, and the agent stopped after three vetoes with its tests never run. The run then showed "The agent stopped before finishing the plan" with no hint why. The hook is fixed for new builds (commit f161bcd); this plan covers repositories built before it, and makes the cause visible.

After this plan, when a repository in the Incubator's own pattern is coded (checks mode `gate`: a new solution, or an update run on a repository the Incubator built), the engine installs the repository's dependencies itself before the agent's first part, once per coding stage, best effort: a missing installer or a failed install never parks the run, it is recorded as a `code.install` journal entry. The finished-run detail (`FinishDetail.setup`) carries the first problem as one line, and the run page shows it next to "Continue coding", so the owner knows to fix the toolchain first. Update runs on a repository the Incubator did not build are unchanged (their approved commands run the checks).

## Work items

### 1. The installer

In `packages/core/src/verify.ts`:

Find:

```text
/**
 * VERIFY for real: install each repository's toolchain and run its own `check quick` (TDD §7.1).
```

Replace with:

```text
/** One install command run before the agent codes (plan 056): `ok`, `failed`, or `missing` (the installer is not on PATH). */
export interface InstallRun {
  command: string;
  result: 'ok' | 'failed' | 'missing';
  /** Empty when ok; otherwise one line saying what went wrong. */
  note: string;
}

/**
 * Plan 056: installs the dependencies a rendered repository needs, from its manifests, so the agent's first gate run
 * has its tools. Never throws: a problem is the result, because the agent can still work without the install.
 */
export async function installDependencies(
  exec: Exec,
  dir: string,
  signal?: AbortSignal,
): Promise<InstallRun[]> {
  const out: InstallRun[] = [];
  for (const [cmd, args] of installCommands(dir)) {
    const command = `${cmd} ${args[0]}`;
    if (!(await exec.which(cmd))) {
      out.push({ command, result: 'missing', note: `${cmd} is not installed` });
      continue;
    }
    try {
      const r = await exec.run(cmd, args, {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT,
        ...(signal ? { signal } : {}),
      });
      out.push(
        r.code === 0
          ? { command, result: 'ok', note: '' }
          : { command, result: 'failed', note: `${command} exited ${r.code ?? 'abnormally'}` },
      );
    } catch {
      out.push({ command, result: 'failed', note: `${command} could not run` });
    }
  }
  return out;
}

/**
 * VERIFY for real: install each repository's toolchain and run its own `check quick` (TDD §7.1).
```

### 2. The engine dependency and the live wiring

In `packages/core/src/engine.ts`:

Find:

```text
import { Publisher, type PublishDeps, type PublishSummary, type StepContext } from './publish.js';
```

Replace with:

```text
import { Publisher, type PublishDeps, type PublishSummary, type StepContext } from './publish.js';
import type { InstallRun } from './verify.js';
```

Find:

```text
  handoff?: { exec: Exec; probe(adapter: LlmAdapterId): Promise<Capabilities> };
```

Replace with:

```text
  handoff?: {
    exec: Exec;
    probe(adapter: LlmAdapterId): Promise<Capabilities>;
    /** Plan 056: installs a built repository's dependencies before the agent codes. Absent in tests that need none. */
    // why: a property, not a method signature, so the engine can read it off the object (unbound-method).
    install?: (dir: string, signal?: AbortSignal) => Promise<InstallRun[]>;
  };
```

In `packages/core/src/live.ts`:

Find:

```text
import { createCommandVerifier } from './verify.js';
```

Replace with:

```text
import { createCommandVerifier, installDependencies } from './verify.js';
```

Find:

```text
    handoff: {
      exec,
      probe: async (id) =>
```

Replace with:

```text
    handoff: {
      exec,
      install: (dir, signal) => installDependencies(exec, dir, signal),
      probe: async (id) =>
```

### 3. The engine installs before the first part

In `packages/core/src/engine.ts`:

Find:

```text
      // The agent works in parts (plan 036): a part stopped at a run limit is committed on the run's branch
```

Replace with:

```text
      await this.installDependencies(runId, dir, checks.mode);
      // The agent works in parts (plan 036): a part stopped at a run limit is committed on the run's branch
```

Find:

```text
  /** Runs the approved check commands in the folder, with the PATH the agent had (plan 042). */
```

Replace with:

```text
  /**
   * Plan 056: a repository the Incubator built (checks mode `gate`) gets its dependencies installed before the agent's
   * first part, once per coding stage. The agent may not run an installer itself, and a gate that fails on missing
   * tools tells it nothing it can fix. The outcome is journaled; a problem never parks the run.
   */
  private async installDependencies(runId: string, dir: string, mode: string): Promise<void> {
    const install = this.deps.handoff?.install;
    if (!install || mode !== 'gate') return;
    const after = this.continuedAt(runId);
    if (this.entries(runId).some((e) => e.type === 'code.install' && e.seq > after)) return;
    const runs = await install(dir, this.sig(runId).signal);
    // why: a Stop pressed during the install ends it early; that result says nothing about the toolchain.
    this.throwIfStopped(runId);
    this.record(runId, 'code.install', { runs });
  }

  /** Runs the approved check commands in the folder, with the PATH the agent had (plan 042). */
```

### 4. The finished-run detail carries the problem

In `packages/core/src/finish.ts`:

Find:

```text
  pr: { number: number; url: string } | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
```

Replace with:

```text
  pr: { number: number; url: string } | null;
  /** Plan 056: the first problem installing the dependencies before the agent coded (one line), or null. */
  setup: string | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
```

In `packages/core/src/engine.ts`:

Find:

```text
    return {
      stage,
      dir,
```

Replace with:

```text
    const installed = this.entries(runId).findLast(
      (e) => e.type === 'code.install' && e.seq > after,
    )?.['runs'] as InstallRun[] | undefined;
    const setup = installed?.find((r) => r.result !== 'ok')?.note ?? null;
    return {
      stage,
      dir,
```

Find:

```text
      pr: pr ?? null,
```

Replace with:

```text
      pr: pr ?? null,
      setup,
```

### 5. The run page

In `apps/web/src/api-types.ts`:

Find:

```text
  pr: { number: number; url: string } | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
```

Replace with:

```text
  pr: { number: number; url: string } | null;
  /** Plan 056: the first problem installing the dependencies before the agent coded, or null. */
  setup: string | null;
  /** The parts committed as checkpoints since coding last started (plan 036). */
```

In `apps/web/src/ui/views/Summary.tsx`:

Find:

```text
              <button type="button" data-testid="continue-coding" onClick={onContinue}>
```

Replace with:

```text
              {run.finish.setup && (
                <p className="warn" data-testid="setup-problem">
                  Setting up the project failed: {run.finish.setup}. That is probably why the agent
                  could not finish: fix it in <code>{run.finish.dir}</code> first, then continue.
                </p>
              )}
              <button type="button" data-testid="continue-coding" onClick={onContinue}>
```

### 6. Tests: the installer

In `packages/core/src/verify.test.ts`:

Find:

```text
import { nodeExec } from '@incubator/runtime';
import { createCommandVerifier, installCommands } from './verify.js';
```

Replace with:

```text
import { nodeExec, type Exec } from '@incubator/runtime';
import { createCommandVerifier, installCommands, installDependencies } from './verify.js';
```

Find:

```text
describe('command verifier', () => {
```

Replace with:

```text
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
```

### 7. Tests: the engine

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
import { enhanceFixtureDir, fakePublishEngine, hashTree, seedExistingRepo } from './testing.js';
```

Replace with:

```text
import { enhanceFixtureDir, fakePublishEngine, hashTree, seedExistingRepo } from './testing.js';
import type { InstallRun } from './verify.js';
```

Find:

```text
  it('asks before every commit and push: git must know the owner, then commit, then push opens one PR', async () => {
```

Replace with:

```text
  it('installs the dependencies before the agent starts, and names a setup problem in the finished-run detail (plan 056)', async () => {
    const calls: string[] = [];
    const make = (runs: InstallRun[]) =>
      fakePublishEngine({
        handoff: {
          exec: nodeExec,
          probe: () => Promise.resolve(agentCaps),
          install: (d: string) => {
            calls.push(d);
            return Promise.resolve(runs);
          },
        },
      });
    const installs = (h: Harness, runId: string) =>
      h.engine.entries(runId).filter((e) => e.type === 'code.install');

    const bad = make([
      { command: 'composer install', result: 'missing', note: 'composer is not installed' },
    ]);
    const dir = freshFolder();
    const first = await newSolution(bad, dir);
    // Best effort: the run still reaches the commit request.
    expect(first.s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(calls).toEqual([path.resolve(dir)]);
    expect(installs(bad, first.runId)).toHaveLength(1);
    expect((await bad.engine.finishDetail(first.runId))!.setup).toBe('composer is not installed');

    const good = make([{ command: 'pnpm install', result: 'ok', note: '' }]);
    const second = await newSolution(good, freshFolder());
    expect((await good.engine.finishDetail(second.runId))!.setup).toBeNull();

    // An engine with no installer (every other test) records nothing and shows nothing.
    const none = harness();
    const third = await newSolution(none, freshFolder());
    expect(installs(none, third.runId)).toHaveLength(0);
    expect((await none.engine.finishDetail(third.runId))!.setup).toBeNull();
  });

  it('asks before every commit and push: git must know the owner, then commit, then push opens one PR', async () => {
```

### 8. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/verify.ts packages/core/src/verify.test.ts packages/core/src/engine.ts packages/core/src/finish.ts packages/core/src/live.ts packages/core/src/folder-runs.test.ts apps/web/src/api-types.ts apps/web/src/ui/views/Summary.tsx
```

## Touched files and markers

| File                                    | Marker                                                              |
| --------------------------------------- | ------------------------------------------------------------------- |
| `packages/core/src/verify.ts`           | `export async function installDependencies(`                        |
| `packages/core/src/engine.ts`           | `await this.installDependencies(runId, dir, checks.mode);`          |
| `packages/core/src/finish.ts`           | `setup: string \| null;`                                            |
| `packages/core/src/live.ts`             | `install: (dir, signal) => installDependencies(exec, dir, signal),` |
| `apps/web/src/api-types.ts`             | `setup: string \| null;`                                            |
| `apps/web/src/ui/views/Summary.tsx`     | `data-testid="setup-problem"`                                       |
| `packages/core/src/verify.test.ts`      | `describe('installDependencies (plan 056)'`                         |
| `packages/core/src/folder-runs.test.ts` | `installs the dependencies before the agent starts`                 |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/verify.test.ts packages/core/src/folder-runs.test.ts apps/web/src/server/server.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "installDependencies").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core apps/web
pnpm check:quick
```

```text
verify.test.ts, folder-runs.test.ts and server.test.ts pass, including the new plan 056 tests
the Select-String count prints 2
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                            | Why                                                                                        | Mechanical check                                                                                                                       |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| The install is written but the engine never calls it            | an unused method still type-checks                                                         | the engine test asserts the install ran once with the folder; the Select-String count of `installDependencies` in `engine.ts` prints 2 |
| Every existing engine test starts running a real `pnpm install` | the test harness uses the real process runner and a node-lib repository has a package.json | the dependency is optional and only `live.ts` supplies it; the harness (no `install`) is asserted to record no `code.install`          |
| A failed or missing installer parks the run                     | the agent can still work and the owner can fix the toolchain, so parking only blocks them  | the engine test uses a `missing` result and still reaches `needs_commit`                                                               |
| Update runs on foreign repositories install things              | their commands are approved by the owner; installing is not                                | the call returns unless the checks mode is `gate`                                                                                      |
| A Stop pressed during the install is journaled as a result      | the process was killed, so the outcome says nothing about the toolchain                    | `throwIfStopped` runs before `record`                                                                                                  |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                 | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from a real new-project run (COI Tracker): the agent stopped at veto 3/3 because vendor/ was missing and it may not run composer, and the run page said only that the agent stopped before finishing the plan                                                                 | CLOSED |
| 2     | In-session review (Cursor unavailable): the trial apply passed typecheck and 69 tests; eslint flagged unbound-method on the method-style `install?(...)` declaration, now a property `install?: (...) => ...`                                                                           | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5; Haiku 5.5 not offered): the diff matched the trial apply line for line except one shortened comment in `finish.ts` (restored); typecheck and eslint clean; removing the install call and inverting the `gate` test both fail the engine test | CLOSED |
