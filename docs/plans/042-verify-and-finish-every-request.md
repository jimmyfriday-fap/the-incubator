# Plan 042: an update run keeps going until every request is done and the Incubator's own checks pass

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 11 runs the formatter, and work item 10 refreshes one snapshot.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 041. Before you start, check that `packages/core/src/check-run.ts` exists and contains `export async function runChecks(`; stop if it does not.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A real update run on a repository the Incubator did not build (rolling-schedule: six requests) built all six and passed `flutter analyze` and `flutter test`. Its verdict still came out "parked: the agent stopped before reaching ready for test", for two reasons:

- **One ticket.** Six tickets were seeded, but only the first was tracked (`activeTicket` in `packages/core/src/handoff.ts` returns one id; `ticketState` reads that one back).
- **Nothing marked it.** In a repository the Incubator built, a Stop hook marks the ticket; an external repository has none, and the agent's prompt never asked it to.

The owner decided:

- **The Incubator verifies.** When the agent's part ends normally, the Incubator runs the owner-approved check commands itself (`runChecks`, plan 041). Only every ticket being marked and every check passing makes the run ready.
- **It keeps going.** When requests remain, or a check fails, it checkpoints the part (plan 036) and launches another part. That part is told exactly which requests are not done and which checks failed. This continues within `MAX_CODE_PARTS`, and stops when a part changes nothing.
- **Baseline first.** A check that already failed before the agent started (for example, dependencies not installed) is reported but does not hold the work back. The Incubator runs the checks once on the code as it was (`code.baseline`) before the first part.
- **The agent marks tickets.** The external prompt now asks it to mark each step's ticket `READY_FOR_TEST` when the step is finished. That is how the Incubator knows which requests remain; the verdict still needs the Incubator's own checks.

Repositories the Incubator built (`checks.mode === 'gate'`) keep their Stop-hook flow unchanged: every new branch is behind `external`.

## Work items

### 1. Core: which tickets remain

In `packages/core/src/handoff.ts`:

Find:

```text
export function ticketState(repo: string, id: string): string | null {
```

Replace with:

```text
/** The plan's tickets that are not READY_FOR_TEST (or later) yet (plan 042). A missing or unreadable ticket file counts as not done. */
export function remainingTickets(repo: string, ids: readonly string[]): string[] {
  return ids.filter((id) => {
    let s: string | null = null;
    try {
      s = ticketState(repo, id);
    } catch {
      // why: the agent edits ticket files now; one it left broken is a request that is not done, not a crash.
    }
    return s !== 'READY_FOR_TEST' && s !== 'TEST_PASSED' && s !== 'DEPLOYED';
  });
}

export function ticketState(repo: string, id: string): string | null {
```

### 2. Core: the continuing section names what is left

In `packages/core/src/handoff.ts`:

Find:

```text
  /** A continued run (plan 037): the commit the earlier coding session's work ends at. */
  before?: { sha: string; since: string | null; tripped: string | null };
}): string {
```

Replace with:

```text
  /** A continued run (plan 037): the commit the earlier coding session's work ends at. */
  before?: { sha: string; since: string | null; tripped: string | null };
  /** Plan 042: the requests not done yet, and the checks that failed when the Incubator ran them. */
  remaining?: readonly { id: string; summary: string }[];
  failing?: readonly { command: string; tail: string }[];
}): string {
```

Find:

```text
    return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nThe earlier coding session's work is committed on this branch${from}; it ends at commit ${c.before.sha.slice(0, 12)}${why}.\n`;
```

Replace with:

```text
    return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nThe earlier coding session's work is committed on this branch${from}; it ends at commit ${c.before.sha.slice(0, 12)}${why}.\n${leftText(c)}`;
```

Find:

```text
  return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nEarlier parts, committed on this branch${since}:\n\n${list}\n`;
}
```

Replace with:

```text
  return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nEarlier parts, committed on this branch${since}:\n\n${list}\n${leftText(c)}`;
}

