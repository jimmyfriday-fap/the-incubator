# Plan 036: the coding agent works in parts, with a checkpoint commit after each part

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 11 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A folder run's coding agent is launched once (`codeStep` in `packages/core/src/engine.ts`). When it hits a run limit (turns, tool calls, minutes or cost), the run goes straight to the commit request with the work half done. The owner asked for the agent to keep going in parts until the plan is complete.

From now on, a part stopped at a run limit is handled like this:

1. The engine commits the work on the run's own branch. The commit is local only: nothing is pushed, and the owner still decides the push.
2. The engine records `code.part {part, sha, tripped}` in the journal.
3. It launches the agent again with the same plan, plus a "Continuing" section that lists the earlier parts' commits.

The loop stops when:

- a part ends for any other reason (the agent finished, failed, parked or was stopped);
- a part changed nothing;
- git does not know who the owner is (no identity to commit with);
- the folder is not on the run's own `incubator/` branch (a checkpoint never lands on a branch the owner switched to, such as their main branch);
- the owner pressed Stop as the limit tripped, or the agent had already moved its ticket to `READY_FOR_TEST` (Claude reports its cost only in its last event, so a cost limit can trip just as the agent finishes);
- `MAX_CODE_PARTS` (5) parts have run.

The last part's work stays uncommitted for the owner's usual commit request. If the last part left nothing uncommitted, the existing `commitStep` already goes straight to the push request, because HEAD differs from `code.start.base`.

Each part keeps the spec's per-session limits (`spec.agents.runCeilings`).

The agent still never commits. Its prompts (`packages/core/prompts/handoff.md`, `handoff-external.md`) tell it to leave its work uncommitted, and the engine makes the checkpoint commits. Checkpoint commits carry the trailer `Incubator-Part: code-<n>`, never `Incubator-Part: finish`. `commitStep` reads `Incubator-Part: finish` (`finishTrailer`) as "the owner's commit already happened", so a checkpoint must not look like that.

## Work items

### 1. Test fixture: an agent that works in parts

In `packages/core/fixtures/handoff/fake-agent.mjs`:

Find:

```text
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
```

Replace with:

```text
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
```

Find:

```text
} else if (mode === 'runaway') {
```

Replace with:

```text
} else if (mode === 'parts') {
  // Works in parts (plan 036): each launch writes the next src/part-N.txt (only the first FAKE_AGENT_WRITES of
  // them) and notes whether its prompt asked it to continue. Launches before FAKE_AGENT_PARTS keep calling
  // tools until a ceiling stops them; that launch finishes the plan.
  const parts = Number(process.env.FAKE_AGENT_PARTS ?? 3);
  const writes = Number(process.env.FAKE_AGENT_WRITES ?? 99);
  let n = 1;
  while (existsSync(path.join('src', `part-${n}.txt`))) n++;
  // FAKE_AGENT_SWITCH=1: the agent (or the owner) moves the folder to another branch before the limit trips.
  if (process.env.FAKE_AGENT_SWITCH === '1') execFileSync('git', ['switch', '-q', '-c', 'elsewhere']);
  if (n <= writes) {
    mkdirSync('src', { recursive: true });
    writeFileSync(
      path.join('src', `part-${n}.txt`),
      `part ${n}; continuing: ${prompt.includes('## Continuing: part ')}\n`,
    );
  }
  if (n < parts) {
    const tick = () => {
      assistant(5);
      setTimeout(tick, 5);
    };
    tick();
  } else {
    assistant(1);
    const id = readFileSync(path.join('.incubator', 'state', 'active-ticket'), 'utf8').trim();
    const file = path.join('.incubator', 'tickets', `${id}.json`);
    const t = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
    emit({ type: 'result', subtype: 'success', total_cost_usd: Number(process.env.FAKE_AGENT_COST ?? 0.42), result: `Finished the plan in part ${n}.` });
  }
} else if (mode === 'runaway') {
```

### 2. The prompt section for a continuing part

Create `packages/core/prompts/handoff-continue.md` with exactly:

```markdown
---
name: handoff-continue
version: 1.0.0
---

An earlier session worked on this same plan and was stopped at a run limit before it finished. The Incubator committed its work on this branch; the commits are listed below.

1. First find out what is already done: read the files the plan names, and run `git status` and `git diff` against the commit named after "since" below, if those commands are open to you.
2. Continue with the work items that are not done yet. Do not redo or undo finished work, and do not rewrite the earlier commits.
3. As before, leave your work as uncommitted changes. The Incubator commits each part, and the owner reviews the whole branch before anything is pushed.
```

