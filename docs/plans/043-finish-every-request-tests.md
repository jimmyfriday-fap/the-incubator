# Plan 043: tests that an update run verifies its own work and keeps going until every request is done

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 6 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plans 041 and 042. Before you start, check that `packages/core/src/check-run.ts` exists and that `packages/core/src/engine.ts` contains `'code.verify'`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" block makes a new file with exactly that content.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** Plan 042 made an update run verify its own work and keep going. Nothing yet proves it end to end. This plan adds a stand-in agent mode (`steps`), a two-request fixture, and the tests that drive the whole loop through the real engine: the Incubator's own check runs, the baseline, the next part's prompt, the checkpoint commits and the verdict.

How the pieces fit:

- The seeded repository is the `bare-node` analyzer fixture plus three small scripts, `scripts/pass.mjs`, `scripts/fail.mjs` and `scripts/verify.mjs`. The tests approve them as check commands (`node scripts/pass.mjs`, which ADR-025 allows because `node` has a subcommand).
- The stand-in agent writes `src/step-N.txt` on its Nth launch and marks tickets `READY_FOR_TEST` the way the external prompt asks. It saves each prompt it was given as `.incubator/state/prompt-N.txt`, a git-excluded folder, so tests can read what the next part was told.
- Control comes from the stand-in's environment (`FAKE_AGENT_MARKS`, `FAKE_AGENT_WRITES`, `FAKE_AGENT_TICKETS`), the same style as the existing `parts` mode.

## Work items

### 1. The stand-in agent: its header comment

In `packages/core/fixtures/handoff/fake-agent.mjs`:

Find:

```text
// reports a large cost.
```

Replace with:

```text
// reports a large cost; steps works like an update run's agent (plan 043).
```

### 2. The stand-in agent: the `steps` mode

In `packages/core/fixtures/handoff/fake-agent.mjs`:

Find:

```text
} else if (mode === 'runaway') {
```

Replace with:

```text
} else if (mode === 'steps') {
  // An update run's agent (plan 043). Each launch saves the prompt it was given, writes the next
  // src/step-N.txt (only for the first FAKE_AGENT_WRITES launches), and marks the next FAKE_AGENT_MARKS
  // unmarked tickets READY_FOR_TEST, in the order of FAKE_AGENT_TICKETS, as the external prompt asks.
  const marks = Number(process.env.FAKE_AGENT_MARKS ?? 1);
  const writes = Number(process.env.FAKE_AGENT_WRITES ?? 99);
  mkdirSync(path.join('.incubator', 'state'), { recursive: true });
  let n = 1;
  while (existsSync(path.join('.incubator', 'state', `prompt-${n}.txt`))) n++;
  writeFileSync(path.join('.incubator', 'state', `prompt-${n}.txt`), prompt);
  if (n <= writes) {
    mkdirSync('src', { recursive: true });
    writeFileSync(path.join('src', `step-${n}.txt`), `step ${n}\n`);
  }
  let left = marks;
  for (const id of (process.env.FAKE_AGENT_TICKETS ?? '').split(',').filter(Boolean)) {
    const file = path.join('.incubator', 'tickets', `${id}.json`);
    const t = JSON.parse(readFileSync(file, 'utf8'));
    if (left <= 0 || t.state === 'READY_FOR_TEST') continue;
    left--;
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
  }
  assistant(1);
  emit({ type: 'result', subtype: 'success', total_cost_usd: 0.42, result: `Finished step ${n}.` });
} else if (mode === 'runaway') {
```

### 3. The two-request fixture for the language model

Create `packages/core/fixtures/enhance/two-requests/narrative.md` with exactly:

```text
Let kitchen staff export the day's orders as a CSV file, and filter that export by date.
```

Create `packages/core/fixtures/enhance/two-requests/00-AnalysisSummary.json` with exactly:

```text
{
  "schemaName": "AnalysisSummary",
  "note": "a grounded summary of the bare-node fixture",
  "response": {
    "summary": "order-desk is a small Express service that takes café orders over HTTP and exposes them on a single /orders route. It has one test file and no CI.",
    "strengths": [
      "Small, single-purpose module",
      "A test runner (vitest) is already configured"
    ],
    "risks": [
      "Only one route is covered by tests",
      "No CI workflow was detected"
    ],
    "openQuestions": [
      "Is the orders list paginated, and how large can it get?"
    ]
  }
}
```

Create `packages/core/fixtures/enhance/two-requests/01-DiscoveryTurn.json` with exactly:

```text
{
  "schemaName": "DiscoveryTurn",
  "note": "plan 043: an update plan with two requests, so a run has more than one ticket",
  "response": {
    "draftSpec": {
      "intent": {
        "coreFeatures": [
          {
            "id": "export-orders",
            "summary": "Export the day's orders as CSV from the existing /orders route",
            "lane": "enhancement/existing"
          },
          {
            "id": "export-filter",
            "summary": "Filter the CSV export of orders by date on the existing /orders route",
            "lane": "enhancement/existing"
          }
        ]
      },
      "decisions": [
        {
          "key": "intent.coreFeatures",
          "question": "Which existing behaviour changes",
          "answer": "GET /orders gains a CSV export with a date filter",
          "source": "inferred"
        }
      ]
    },
    "questions": [],
    "done": true
  }
}
```

Create `packages/core/fixtures/enhance/two-requests/02-ReviewSummary.json` with exactly:

```text
{
  "schemaName": "ReviewSummary",
  "note": "a plain-English brief of the two-requests plan, served at REVIEW",
  "response": {
    "headline": "Kitchen staff will be able to export the day's orders as a CSV file, and filter it by date.",
    "changes": [
      "Add an export button to the orders list that downloads the day's orders as a CSV file.",
      "Let the export be limited to one date."
    ],
    "approach": "A coding assistant makes the edits in a working copy of your repository, in the part of the app that serves the orders list. Nothing in your repository changes until you approve and later choose to commit; pushing to GitHub is a separate question.",
    "notIncluded": ["Exporting other lists."],
    "watchFor": ["Only one route is covered by tests, so check the export by hand."]
  }
}
```