/** Plan 042: what the previous part left: requests whose tickets are not marked, and checks that failed. */
function leftText(c: {
  remaining?: readonly { id: string; summary: string }[];
  failing?: readonly { command: string; tail: string }[];
}): string {
  const parts: string[] = [];
  if (c.remaining?.length)
    parts.push(
      `These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n${c.remaining.map((r) => `- ${r.id}: ${r.summary}`).join('\n')}`,
    );
  if (c.failing?.length)
    parts.push(
      `When you stopped, the Incubator ran the approved commands and these failed:\n\n${c.failing.map((f) => `- ${f.command}:\n${f.tail.split('\n').map((l) => `    ${l}`).join('\n')}`).join('\n\n')}`,
    );
  return parts.length ? `\n${parts.join('\n\n')}\n` : '';
}
```

### 3. Core: the agent marks each step's ticket

In `packages/core/prompts/handoff-external.md`:

Find:

```text
version: 1.0.0
```

Replace with:

```text
version: 1.1.0
```

Find:

```text
7. Your last message is shown to the owner when they decide on the commit.
```

Replace with:

```text
7. Each plan step names its ticket, a file in `.incubator/tickets/`. When a step is finished and the approved commands that apply pass, set that ticket's `"state"` to `"READY_FOR_TEST"`, and change nothing else in the file. When you stop, the Incubator runs the approved commands itself; a step whose ticket is not marked, or a command that fails, comes back to you in a next part.
8. Your last message is shown to the owner when they decide on the commit.
```

### 3a. Core: the continue prompt is true for every kind of part

In `packages/core/prompts/handoff-continue.md`:

Find:

```text
version: 1.0.0
```

Replace with:

```text
version: 1.1.0
```

Then, in the same file, find:

```text
An earlier session worked on this same plan and was stopped at a run limit before it finished.
```

Replace with:

```text
An earlier session worked on this same plan and stopped before it finished: at a run limit, or with requests or checks left (listed below when so).
```

In `packages/core/src/handoff.test.ts`:

Find:

```text
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.0.0');
```

Replace with:

```text
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.1.0');
```

### 3b. Design document: the Incubator now runs the approved commands

In `docs/TDD.md`:

Find:

```text
The Incubator itself never
  runs these commands.
```

Replace with:

```text
When the agent stops, the Incubator itself runs these
  commands to verify the work (plans 041 and 042): the run is ready only when every request ticket is marked
  `READY_FOR_TEST` and every command passes, apart from commands that already failed before the agent started;
  otherwise another part starts, told what is left, up to five. Checking time is not counted against the run ceilings.
```

### 4. Core: the report carries the verification, and the checkpoint says why

In `packages/core/src/finish.ts`:

Find:

```text
import { cleanAgentText, type HandoffOutcome } from './handoff.js';
```

Replace with:

```text
import { cleanAgentText, type HandoffOutcome } from './handoff.js';
import type { CheckRun } from './check-run.js';
```

Find:

```text
  /** How many parts the agent worked in (plan 036); absent in reports journaled before. */
  parts?: number;
}
```

Replace with:

```text
  /** How many parts the agent worked in (plan 036); absent in reports journaled before. */
  parts?: number;
  /** The Incubator's own check of an update run (plan 042): tickets not marked, and its check runs. */
  verify?: { done: boolean; remaining: string[]; runs: CheckRun[]; alreadyFailing: string[] };
}
```

Find:

```text
  opts: { title: string; part: number; tripped: string | null },
  runId: string,
): string {
  const head = subject('chore', `part ${opts.part} of up to ${MAX_CODE_PARTS}: ${opts.title}`);
  const why = `The coding agent stopped at a run limit (${opts.tripped ?? 'unknown'}); the next part continues from here.`;
```

Replace with:

```text
  opts: { title: string; part: number; tripped: string | null; left?: string | null },
  runId: string,
): string {
  const head = subject('chore', `part ${opts.part} of up to ${MAX_CODE_PARTS}: ${opts.title}`);
  const why = opts.tripped
    ? `The coding agent stopped at a run limit (${opts.tripped}); the next part continues from here.`
    : `The coding agent stopped with work left (${opts.left ?? 'unknown'}); the next part continues from here.`;
```

### 5. Core: the engine's imports

In `packages/core/src/engine.ts`:

Find:

```text
  AGENT_ADAPTERS,
  activeTicket,
```

Replace with:

```text
  AGENT_ADAPTERS,
  activeTicket,
  remainingTickets,
```

Find:

```text
} from './handoff.js';