### 3. Core: the continuing section

In `packages/core/src/handoff.ts`:

Find:

```text
/**
 * Counts turns, tool calls and cost from a stream-json event stream (Claude-style `assistant`
```

Replace with:

```text
/** A part of the coding work already committed by the engine (plan 036). */
export interface CodePart {
  part: number;
  sha: string;
  tripped: string | null;
}

/** The section added to the prompt of a continuing part: what the earlier parts committed (plan 036). */
export function continuationText(c: {
  part: number;
  max: number;
  base: string | null;
  earlier: readonly CodePart[];
}): string {
  const list = c.earlier
    .map((e) => `- part ${e.part}: commit ${e.sha.slice(0, 12)}${e.tripped ? ` (stopped at ${e.tripped})` : ''}`)
    .join('\n');
  const since = c.base ? ` since ${c.base.slice(0, 12)}` : '';
  return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nEarlier parts, committed on this branch${since}:\n\n${list}\n`;
}

/**
 * Counts turns, tool calls and cost from a stream-json event stream (Claude-style `assistant`
```

### 4. Core: the report counts parts, and the checkpoint message

In `packages/core/src/finish.ts`:

Find:

```text
  turns: number;
  toolCalls: number;
  costUsd: number | null;
}
```

Replace with:

```text
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  /** How many parts the agent worked in (plan 036); absent in reports journaled before. */
  parts?: number;
}

/** The most parts one coding stage may take (plan 036); each part keeps the spec's run limits. */
export const MAX_CODE_PARTS = 5;

