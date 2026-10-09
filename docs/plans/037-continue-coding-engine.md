# Plan 037: continue coding a finished folder run (engine)

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 12 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 036 (coding in parts). Its code must already be in `packages/core/src/engine.ts` and `packages/core/src/handoff.ts`: check that `grep -c "plan 036" packages/core/src/engine.ts` prints a number above 0 before you start, and stop if it does not.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A folder run whose coding agent stopped before finishing the plan ends like any other. The owner commits and pushes what it did, and the run is done. A real update run (rolling-schedule, seven requests) was pushed as a pull request with most of its plan undone. The owner wants to **continue coding** such a run in place, on the same branch, so the next push updates the same pull request.

This plan adds the engine side: `engine.continueCoding(runId)`. The app button and the `--continue` CLI option come in plan 038. The steps are:

1. **Checks.** It accepts only a finished folder run. The run must not be cancelled, and its last coding stage (`code.done`) must not have ended `ready`. The folder must be on the branch the run committed to, and it must be clean.
2. **Reopening.** It records `code.continue {branch, from, verdict, tripped}` and enters CODE. A reducer case reopens the run: `done: false`. It also drops the steps the next stage redoes: `code.start`, `code.done`, `finish.commit`, and the adopter's `finish.push` and `finish.pr` step records.
3. **Coding again.** The coding stage starts again (plan 036's parts loop). Its first part is told an earlier session's work is already committed. It does not create a new `incubator/build-*` branch for a new-solution run; it stays on the run's branch.
4. **Owner answers are not reused.** The owner's earlier commit approval (`finish.approve`) and push decision (`finish.push` journal entries) belong to the earlier code, so they must not be reused. Today the lookups use `findLast` over the whole journal: a continued run would commit and push with no question asked. Every lookup now only counts answers recorded after the latest `code.continue`.
5. **Finish commit check.** `commitStep` treats a HEAD carrying the `Incubator-Part: finish` trailer as "the owner's commit already happened" (crash recovery). After a continue, HEAD _is_ the earlier finish commit. So that check now also requires HEAD to differ from the stage's base.
6. **The pull request.** The push uses `Adopter.publish` again. Its `finish.push`/`finish.pr` step records were dropped, so it pushes `HEAD:refs/heads/<branch>` (a fast-forward) and calls `openPr`. GitHub answers 422 for a second PR on the same head, and the real adapter then returns the open one (`packages/git/src/octokit.ts`). The fake GitHub does the same (`packages/git/src/github.ts`), so an open pull request gets the new commits and no new one is opened. If the earlier pull request was merged or closed meanwhile, GitHub opens a new one. The open pull request's title and body are not rewritten (out of scope).
7. **The branch at coding time.** The owner may switch the folder to another branch between continuing and coding (for example after a stop). When the continued stage starts coding, it checks the folder is still on the branch `continueCoding` recorded, and parks `wrong_branch` otherwise.
8. **What the commit request shows.** The finish detail's approved message, its live progress and its pull request link come only from entries after the latest `code.continue`, so a continued run kept local does not show the old pull request as its own.

## Work items

### 1. Reducer: continuing reopens the run

In `packages/core/src/state.ts`:

Find:

```text
const REFRESHED_STEPS: readonly string[] = ['folder.base', 'adopt.acquire', 'enhance.summary'];
```

Replace with:

```text
const REFRESHED_STEPS: readonly string[] = ['folder.base', 'adopt.acquire', 'enhance.summary'];

/** The steps "continue coding" runs again (plan 037): coding, then the owner's commit, push and pull request. */
const CONTINUED_STEPS: readonly string[] = [
  'code.start',
  'code.done',
  'finish.commit',
  'finish.push',
  'finish.pr',
];
```

Find:

```text
      case 'repo.refresh':
```

Replace with:

```text
      case 'code.continue':
        // why: continue coding (plan 037) reopens a finished folder run at CODE; the commit and the push are asked again.
        s = {
          ...s,
          // why: a crash before the following state.enter must not leave a run at DONE that is not done.
          state: 'CODE',
          done: false,
          failure: null,
          stopped: null,
          steps: Object.fromEntries(
            Object.entries(s.steps).filter(([id]) => !CONTINUED_STEPS.includes(id)),
          ),
        };
        break;
      case 'repo.refresh':
```

### 2. Engine: where the latest continue is

In `packages/core/src/engine.ts`:

Find:

```text
  private since(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'repo.refresh')?.seq ?? 0;
  }
```

Replace with:

```text
  private since(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'repo.refresh')?.seq ?? 0;
  }

  /** The seq of the latest "continue coding" (plan 037), or 0: the owner's commit and push answers before it are spent. */
  private continuedAt(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'code.continue')?.seq ?? 0;
  }

  /** The commit a continued run started from, and why its earlier coding stopped (plan 037), or null. */
  private continuedFrom(
    runId: string,
  ): { sha: string; since: string | null; tripped: string | null } | null {
    const e = this.entries(runId).findLast((x) => x.type === 'code.continue');
    if (!e || typeof e['from'] !== 'string') return null;
    return {
      sha: e['from'],
      since: typeof e['since'] === 'string' ? e['since'] : null,
      tripped: typeof e['tripped'] === 'string' ? e['tripped'] : null,
    };
  }
```

### 3. Engine: the commit request shows only a fresh approval

In `packages/core/src/engine.ts`:

Find:

```text
    const approved = this.entries(runId).findLast((e) => e.type === 'finish.approve');
    const progress = this.entries(runId).findLast((e) => e.type === 'handoff.progress');
    const pr = this.entries(runId).findLast((e) => e.type === 'finish.summary')?.['pr'] as
      { number: number; url: string } | undefined;
```

Replace with:

```text
    // why: answers and outcomes from before "continue coding" (plan 037) were about the earlier code.
    const after = this.continuedAt(runId);
    const approved = this.entries(runId).findLast(
      (e) => e.type === 'finish.approve' && e.seq > after,
    );
    const progress = this.entries(runId).findLast(
      (e) => e.type === 'handoff.progress' && e.seq > after,
    );
    const pr = this.entries(runId).findLast(
      (e) => e.type === 'finish.summary' && e.seq > after,
    )?.['pr'] as { number: number; url: string } | undefined;
```

### 4. Engine: the commit step asks again after a continue

In `packages/core/src/engine.ts`:

Find:

```text
      if ((await git.headMessage(dir))?.includes(finishTrailer(runId))) {
```

Replace with:

```text
      // why: after "continue coding" (plan 037) HEAD starts as the earlier finish commit; only a newer one counts.
      if (head !== start.base && (await git.headMessage(dir))?.includes(finishTrailer(runId))) {
```

Find:

```text
      const approval = this.entries(runId).findLast((e) => e.type === 'finish.approve');
```

Replace with:

```text
      const after = this.continuedAt(runId);
      const approval = this.entries(runId).findLast(
        (e) => e.type === 'finish.approve' && e.seq > after,
      );
```

### 5. Engine: the push step asks again after a continue

In `packages/core/src/engine.ts`:

Find:

```text
    const decision = this.entries(runId).findLast((e) => e.type === 'finish.push');
```

Replace with:

```text
    const after = this.continuedAt(runId);
    const decision = this.entries(runId).findLast(
      (e) => e.type === 'finish.push' && e.seq > after,
    );
```

### 6. Engine: a continued new-solution run stays on its branch

In `packages/core/src/engine.ts`:

Find:

```text
        let branch = await git.currentBranch(dir);
        // A new solution is coded on its own branch: the staging branch deploys.
        if (s.input.kind === 'new') {
```

Replace with:

```text
        let branch = await git.currentBranch(dir);
        // A continued run (plan 037) codes only on the branch continueCoding checked; the owner may have switched since.
        const continued = this.entries(runId).findLast((e) => e.type === 'code.continue');
        if (continued && branch !== continued['branch'])
          throw new ParkError(
            'wrong_branch',
            `the folder is on ${branch ?? 'a detached HEAD'}, not the run's branch ${String(continued['branch'])}: check it out, then resume`,
          );
        // A new solution is coded on its own branch: the staging branch deploys. A continued run stays where it is.
        if (s.input.kind === 'new' && !continued) {
```

### 7. Engine: the first part of a continued run is told what came before

In `packages/core/src/engine.ts`:

Find:

```text
      const earlier = this.codeParts(runId);
      let out: HandoffOutcome;
```

Replace with:

```text
      const earlier = this.codeParts(runId);
      // A continued run (plan 037): the work before it is committed, and even its first part is told so.
      const resumed = this.continuedFrom(runId);
      let out: HandoffOutcome;
```

Find:

```text
          ...(part > 1
            ? { continuation: { part, max: MAX_CODE_PARTS, base: base ?? null, earlier } }
            : {}),
```

Replace with:

```text
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
```

### 8. Engine: continue coding

In `packages/core/src/engine.ts`:

Find:

```text
  /** REVIEW → APPROVED, optionally with a user-edited spec (revalidated). */
```

Replace with:

```text
  /**
   * Continue coding (plan 037): a finished folder run whose agent did not finish the plan goes back to CODE on the
   * same branch. Its parts continue from the folder as it is now; the owner reviews the commit and the push again,
   * and the push updates the same pull request.
   */
  async continueCoding(runId: string): Promise<void> {
    const s = this.state(runId);
    if (!s.input.dir || !this.deps.publish)
      throw new PolicyError(`run ${runId} did not code in a folder`, { code: 'not_folder' });
    if (!s.done || s.cancelled)
      throw new PolicyError(`run ${runId} ${s.cancelled ? 'was cancelled' : 'is not finished'}`, {
        code: 'not_done',
      });
    const agent = s.steps['code.done']?.data as AgentReport | undefined;
    if (!agent)
      throw new PolicyError(`run ${runId} never reached coding`, { code: 'not_coded' });
    if (agent.verdict === 'ready')
      throw new PolicyError(`the agent finished the plan of run ${runId}: there is nothing to continue`, {
        code: 'finished',
      });
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const dir = this.runDir(s);
    const git = this.deps.publish.git;
    const committed = s.steps['finish.commit']?.data as { branch?: string | null } | undefined;
    const start = s.steps['code.start']?.data as { branch?: string | null } | undefined;
    const branch = committed?.branch ?? start?.branch ?? null;
    const current = await git.currentBranch(dir);
    if (!branch || current !== branch)
      throw new PolicyError(
        `the folder is on ${current ?? 'a detached HEAD'}, not the run's branch ${branch ?? '(unknown)'}: check it out, then continue (if it was deleted after a merge, start a new update run instead)`,
        { code: 'wrong_branch' },
      );
    if ((await git.status(dir)).length > 0)
      throw new PolicyError(
        'the folder has uncommitted changes: commit or stash them first, then continue',
        { code: 'dirty_tree' },
      );
    const first = this.entries(runId).find(
      (e) => e.type === 'step.ok' && e['step'] === 'code.start',
    )?.['data'] as { base?: string | null } | undefined;
    this.record(runId, 'code.continue', {
      branch,
      from: await git.headSha(dir),
      since: first?.base ?? null,
      verdict: agent.verdict,
      tripped: agent.tripped,
    });
    this.enter(runId, 'CODE');
  }

  /** REVIEW → APPROVED, optionally with a user-edited spec (revalidated). */
```

### 9. Core: the continuing section names the earlier session's commit

In `packages/core/src/handoff.ts`:

Find:

```text
  earlier: readonly CodePart[];
}): string {
```

Replace with:

```text
  earlier: readonly CodePart[];
  /** A continued run (plan 037): the commit the earlier coding session's work ends at. */
  before?: { sha: string; since: string | null; tripped: string | null };
}): string {
```

Find:

```text
  const since = c.base ? ` since ${c.base.slice(0, 12)}` : '';
```

Replace with:

```text
  const since = c.base ? ` since ${c.base.slice(0, 12)}` : '';
  if (c.before && c.earlier.length === 0) {
    const why = c.before.tripped ? ` (it stopped at ${c.before.tripped})` : '';
    const from = c.before.since ? ` since ${c.before.since.slice(0, 12)}` : '';
    return `## Continuing: part ${c.part} of up to ${c.max}\n\n${loadPrompt('handoff-continue').body}\n\nThe earlier coding session's work is committed on this branch${from}; it ends at commit ${c.before.sha.slice(0, 12)}${why}.\n`;
  }
```

### 10. Test: the continuing section for a continued run

In `packages/core/src/handoff.test.ts`:

Find:

```text
  it('ships the external prompt versioned and byte-pinned', () => {
```

Replace with:

```text
  it('tells the first part of a continued run where the earlier session ended (plan 037)', () => {
    const text = continuationText({
      part: 1,
      max: MAX_CODE_PARTS,
      base: 'd'.repeat(40),
      earlier: [],
      before: { sha: 'd'.repeat(40), since: 'e'.repeat(40), tripped: 'turns 151 > 150' },
    });
    expect(text.startsWith('## Continuing: part 1 of up to 5\n\n')).toBe(true);
    expect(text).toContain(
      `The earlier coding session's work is committed on this branch since ${'e'.repeat(12)}; it ends at commit ${'d'.repeat(12)} (it stopped at turns 151 > 150).`,
    );
    expect(text).not.toContain('Earlier parts, committed on this branch');
  });

  it('ships the external prompt versioned and byte-pinned', () => {
```

### 11. Test: continue coding, end to end in a folder

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
describe('coding in parts (plan 036)', () => {
```

Replace with:

```text
describe('continue coding (plan 037)', () => {
  const of = (h: Harness, runId: string, type: string) =>
    h.engine.entries(runId).filter((e) => e.type === type);
  const prs = (h: Harness, runId: string) =>
    of(h, runId, 'finish.summary').map((e) => (e['pr'] as { number: number }).number);

  it('continues a run stopped at a limit on the same branch, asks for the commit and push again, and updates the same pull request', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    // No git identity yet: one part, stopped at a limit, left for the owner.
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    let r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    h.engine.submitPush(runId, 'push');
    r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.done).toBe(true);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({ verdict: 'ceiling' });
    const branch = await out(['branch', '--show-current'], dir);
    expect(branch).toBe(BUILD);

    // Refused: a dirty folder, and a folder on another branch.
    writeFileSync(path.join(dir, 'scratch.txt'), 'x');
    await expect(h.engine.continueCoding(runId)).rejects.toMatchObject({ code: 'dirty_tree' });
    rmSync(path.join(dir, 'scratch.txt'));
    await git(['switch', '-q', '-c', 'elsewhere'], dir);
    await expect(h.engine.continueCoding(runId)).rejects.toMatchObject({ code: 'wrong_branch' });
    await git(['switch', '-q', BUILD], dir);

    // A day later: a continued new-solution run must not move to a new dated branch.
    h.clock.advance(86_400_000);
    await h.engine.continueCoding(runId);
    expect(h.engine.state(runId)).toMatchObject({ state: 'CODE', done: false });
    // The earlier pull request is not shown as this stage's own until it is pushed again.
    expect((await h.engine.finishDetail(runId))!.pr).toBeNull();
    r = await h.engine.resume(runId, new DefaultsPrompter());
    // The earlier commit approval is not reused: the owner is asked again.
    expect(r.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(await out(['branch', '--show-current'], dir)).toBe(BUILD);
    // The continued stage's first part was told about the earlier work; it stopped, was checkpointed, and part 2 finished.
    expect(readFileSync(path.join(dir, 'src', 'part-2.txt'), 'utf8')).toBe('part 2; continuing: true\n');
    expect(readFileSync(path.join(dir, 'src', 'part-3.txt'), 'utf8')).toBe('part 3; continuing: true\n');
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1]);
    h.engine.submitCommit(runId, { action: 'commit' });
    r = await h.engine.resume(runId, new DefaultsPrompter());
    // The earlier push decision is not reused either.
    expect(r.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    h.engine.submitPush(runId, 'push');
    r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.done).toBe(true);
    expect(h.engine.state(runId).steps['code.done']!.data).toMatchObject({ verdict: 'ready' });
    // The same pull request, and the branch on GitHub is at the new commits.
    expect(prs(h, runId)).toEqual([1, 1]);
    expect(await h.github.getBranchSha({ owner: 'octo', name: 'tallyho' }, BUILD)).toBe(
      await out(['rev-parse', 'HEAD'], dir),
    );
    // A finished plan has nothing to continue.
    await expect(h.engine.continueCoding(runId)).rejects.toMatchObject({ code: 'finished' });
  });

  it('asks for the commit again when the continued stage finishes in one part (HEAD is the earlier finish commit)', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    await h.engine.resume(runId, new DefaultsPrompter());
    h.engine.submitPush(runId, 'skip');
    expect((await h.engine.resume(runId, new DefaultsPrompter())).done).toBe(true);
    vi.stubEnv('FAKE_AGENT_PARTS', '2');
    await h.engine.continueCoding(runId);
    const r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'code.part')).toHaveLength(0);
    expect((await h.engine.finishDetail(runId))!.message).toMatch(/^feat: /);
  });

  it('parks instead of coding when the folder left the run branch after continuing', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    await h.engine.resume(runId, new DefaultsPrompter());
    h.engine.submitPush(runId, 'skip');
    await h.engine.resume(runId, new DefaultsPrompter());
    await h.engine.continueCoding(runId);
    await git(['switch', '-q', '-c', 'elsewhere'], dir);
    const r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.parked).toMatchObject({ state: 'CODE', reason: 'wrong_branch' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
  });

  it('counts the continued stage parts from its own start', async () => {
    const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'gitcfg ')), 'gitconfig');
    writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    vi.stubEnv('FAKE_AGENT_PARTS', '99');
    vi.stubEnv('FAKE_AGENT_WRITES', '1');
    const h = harness();
    const dir = freshFolder();
    const { runId, s } = await newSolution(h, dir);
    // One checkpoint, then a part that changed nothing: straight to the push request.
    expect(s.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    h.engine.submitPush(runId, 'skip');
    await h.engine.resume(runId, new DefaultsPrompter());
    vi.stubEnv('FAKE_AGENT_WRITES', '99');
    vi.stubEnv('FAKE_AGENT_PARTS', '3');
    await h.engine.continueCoding(runId);
    await h.engine.resume(runId, new DefaultsPrompter());
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1, 1]);
  });

  it('refuses a run that is not finished, and one that did not code in a folder', async () => {
    vi.stubEnv('FAKE_AGENT_MODE', 'parts');
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    await expect(h.engine.continueCoding(runId)).rejects.toMatchObject({ code: 'not_done' });
    const scaffold = h.engine.startFromSpec(spec(), { kind: 'new', surface: 'test', specOnly: true });
    await expect(h.engine.continueCoding(scaffold)).rejects.toMatchObject({ code: 'not_folder' });
  });
});

describe('coding in parts (plan 036)', () => {
```

Also in `packages/core/src/folder-runs.test.ts`, find:

```text
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
```

Replace with:

```text
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
```

### 12. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/state.ts packages/core/src/engine.ts packages/core/src/handoff.ts packages/core/src/handoff.test.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                    | Marker                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `packages/core/src/state.ts`            | `case 'code.continue':`                                                              |
| `packages/core/src/engine.ts`           | `async continueCoding(runId: string): Promise<void> {`                               |
| `packages/core/src/handoff.ts`          | `before?: { sha: string; since: string \| null; tripped: string \| null };`          |
| `packages/core/src/handoff.test.ts`     | `tells the first part of a continued run where the earlier session ended (plan 037)` |
| `packages/core/src/folder-runs.test.ts` | `describe('continue coding (plan 037)', () => {`                                     |

A `\|` in a marker is Markdown table escaping for a plain `|`.

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/handoff.test.ts packages/core/src/folder-runs.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
the unit tests pass, including "tells the first part of a continued run where the earlier session ended (plan 037)" and the five tests under "continue coding (plan 037)"; the plan 036 tests still pass
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                           | Why                                                                                    | Mechanical check                                                                                                                                                            |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A continued run commits or pushes with no question                             | the commit and push lookups used `findLast` over the whole journal                     | the folder test expects `needs_commit` and then `needs_push` again after the continue                                                                                       |
| The earlier finish commit is taken as the new one                              | `commitStep` reads the `Incubator-Part: finish` trailer on HEAD as "already committed" | the test "asks for the commit again when the continued stage finishes in one part" expects `needs_commit` with a drafted `feat:` message                                    |
| The old pull request is shown as this stage's own                              | `finishDetail` read `finish.summary` over the whole journal                            | the main test expects `pr: null` right after continuing                                                                                                                     |
| The push silently does nothing                                                 | the reducer must drop the adopter's `finish.push` and `finish.pr` step records         | the main test compares the branch on the fake GitHub with the folder's HEAD                                                                                                 |
| The agent codes on a branch the owner switched to after continuing             | `continueCoding` checks the branch once                                                | the test "parks instead of coding when the folder left the run branch" expects `wrong_branch` and no second launch                                                          |
| Parts are counted across stages                                                | `codeParts` must count from the latest `code.start`                                    | the test "counts the continued stage parts from its own start" expects `[1, 1]`                                                                                             |
| A second pull request is opened                                                | the push opens a PR again after the step records are dropped                           | the test expects the same PR number twice (`[1, 1]`)                                                                                                                        |
| A continued new-solution run moves to a new `incubator/build-*` branch         | `codeStep` checks out a dated branch for new runs                                      | the main test advances the clock a day before continuing and still expects `BUILD`                                                                                          |
| The continued stage's first part redoes everything                             | without the continuation it gets the plain prompt                                      | the fake agent writes `continuing: true` only when its prompt has `## Continuing: part `; the test expects it on part 2's file, written by the continued stage's first part |
| Continue runs on a dirty folder or a switched branch                           | the owner's edits would be swept into a checkpoint commit                              | the test expects `dirty_tree` and `wrong_branch` refusals                                                                                                                   |
| Continue is offered for a finished plan, an unfinished run or a non-folder run | it only makes sense after a stopped agent                                              | the tests expect `finished`, `not_done` and `not_folder`                                                                                                                    |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner asked to continue a finished run whose agent stopped at a limit, in place, so the push updates the same pull request; plan 036's review noted that parts must be counted from the latest coding start, which this plan exercises                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | CLOSED |
| 2     | Adversarial review (Opus 5.5, 036 then 037 applied literally on 1bc27ae, probes P1 to P5, 12 mutations): FIX-FIRST. Must-fix: the old pull request was shown after a continue kept local; a crash between continuing and entering CODE left the run stuck; the branch was not re-checked when coding started; five mutations survived (the trailer guard, the dated-branch guard, the dropped push/pr steps, the approved-message scope, the parts scope); the first continued part could not find the original base. All folded: scoped lookups, `state: 'CODE'` in the reducer, a `wrong_branch` park, four more test assertions and three more tests, `since` recorded on continue. Left: the open pull request's text is not rewritten; a merged or closed one leads to a new pull request; the portfolio card may show the run as done while it codes | CLOSED |