/**
 * The identity of what the owner asked for.
```

Replace with:

```text
} from './handoff.js';
import { runChecks, type CheckRun } from './check-run.js';

/**
 * The identity of what the owner asked for.
```

### 6. Core: the plan's tickets, the checks, and the baseline

In `packages/core/src/engine.ts`:

Find:

```text
  /** The coding parts already committed since coding last started (plan 036). */
```

Replace with:

```text
  /** An update run's tickets with their requests, in plan order (plan 042). Empty for other runs. */
  private planTickets(runId: string): { id: string; summary: string }[] {
    const s = this.state(runId);
    const delivered = s.steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
    if (s.input.kind !== 'enhance' || !delivered) return [];
    const features = this.finalSpec(runId)?.intent.coreFeatures ?? [];
    return delivered.features.map((f) => ({
      id: ticketId(f),
      summary: features.find((x) => x.id === f.id)?.summary ?? f.id,
    }));
  }

  /** Runs the approved check commands in the folder, with the PATH the agent had (plan 042). */
  private async verifyChecks(
    runId: string,
    dir: string,
    commands: readonly string[],
  ): Promise<CheckRun[]> {
    // why: an engine built without tools (every test engine) must not find the developer's real SDKs.
    const tools = this.tools() ?? {
      exec: this.deps.handoff!.exec,
      userHome: this.deps.store.runDir(runId),
    };
    const env = await toolPathEnv(commands, tools);
    const runs = await runChecks(commands, dir, tools, {
      ...(env ? { env } : {}),
      ...this.sig(runId),
    });
    // why: a Stop pressed during the last command ends it early; that result says nothing about the code.
    this.throwIfStopped(runId);
    return runs;
  }

  /** The approved checks on the code before the agent's first part of the run, run once (plan 042). */
  private async checkBaseline(
    runId: string,
    dir: string,
    commands: readonly string[],
  ): Promise<CheckRun[]> {
    const entries = this.entries(runId);
    // why: a continued run (plan 037) keeps the baseline from before the agent's first part: the earlier
    // session's own failures are not excused. A continued run with no baseline excuses nothing.
    const known = entries.find((e) => e.type === 'code.baseline');
    if (known) return known['runs'] as CheckRun[];
    if (entries.some((e) => e.type === 'code.continue')) return [];
    const runs = await this.verifyChecks(runId, dir, commands);
    this.record(runId, 'code.baseline', { runs });
    return runs;
  }

  /** The coding parts already committed since coding last started (plan 036). */
```

### 7. Core: the coding loop verifies and keeps going

In `packages/core/src/engine.ts`:

Find:

```text
      let out: HandoffOutcome;
      for (;;) {
        let last = 0;
        const part = earlier.length + 1;
        out = await this.launchHandoff(runId, {
          onProgress: (p) => {
            // why: a long run reports every turn; the journal keeps the first and then one a second.
            if (last && Date.now() - last < 1000) return;
            last = Date.now();
            this.record(runId, 'handoff.progress', { ...p });
          },
          ...(part > 1 || resumed
            ? {
                continuation: {
                  part,
                  max: MAX_CODE_PARTS,
                  base: base ?? null,
                  earlier,
                  ...(resumed ? { before: resumed } : {}),
                },
              }
            : {}),
        });
        if (agentReport(out).verdict !== 'ceiling' || part >= MAX_CODE_PARTS) break;
        // why: a part that changed nothing would spend the next part's limits the same way.
        if ((await git.status(dir)).length === 0) break;
        // why: without an identity there is nobody to commit as; the commit request then says what to set.
        if (!(await git.identity(dir))) break;
        // why: a checkpoint is only ever made on the run's own branch, never on a branch the owner switched to.
        if (
          !start?.branch?.startsWith('incubator/') ||
          (await git.currentBranch(dir)) !== start.branch
        )
          break;
        // why: a Stop pressed as the limit tripped, or a plan already finished (cost arrives in the last event).
        if (
          this.#active.get(runId)?.controller.signal.aborted ||
          out.ticketState === 'READY_FOR_TEST'
        )
          break;
        await git.addAll(dir);
        const title = this.finishTitle(runId, this.state(runId));
        const sha = await git.commit(
          dir,
          partMessage({ title, part, tripped: out.tripped }, runId),
          {},
        );
        const done: CodePart = { part, sha, tripped: out.tripped };
        this.record(runId, 'code.part', { ...done });
        earlier.push(done);
      }
      this.record(runId, 'step.ok', {
        step: 'code.done',
        data: { ...agentReport(out), checks, parts: earlier.length + 1 },
      });