### 4. The tests: imports

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
import {
  chmodSync,
  existsSync,
```

Replace with:

```text
import {
  chmodSync,
  cpSync,
  existsSync,
```

### 5. The tests: an update run keeps going until every request is done

Add at the end of `packages/core/src/folder-runs.test.ts`, after one blank line:

```text
describe('an update run keeps going until every request is done (plan 043)', () => {
  const ORDERS = 'E-export-orders';
  const FILTER = 'E-export-filter';
  const FILTER_SUMMARY = 'Filter the CSV export of orders by date on the existing /orders route';
  const of = (h: Harness, runId: string, type: string) =>
    h.engine.entries(runId).filter((e) => e.type === type);
  const done = (h: Harness, runId: string) => h.engine.state(runId).steps['code.done']!.data;
  const prompt = (dir: string, n: number) =>
    readFileSync(path.join(dir, '.incubator', 'state', `prompt-${n}.txt`), 'utf8');
  const ticket = (dir: string, id: string) =>
    (
      JSON.parse(readFileSync(path.join(dir, '.incubator', 'tickets', `${id}.json`), 'utf8')) as {
        state: string;
      }
    ).state;

  /** The bare-node fixture plus three check scripts: pass, fail, and one that needs the second step. */
  async function seeded() {
    vi.stubEnv('FAKE_AGENT_MODE', 'steps');
    vi.stubEnv('FAKE_AGENT_TICKETS', `${ORDERS},${FILTER}`);
    const h = harness({ llm: { dir: enhanceFixtureDir('two-requests') } });
    const { ref, dir } = await seedExistingRepo(h.github, 'bare-node', (d) => {
      cpSync(path.join(analyzerFixtures, 'bare-node'), d, {
        recursive: true,
        filter: (s) => !s.endsWith('expected-gap-report.json'),
      });
      mkdirSync(path.join(d, 'scripts'));
      writeFileSync(path.join(d, 'scripts', 'pass.mjs'), 'process.exit(0);\n');
      writeFileSync(
        path.join(d, 'scripts', 'fail.mjs'),
        "console.error('fail: broken before the agent started');\nprocess.exit(1);\n",
      );
      // Passes on the untouched repository, fails once step 1 exists without step 2.
      writeFileSync(
        path.join(d, 'scripts', 'verify.mjs'),
        [
          "import { existsSync } from 'node:fs';",
          "if (existsSync('src/step-1.txt') && !existsSync('src/step-2.txt')) {",
          "  console.error('verify: src/step-2.txt is missing');",
          '  process.exit(1);',
          '}',
          '',
        ].join('\n'),
      );
      // A check that fails as soon as the agent has written anything, and never passes after.
      writeFileSync(
        path.join(d, 'scripts', 'never.mjs'),
        [
          "import { existsSync } from 'node:fs';",
          "if (existsSync('src/step-1.txt')) {",
          "  console.error('never: still failing');",
          '  process.exit(1);',
          '}',
          '',
        ].join('\n'),
      );
      return Promise.resolve();
    });
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: dir,
      repoRef: ref,
      dir,
      request: REQUEST,
      yes: true,
      surface: 'test',
    });
    return { h, dir, runId };
  }

  it('ends ready in one part when the agent marks every ticket and the approved checks pass', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    h.engine.submitChecks(runId, ['node scripts/pass.mjs']);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(of(h, runId, 'code.part')).toHaveLength(0);
    expect(of(h, runId, 'code.baseline')).toHaveLength(1);
    expect(done(h, runId)).toMatchObject({
      verdict: 'ready',
      parts: 1,
      verify: {
        done: true,
        remaining: [],
        runs: [{ command: 'node scripts/pass.mjs', result: 'passed', exitCode: 0 }],
      },
    });
    expect(ticket(dir, ORDERS)).toBe('READY_FOR_TEST');
    expect(ticket(dir, FILTER)).toBe('READY_FOR_TEST');
  });

  it('tells the next part which request is left, and finishes when it is done', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '1');
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1]);
    expect(prompt(dir, 1)).not.toContain('These requests are not done yet');
    expect(prompt(dir, 2)).toContain('## Continuing: part 2 of up to 5');
    expect(prompt(dir, 2)).toContain(
      `These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n- ${FILTER}: ${FILTER_SUMMARY}`,
    );
    expect(prompt(dir, 2)).not.toContain(`- ${ORDERS}:`);
    expect(await out(['log', '-1', '--format=%B'], dir)).toContain(
      'stopped with work left (1 request(s) not done, 0 check(s) failing)',
    );
    expect(done(h, runId)).toMatchObject({ verdict: 'ready', parts: 2, verify: { done: true } });
    expect(ticket(dir, FILTER)).toBe('READY_FOR_TEST');
  });

  it("sends a failing check's output to the next part, and ends ready once it passes", async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    h.engine.submitChecks(runId, ['node scripts/verify.mjs']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(
      (of(h, runId, 'code.baseline')[0]!['runs'] as { result: string }[]).map((r) => r.result),
    ).toEqual(['passed']);
    expect(prompt(dir, 2)).toContain(
      'When you stopped, the Incubator ran the approved commands and these failed:',
    );
    expect(prompt(dir, 2)).toContain(
      '- node scripts/verify.mjs:\n    verify: src/step-2.txt is missing',
    );
    expect(prompt(dir, 2)).not.toContain('These requests are not done yet');
    expect(await out(['log', '-1', '--format=%B'], dir)).toContain(
      'stopped with work left (0 request(s) not done, 1 check(s) failing)',
    );
    expect(of(h, runId, 'code.verify').map((e) => e['done'])).toEqual([false, true]);
    expect(done(h, runId)).toMatchObject({ verdict: 'ready', parts: 2 });
  });

  it('does not hold the run back for a check that was failing before the agent started', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    h.engine.submitChecks(runId, ['node scripts/fail.mjs', 'node scripts/pass.mjs']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(of(h, runId, 'code.baseline')).toHaveLength(1);
    expect(
      (of(h, runId, 'code.baseline')[0]!['runs'] as { command: string; result: string }[]).map(
        (r) => `${r.command}: ${r.result}`,
      ),
    ).toEqual(['node scripts/fail.mjs: failed', 'node scripts/pass.mjs: passed']);
    expect(done(h, runId)).toMatchObject({
      verdict: 'ready',
      parts: 1,
      verify: { done: true, alreadyFailing: ['node scripts/fail.mjs'] },
    });
    expect(prompt(dir, 1)).not.toContain('these failed');
  });

  it('stops, parked, when a part changes nothing and requests are still left', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '0');
    vi.stubEnv('FAKE_AGENT_WRITES', '1');
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1]);
    expect(prompt(dir, 2)).toContain(`- ${ORDERS}:`);
    expect(prompt(dir, 2)).toContain(`- ${FILTER}: ${FILTER_SUMMARY}`);
    expect(done(h, runId)).toMatchObject({
      verdict: 'parked',
      parts: 2,
      verify: { done: false, remaining: [ORDERS, FILTER] },
    });
    expect(ticket(dir, ORDERS)).not.toBe('READY_FOR_TEST');
  });

  it('is parked, never ready, when every ticket is marked but a check still fails', async () => {
    const { h, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    vi.stubEnv('FAKE_AGENT_WRITES', '1');
    h.engine.submitChecks(runId, ['node scripts/verify.mjs']);
    await h.engine.advance(runId, new DefaultsPrompter());
    // Part 1 wrote src/step-1.txt and marked both tickets; verify.mjs then fails (no src/step-2.txt).
    // Part 2 changes nothing, so the run stops there: the agent's own report says ready, the Incubator's check says not.
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(of(h, runId, 'code.verify').map((e) => e['done'])).toEqual([false, false]);
    expect(done(h, runId)).toMatchObject({
      verdict: 'parked',
      parts: 2,
      verify: { done: false, remaining: [], runs: [{ result: 'failed', exitCode: 1 }] },
    });
  });

  it('never sends a check that was failing before the agent started to the next part', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '1');
    h.engine.submitChecks(runId, ['node scripts/fail.mjs']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(2);
    expect(prompt(dir, 2)).toContain(`- ${FILTER}: ${FILTER_SUMMARY}`);
    expect(prompt(dir, 2)).not.toContain('these failed');
    expect(prompt(dir, 2)).not.toContain('- node scripts/fail.mjs:');
    expect(await out(['log', '-1', '--format=%B'], dir)).toContain(
      'stopped with work left (1 request(s) not done, 0 check(s) failing)',
    );
    expect(done(h, runId)).toMatchObject({
      verdict: 'ready',
      parts: 2,
      verify: { done: true, alreadyFailing: ['node scripts/fail.mjs'] },
    });
  });

  it('stops after five parts, parked and not ready, when an approved check never passes', async () => {
    const { h, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    h.engine.submitChecks(runId, ['node scripts/never.mjs']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(5);
    expect(of(h, runId, 'code.part').map((e) => e['part'])).toEqual([1, 2, 3, 4]);
    expect(of(h, runId, 'code.verify').map((e) => e['done'])).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(done(h, runId)).toMatchObject({
      verdict: 'parked',
      parts: 5,
      verify: { done: false, remaining: [] },
    });
  });

  it('leaves the work unverified, not broken, when an approved program is not installed', async () => {
    const { h, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    h.engine.submitChecks(runId, ['incubator-no-such-tool test']);
    await h.engine.advance(runId, new DefaultsPrompter());
    expect(of(h, runId, 'handoff.launch')).toHaveLength(1);
    expect(done(h, runId)).toMatchObject({
      verdict: 'ready',
      verify: {
        done: true,
        runs: [{ command: 'incubator-no-such-tool test', result: 'missing', exitCode: null }],
      },
    });
  });
});
```

### 6. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/folder-runs.test.ts packages/core/fixtures/handoff/fake-agent.mjs packages/core/fixtures/enhance/two-requests
```

## Touched files and markers

| File                                                                  | Marker                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/core/fixtures/handoff/fake-agent.mjs`                       | `An update run's agent (plan 043).`                                |
| `packages/core/fixtures/enhance/two-requests/narrative.md`            | `and filter that export by date.`                                  |
| `packages/core/fixtures/enhance/two-requests/00-AnalysisSummary.json` | `order-desk is a small Express service`                            |
| `packages/core/fixtures/enhance/two-requests/01-DiscoveryTurn.json`   | `plan 043: an update plan with two requests`                       |
| `packages/core/fixtures/enhance/two-requests/02-ReviewSummary.json`   | `Let the export be limited to one date.`                           |
| `packages/core/src/folder-runs.test.ts`                               | `an update run keeps going until every request is done (plan 043)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/folder-runs.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
every test in "an update run keeps going until every request is done (plan 043)" passes, and so do the existing "coding in parts (plan 036)", "continue coding (plan 037)" and "check commands on a repository the Incubator did not build (ADR-025)" tests, unchanged
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                 | Why                                                                                                     | Mechanical check                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A test passes because the check never ran            | an unapproved or skipped check leaves `verify.runs` empty, and "done" is then true for the wrong reason | every test that approves a command asserts `verify.runs` or `code.baseline` content, with exact `command` and `result` |
| The baseline hides a check that the agent broke      | the failing-check test would pass trivially if `verify.mjs` failed on the untouched repository          | the test asserts the baseline run was `passed` before the agent's first part                                           |
| The next part's prompt is asserted by a count only   | a continuation without the failing tail or the open request would still make two launches               | the tests read `.incubator/state/prompt-2.txt` and assert the exact request and failing-output lines                   |
| A part that did nothing hides a fixture bug          | `FAKE_AGENT_WRITES=1` would also pass if the fake agent crashed                                         | the no-progress test asserts both prompts, the `code.part` entries, and `remaining` in the verdict                     |
| The fake agent edits the real repository from a hook | git variables leak into a node child inside the pre-push hook (see the `parts` mode comment)            | the `steps` mode runs no git command at all                                                                            |
| The fixture ticket order differs from the plan order | `FAKE_AGENT_TICKETS` fixes the marking order, and plan order is the fixture's feature order             | the tests assert which request is left by its id and summary                                                           |

## Review rounds

| Round | Finding                                                                                                                                                                                     | Status |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: eslint `require-await` on the seeding callback; two surviving mutations (baseline subtraction in the prompt and in the checkpoint message, the five-part cap) need a test each | CLOSED |
| 1     | Plan 042's loop has no end-to-end test: verification, baseline, continuation text and the no-progress stop are only unit-tested in pieces                                                   | CLOSED |