/** The checkpoint commit after a part stopped at a run limit (plan 036): local only, never the owner's commit. */
export function partMessage(
  opts: { title: string; part: number; tripped: string | null },
  runId: string,
): string {
  const head = subject('chore', `part ${opts.part} of up to ${MAX_CODE_PARTS}: ${opts.title}`);
  const why = `The coding agent stopped at a run limit (${opts.tripped ?? 'unknown'}); the next part continues from here.`;
  return `${head}\n\n${why}\n\nIncubator-Run: ${runId}\nIncubator-Part: code-${opts.part}\n`;
}
```

### 5. Core: the engine's imports

In `packages/core/src/engine.ts`:

Find:

```text
import {
  agentReport,
  draftMessage,
```

Replace with:

```text
import {
  MAX_CODE_PARTS,
  agentReport,
  draftMessage,
```

Find:

```text
  finishTrailer,
  type AgentChecks,
```

Replace with:

```text
  finishTrailer,
  partMessage,
  type AgentChecks,
```

Find:

```text
  buildHandoffArgv,
  handoffPrompt,
```

Replace with:

```text
  buildHandoffArgv,
  continuationText,
  handoffPrompt,
```

Find:

```text
  type HandoffPlan,
} from './handoff.js';
```

Replace with:

```text
  type HandoffPlan,
  type CodePart,
} from './handoff.js';
```

### 6. Core: the hand-off takes an optional continuation

In `packages/core/src/engine.ts`:

Find:

```text
  async prepareHandoff(
    runId: string,
    opts: { agent?: HandoffAgent } = {},
  ): Promise<{ plan: HandoffPlan; prompt: string; ticket: string | null; checks: AgentChecks }> {
```

Replace with:

```text
  async prepareHandoff(
    runId: string,
    opts: { agent?: HandoffAgent; continuation?: Parameters<typeof continuationText>[0] } = {},
  ): Promise<{ plan: HandoffPlan; prompt: string; ticket: string | null; checks: AgentChecks }> {
```

Find:

```text
      prompt: handoffPrompt(
        readFileSync(planPath, 'utf8'),
        external ? { checks: checks.commands } : undefined,
      ),
```

Replace with:

```text
      prompt:
        handoffPrompt(
          readFileSync(planPath, 'utf8'),
          external ? { checks: checks.commands } : undefined,
        ) + (opts.continuation ? `\n${continuationText(opts.continuation)}` : ''),
```

Find:

```text
    opts: {
      agent?: HandoffAgent;
      onEvent?: (chunk: string) => void;
```

Replace with:

```text
    opts: {
      agent?: HandoffAgent;
      /** A continuing part (plan 036): the prompt then lists what the earlier parts committed. */
      continuation?: Parameters<typeof continuationText>[0];
      onEvent?: (chunk: string) => void;
```

### 7. Core: the coding step works in parts

In `packages/core/src/engine.ts`:

Find:

```text
      let last = 0;
      const out = await this.launchHandoff(runId, {
        onProgress: (p) => {
          // why: a long run reports every turn; the journal keeps the first and then one a second.
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
      });
      this.record(runId, 'step.ok', { step: 'code.done', data: { ...agentReport(out), checks } });
```

Replace with:

```text
      // The agent works in parts (plan 036): a part stopped at a run limit is committed on the run's branch
      // (local only; the owner still decides the push), and the next part continues from there.
      const start = this.state(runId).steps['code.start']?.data as
        | { branch?: string | null; base?: string | null }
        | undefined;
      const base = start?.base;
      const earlier = this.codeParts(runId);
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
          ...(part > 1
            ? { continuation: { part, max: MAX_CODE_PARTS, base: base ?? null, earlier } }
            : {}),
        });
        if (agentReport(out).verdict !== 'ceiling' || part >= MAX_CODE_PARTS) break;
        // why: a part that changed nothing would spend the next part's limits the same way.
        if ((await git.status(dir)).length === 0) break;
        // why: without an identity there is nobody to commit as; the commit request then says what to set.
        if (!(await git.identity(dir))) break;
        // why: a checkpoint is only ever made on the run's own branch, never on a branch the owner switched to.
        if (!start?.branch?.startsWith('incubator/') || (await git.currentBranch(dir)) !== start.branch)
          break;
        // why: a Stop pressed as the limit tripped, or a plan already finished (cost arrives in the last event).
        if (this.#active.get(runId)?.controller.signal.aborted || out.ticketState === 'READY_FOR_TEST')
          break;
        await git.addAll(dir);
        const title = this.finishTitle(runId, this.state(runId));
        const sha = await git.commit(dir, partMessage({ title, part, tripped: out.tripped }, runId), {});
        const done: CodePart = { part, sha, tripped: out.tripped };
        this.record(runId, 'code.part', { ...done });
        earlier.push(done);
      }
      this.record(runId, 'step.ok', {
        step: 'code.done',
        data: { ...agentReport(out), checks, parts: earlier.length + 1 },
      });
```

### 8. Core: the parts already committed

In `packages/core/src/engine.ts`:

Find:

```text
  /** The review the owner needs at the commit request, computed from the folder as it is now. */
```

Replace with:

```text
  /** The coding parts already committed since coding last started (plan 036). */
  private codeParts(runId: string): CodePart[] {
    const entries = this.entries(runId);
    const from =
      entries.findLast((e) => e.type === 'step.ok' && e['step'] === 'code.start')?.seq ?? 0;
    return entries
      .filter((e) => e.type === 'code.part' && e.seq > from)
      .map((e) => ({
        part: Number(e['part']),
        sha: String(e['sha']),
        tripped: typeof e['tripped'] === 'string' ? e['tripped'] : null,
      }));
  }

  /** The review the owner needs at the commit request, computed from the folder as it is now. */
```

### 9. Test: the continuing section

In `packages/core/src/handoff.test.ts`:

Find:

```text
  cleanAgentText,
  handoffPrompt,
  HANDOFF_ALLOWED_TOOLS,
```

Replace with:

```text
  cleanAgentText,
  continuationText,
  handoffPrompt,
  HANDOFF_ALLOWED_TOOLS,
```

Find:

```text
import { agentReport } from './finish.js';
```

Replace with:

```text
import { MAX_CODE_PARTS, agentReport, partMessage } from './finish.js';
```

Find:

```text
  it('ships the external prompt versioned and byte-pinned', () => {
```

Replace with:

```text
  it('tells a continuing part what the earlier parts committed (plan 036)', () => {
    const p = loadPrompt('handoff-continue');
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.0.0');
    expect(MAX_CODE_PARTS).toBe(5);
    const text = continuationText({
      part: 3,
      max: MAX_CODE_PARTS,
      base: 'a'.repeat(40),
      earlier: [
        { part: 1, sha: 'b'.repeat(40), tripped: 'turns 151 > 150' },
        { part: 2, sha: 'c'.repeat(40), tripped: null },
      ],
    });
    expect(text.startsWith('## Continuing: part 3 of up to 5\n\n')).toBe(true);
    expect(text).toContain('leave your work as uncommitted changes');
    expect(text).toContain(`Earlier parts, committed on this branch since ${'a'.repeat(12)}:`);
    expect(text).toContain(`- part 1: commit ${'b'.repeat(12)} (stopped at turns 151 > 150)\n`);
    expect(text).toContain(`- part 2: commit ${'c'.repeat(12)}\n`);
    const msg = partMessage({ title: 'build Tallyho', part: 2, tripped: 'tool calls 401 > 400' }, 'r1');
    expect(msg).toBe(
      'chore: part 2 of up to 5: build Tallyho\n\nThe coding agent stopped at a run limit (tool calls 401 > 400); the next part continues from here.\n\nIncubator-Run: r1\nIncubator-Part: code-2\n',
    );
    // A checkpoint is never taken for the owner's finish commit.
    expect(msg).not.toContain('Incubator-Part: finish');
  });

  it('ships the external prompt versioned and byte-pinned', () => {
```

### 10. Test: coding in parts, end to end in a folder

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
    expect(s.parked).toMatchObject({ state: 'CODE', reason: 'checks_unenforceable' });
    expect(h.engine.entries(runId).some((e) => e.type === 'handoff.launch')).toBe(false);
  });
});
```

Replace with:

```text
    expect(s.parked).toMatchObject({ state: 'CODE', reason: 'checks_unenforceable' });
    expect(h.engine.entries(runId).some((e) => e.type === 'handoff.launch')).toBe(false);
  });
});

describe('coding in parts (plan 036)', () => {
  /** A git identity for the checkpoint commits (the hermetic default has none). */
  const withIdentity = () => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
  };
  const of = (h: Harness, runId: string, type: string) =>
    h.engine.entries(runId).filter((e) => e.type === type);
  const since = async (h: Harness, runId: string, dir: string) => {
    const base = (h.engine.state(runId).steps['code.start']!.data as { base: string }).base;
    return (await out(['log', '--format=%s', `${base}..HEAD`], dir)).split('\n').filter(Boolean);
  };

  it('commits a part stopped at a run limit and continues from it, until the agent finishes', async () => {
    withIdentity();
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(3);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1, 2]);
    const subjects = await since(h, runId, dir);
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toMatch(/^chore: part 2 of up to 5: /);
    expect(subjects[1]).toMatch(/^chore: part 1 of up to 5: /);
    expect(await out(['log', '-1', '--format=%B'], dir)).toContain(
      `Incubator-Run: ${runId}\nIncubator-Part: code-2`,
    );
    expect(await out(['show', '--name-only', '--format=', 'HEAD~1'], dir)).toContain('src/part-1.txt');
    // The first part was not told to continue; the later parts were.
    expect(readFileSync(path.join(dir, 'src', 'part-1.txt'), 'utf8')).toBe('part 1; continuing: false\n');
    expect(readFileSync(path.join(dir, 'src', 'part-2.txt'), 'utf8')).toBe('part 2; continuing: true\n');
    expect(readFileSync(path.join(dir, 'src', 'part-3.txt'), 'utf8')).toBe('part 3; continuing: true\n');
    // The last part is the owner's to review and commit, as before.
    const detail = await h.engine.finishDetail(runId);
    expect(detail!.files.map((f) => f.path)).toContain('src/part-3.txt');
    expect(detail!.files.map((f) => f.path)).not.toContain('src/part-1.txt');
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({ verdict: 'ready', parts: 3 });
  });

  it('stops after five parts and leaves the last one for the owner', async () => {
    withIdentity();
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    vi.stubEnv('FAKE_AGENT_PARTS', '99');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(5);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1, 2, 3, 4]);
    expect(await since(h, runId, dir)).toHaveLength(4);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({
      verdict: 'ceiling',
      parts: 5,
    });
    expect((await h.engine.finishDetail(runId))!.files.map((f) => f.path)).toContain('src/part-5.txt');
  });

  it('stops when a part changes nothing', async () => {
    withIdentity();
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    vi.stubEnv('FAKE_AGENT_PARTS', '99');
    vi.stubEnv('FAKE_AGENT_WRITES', '1');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    // Nothing is left uncommitted, so the run goes straight to the push request.
    expect(s.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1]);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({
      verdict: 'ceiling',
      parts: 2,
    });
  });

  it("never commits on a branch other than the run's own", async () => {
    withIdentity();
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    vi.stubEnv('FAKE_AGENT_SWITCH', '1');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    expect(await out(['branch', '--show-current'], dir)).toBe('elsewhere');
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(of(h, runId, 'code.part')).toHaveLength(0);
    expect(await out(['log', '--format=%s', '-1'], dir)).not.toMatch(/^chore: part /);
  });

  it('does not continue a part that finished its ticket and then went over the cost limit', async () => {
    withIdentity();
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    vi.stubEnv('FAKE_AGENT_PARTS', '1');
    vi.stubEnv('FAKE_AGENT_COST', '999');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(of(h, runId, 'code.part')).toHaveLength(0);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({
      verdict: 'ceiling',
      parts: 1,
    });
  });

  it('does not commit without a git identity: one part, left for the owner', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(of(h, runId, 'code.part')).toHaveLength(0);
    expect(await since(h, runId, dir)).toHaveLength(0);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({
      verdict: 'ceiling',
      parts: 1,
    });
  });
});
```

### 11. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/fixtures/handoff/fake-agent.mjs packages/core/prompts/handoff-continue.md packages/core/src/handoff.ts packages/core/src/finish.ts packages/core/src/engine.ts packages/core/src/handoff.test.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                            | Marker                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `packages/core/fixtures/handoff/fake-agent.mjs` | `} else if (mode === 'parts') {`                                      |
| `packages/core/prompts/handoff-continue.md`     | `name: handoff-continue`                                              |
| `packages/core/src/handoff.ts`                  | `export function continuationText(c: {`                               |
| `packages/core/src/finish.ts`                   | `export const MAX_CODE_PARTS = 5;`                                    |
| `packages/core/src/engine.ts`                   | `this.record(runId, 'code.part', { ...done });`                       |
| `packages/core/src/handoff.test.ts`             | `tells a continuing part what the earlier parts committed (plan 036)` |
| `packages/core/src/folder-runs.test.ts`         | `describe('coding in parts (plan 036)', () => {`                      |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts packages/core/src/folder-runs.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
the unit tests pass, including "tells a continuing part what the earlier parts committed (plan 036)" and the six tests under "coding in parts (plan 036)"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                          | Why                                                                                       | Mechanical check                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A checkpoint is mistaken for the owner's finish commit        | `commitStep` takes a HEAD whose message has `Incubator-Part: finish` as already committed | the handoff test asserts the exact checkpoint message, with `Incubator-Part: code-2` and without `finish`; the folder test then still parks at `needs_commit` |
| The continuing part gets the plain prompt                     | the continuation must reach `prepareHandoff` through `launchHandoff`                      | the fake agent writes whether its prompt has `## Continuing: part `; the folder test expects `false` for part 1 and `true` for parts 2 and 3                  |
| The loop never ends, or ends after one part                   | four exits: verdict, nothing changed, no identity, the cap                                | one folder test per exit: finishes in 3, caps at 5, stops at 2 when part 2 writes nothing, stops at 1 without an identity                                     |
| A checkpoint lands on the owner's own branch                  | the owner may switch branches while a run is parked                                       | the loop breaks unless the folder is on the run's `incubator/` branch; the branch-switch test expects one launch and no `code.part`                           |
| The last part is committed too, so the owner never reviews it | only a part stopped at a limit and followed by another part is committed                  | the folder tests assert the last part's file is in `finishDetail().files` and the commit count is parts minus one                                             |
| Parts are counted across a later restart of coding            | `codeParts` must count only since the latest `code.start`                                 | `codeParts` filters `code.part` entries after the last `code.start` step (plan 037 relies on it; reviewed there)                                              |
| The agent is told to commit                                   | its prompts forbid git writes                                                             | `handoff-continue.md` says to leave the work uncommitted; the handoff test asserts that sentence                                                              |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | A real update run stopped at a run limit with most of its plan undone; the owner asked for the agent to continue in parts with checkpoint commits, up to 5 parts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | CLOSED |
| 2     | Adversarial review (Opus 5.5, applied literally in an isolated copy; quick gate green, 7 of 8 mutations caught): FIX-FIRST. Must-fix: a checkpoint could land on a branch the owner switched to (main included); the loop now commits only on the run's own `incubator/` branch, with a test. Also: the continuing prompt points `git diff` at the base commit; the loop also stops on a Stop that raced the limit and on a ticket already `READY_FOR_TEST`; the stall test asserts the push request. Left for plan 038: the owner's view of a multi-part run (the Coding copy, the commit request listing the checkpoint commits, the RunLog line). Left as is: a crash between a checkpoint commit and its journal entry renumbers the next part (bounded, nothing lost); a CLI-enforced `--max-turns` (not offered by Claude's probe today) would end parts as `failed`, not `ceiling` | CLOSED |
| 3     | Second pass (Opus 5.5, applied literally on 6496283): all findings CLOSED in code; the READY_FOR_TEST break had no test (its mutation survived), so a test now runs a part that finishes its ticket and reports a cost over the limit (FAKE_AGENT_COST), and expects no checkpoint and no second launch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | CLOSED |