```

Replace with:

```text
      // An update run on a repository the Incubator did not build (plan 042): when a part ends, the Incubator runs
      // the approved checks itself, and keeps going until every request's ticket is marked and the checks pass.
      const external = checks.mode !== 'gate';
      const tickets = external ? this.planTickets(runId) : [];
      // why: a check that already failed before the agent started (for example, dependencies not installed) is
      // reported, but does not hold the agent's work back.
      const baseline =
        external && checks.mode === 'approved'
          ? await this.checkBaseline(runId, dir, checks.commands)
          : [];
      const alreadyFailing = baseline.filter((r) => r.result === 'failed').map((r) => r.command);
      let verify: {
        done: boolean;
        remaining: string[];
        runs: CheckRun[];
        alreadyFailing: string[];
      } | null = null;
      let out: HandoffOutcome;
      for (;;) {
        let last = 0;
        const part = earlier.length + 1;
        // The previous part's verification, when it left work: the next part is told exactly what.
        const left = verify && !verify.done ? verify : null;
        out = await this.launchHandoff(runId, {
          onProgress: (p) => {
            // why: a long run reports every turn; the journal keeps the first and then one a second.
            if (last && Date.now() - last < 1000) return;
            last = Date.now();
            this.record(runId, 'handoff.progress', { ...p });
          },
          ...(part > 1 || resumed
            ? {
                continuation: {
                  part,
                  max: MAX_CODE_PARTS,
                  base: base ?? null,
                  earlier,
                  ...(resumed ? { before: resumed } : {}),
                  ...(left
                    ? {
                        remaining: tickets.filter((t) => left.remaining.includes(t.id)),
                        failing: left.runs
                          .filter(
                            (r) => r.result === 'failed' && !left.alreadyFailing.includes(r.command),
                          )
                          .map((r) => ({ command: r.command, tail: r.tail })),
                      }
                    : {}),
                },
              }
            : {}),
        });
        // why: the checks write files too; whether the agent changed anything is read before they run.
        const changed = (await git.status(dir)).length > 0;
        verify = null;
        if (external && !out.stopped) {
          const remaining = remainingTickets(
            dir,
            tickets.map((t) => t.id),
          );
          // why: verify a part that ended normally, or one that finished every request as a limit tripped.
          if ((out.exitCode === 0 && !out.tripped) || (out.tripped && remaining.length === 0)) {
            const runs =
              checks.mode === 'approved'
                ? await this.verifyChecks(runId, dir, checks.commands)
                : [];
            verify = {
              done:
                remaining.length === 0 &&
                runs.every((r) => r.result !== 'failed' || alreadyFailing.includes(r.command)),
              remaining,
              runs,
              alreadyFailing,
            };
            this.record(runId, 'code.verify', { part, ...verify });
            if (verify.done) break;
          }
        }
        const more = out.tripped !== null || (verify !== null && !verify.done);
        if (!more || part >= MAX_CODE_PARTS) break;
        // why: a part that changed nothing would spend the next part's limits the same way.
        if (!changed) break;
        // why: without an identity there is nobody to commit as; the commit request then says what to set.
        if (!(await git.identity(dir))) break;
        // why: a checkpoint is only ever made on the run's own branch, never on a branch the owner switched to.
        if (
          !start?.branch?.startsWith('incubator/') ||
          (await git.currentBranch(dir)) !== start.branch
        )
          break;
        // why: a Stop pressed as the limit tripped, or a plan already finished (cost arrives in the last event).
        if (
          this.#active.get(runId)?.controller.signal.aborted ||
          (!external && out.ticketState === 'READY_FOR_TEST')
        )
          break;
        await git.addAll(dir);
        const title = this.finishTitle(runId, this.state(runId));
        const unfinished = verify
          ? `${verify.remaining.length} request(s) not done, ${verify.runs.filter((r) => r.result === 'failed' && !alreadyFailing.includes(r.command)).length} check(s) failing`
          : null;
        const sha = await git.commit(
          dir,
          partMessage({ title, part, tripped: out.tripped, left: unfinished }, runId),
          {},
        );
        const done: CodePart = { part, sha, tripped: out.tripped };
        this.record(runId, 'code.part', { ...done });
        earlier.push(done);
      }
      const report = agentReport(out);
      // The verdict of an update run counts every request and the Incubator's own checks (plan 042).
      const verdict =
        external && verify
          ? verify.done
            ? 'ready'
            : report.verdict === 'ready'
              ? 'parked'
              : report.verdict
          : report.verdict;
      this.record(runId, 'step.ok', {
        step: 'code.done',
        data: {
          ...report,
          verdict,
          checks,
          parts: earlier.length + 1,
          ...(verify ? { verify } : {}),
        },
      });
```

### 8. Test: tickets left and the continuing section

In `packages/core/src/handoff.test.ts`:

Find:

```text
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
```

Replace with:

```text
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
```

Find:

```text
  continuationText,
  handoffPrompt,
  HANDOFF_ALLOWED_TOOLS,
```

Replace with:

```text
  continuationText,
  handoffPrompt,
  HANDOFF_ALLOWED_TOOLS,
  remainingTickets,
```

Find:

```text
  it('ships the external prompt versioned and byte-pinned', () => {
    const p = loadPrompt('handoff-external');
    expect(p.name).toBe('handoff-external');
    expect(p.version).toBe('1.0.0');
```

Replace with:

```text
  it('lists the tickets not marked ready, counts a broken ticket file as not done, and tells the next part what is left (plan 042)', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'tickets '));
    const dir = path.join(repo, '.incubator', 'tickets');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'E-a.json'), JSON.stringify({ id: 'E-a', state: 'READY_FOR_TEST' }));
    writeFileSync(
      path.join(dir, 'E-b.json'),
      JSON.stringify({ id: 'E-b', state: 'TAGGED_TO_RELEASE', remediations: ['x'] }),
    );
    expect(remainingTickets(repo, ['E-a', 'E-b', 'E-c'])).toEqual(['E-b', 'E-c']);
    writeFileSync(path.join(dir, 'E-d.json'), '{ not json');
    expect(remainingTickets(repo, ['E-a', 'E-d'])).toEqual(['E-d']);
    const text = continuationText({
      part: 2,
      max: 5,
      base: null,
      earlier: [],
      remaining: [{ id: 'E-b', summary: 'Export as CSV' }],
      failing: [{ command: 'flutter test', tail: '2 tests failed\nsee above' }],
    });
    expect(text).toContain(
      'These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n- E-b: Export as CSV',
    );
    expect(text).toContain(
      'When you stopped, the Incubator ran the approved commands and these failed:\n\n- flutter test:\n    2 tests failed\n    see above',
    );
    expect(loadPrompt('handoff-external').body).toContain(
      'set that ticket\'s `"state"` to `"READY_FOR_TEST"`',
    );
  });

  it('ships the external prompt versioned and byte-pinned', () => {
    const p = loadPrompt('handoff-external');
    expect(p.name).toBe('handoff-external');
    expect(p.version).toBe('1.1.0');
```

### 9. Nothing else in the tests here

The end-to-end behaviour (verify, keep going, baseline) is tested by plan 043 with a stand-in agent; do not add those tests in this plan.

### 10. Refresh the external prompt's snapshot

The prompt text changed on purpose in work item 3, so its pinned snapshot must be refreshed, and only that one. Run:

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts -t "ships the external prompt versioned and byte-pinned" -u
git diff --stat packages/core/src/__snapshots__/handoff.test.ts.snap
```

The diff must show exactly one file changed.

### 11. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/handoff.ts packages/core/src/finish.ts packages/core/src/engine.ts packages/core/src/handoff.test.ts packages/core/prompts/handoff-external.md packages/core/prompts/handoff-continue.md docs/TDD.md
```

## Touched files and markers

| File                                                   | Marker                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core/src/handoff.ts`                         | `export function remainingTickets(repo: string, ids: readonly string[]): string[] {`                                           |
| `packages/core/prompts/handoff-continue.md`            | `version: 1.1.0`                                                                                                               |
| `docs/TDD.md`                                          | `Checking time is not counted against the run ceilings.`                                                                       |
| `packages/core/prompts/handoff-external.md`            | `version: 1.1.0`                                                                                                               |
| `packages/core/src/finish.ts`                          | `The coding agent stopped with work left (`                                                                                    |
| `packages/core/src/engine.ts`                          | `this.record(runId, 'code.verify', { part, ...verify });`                                                                      |
| `packages/core/src/handoff.test.ts`                    | `lists the tickets not marked ready, counts a broken ticket file as not done, and tells the next part what is left (plan 042)` |
| `packages/core/src/__snapshots__/handoff.test.ts.snap` | `READY_FOR_TEST`                                                                                                               |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts packages/core/src/folder-runs.test.ts packages/core/src/check-run.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
the unit tests pass, including "lists the tickets not marked ready, counts a broken ticket file as not done, and tells the next part what is left (plan 042)"; every existing folder-run test still passes (plans 036 and 037 included)
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                    | Why                                                                                         | Mechanical check                                                                                                                                            |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repositories the Incubator built change behaviour                       | their Stop hook marks one ticket at a time, and their tests count launches                  | every new branch is behind `external` (`checks.mode !== 'gate'`); the plan 036 and 037 folder tests (new-solution runs) must still pass unchanged           |
| A check that already failed holds the run back forever                  | dependencies not installed, a broken test on main                                           | the baseline (`code.baseline`) is subtracted; plan 043 tests it, and the end-to-end suite (bare-node's `npm run test` cannot run there) still reaches ready |
| The snapshot is refreshed for more than the prompt                      | `-u` without `-t` rewrites every snapshot in the file                                       | work item 10 runs `-u` with `-t` on the one test, and the diff must show one file                                                                           |
| A broken ticket file crashes the run, or a Stop reads as a failed check | the agent now edits ticket files, and an aborted command resolves instead of throwing       | `remainingTickets` has a unit test with a file that is not JSON; `verifyChecks` calls `throwIfStopped` after `runChecks`                                    |
| A continued run excuses the checks the agent broke earlier              | `code.continue` drops `code.start`, so a late baseline would see the earlier session's work | `checkBaseline` reuses the first `code.baseline` of the run, and records none on a continued run that has none                                              |
| Unit tests run the developer's real Flutter                             | tests have no `tools`, and `os.homedir()` finds `~/flutter`                                 | `verifyChecks` falls back to the run folder as `userHome`                                                                                                   |
| The verdict says ready while requests remain                            | `agentReport` alone looks at one ticket                                                     | `verdict` is `ready` only when `verify.done`; plan 043 tests a run where the agent leaves its ticket unmarked                                               |
| A failing check is reported but never reaches the agent                 | the continuation must carry it                                                              | `leftText` puts each failing command and its output tail in the next prompt; the handoff test asserts the exact text                                        |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                             | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: a Stop during the last check was recorded as a failure, a continued run took its baseline after the agent's work, unit tests found the real Flutter, `markTicketsReady` was dead code, the continue prompt was stale, check output counted as progress | CLOSED |
| 1     | A real update run built all six requests but was marked parked: one ticket tracked, none marked, no verification; the owner chose engine verification and keeping going                                                                                             | CLOSED |
