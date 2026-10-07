# Plan 025: refresh an update run whose repository moved on (engine)

## Executor preamble

You are implementing an exact engine change. Rules for every work item:

- Change only the files named here, at the places named. Work item 13 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is
  in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text`
  fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written, including the punctuation inside messages; the tests compare them.
- Do not touch anything under `apps/`. Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or
  weaken any test. Work item 12 changes the expected park reason of one existing folder test, because this plan
  parks that situation earlier, and adds a new test that keeps the old reason covered.
- Never spawn a process through a shell; git runs through the existing `git(...)` helper in `gitops.ts`.
- Run commands in PowerShell from the repository root. `node -v` already prints v22; do not change PATH.

**Why.** An update ("enhance") run reads its repository once, at ANALYZE: it records the commit
(`existingRepo.baseSha`, and `folder.base` for a run in the owner's folder), clones it, scans it and writes a
summary. Nothing reads that commit again. A run picked up days later keeps planning against code that no longer
exists, and a folder run only finds out at delivery (`folder_changed`, a dead end).

This plan adds, in `packages/core` and `packages/git`:

1. `GitOps.countBetween`, which counts new commits.
2. `Engine.repoMoved(runId)`, which says whether the repository moved on since the run read it.
3. A park, `repo_moved`, before the plan is built (APPROVED → SCAFFOLD), so nothing is built on an old snapshot.
4. `Engine.refreshRepo(runId)`, which:
   - records `repo.refresh`;
   - makes the reducer forget the steps that copied, checked and summarised the repository;
   - sends the run back to ANALYZE (a fresh copy, scan, summary and draft).
5. An epoch rule: what the owner said before the latest `repo.refresh` no longer counts as a decision. The change
   request, the corrections at review, the answers and the approved check commands are all filtered on it.
6. The REQUEST step parks `needs_request` with `evidence.previous`, the earlier request plus the earlier
   corrections, for the owner to confirm or edit.

Plan 026 re-asks the earlier questions, and plan 027 adds the web UI and `incubator resume --refresh`. The three
plans ship together: on its own, 025's `repo_moved` park has no way out on any surface.

## Work items

### 1. GitOps: count the commits between two points

File `packages/git/src/gitops.ts`.

Find:

```text
  /** Checks out an existing local branch. */
  checkout(dir: string, branch: string): Promise<void>;
```

Replace with:

```text
  /** Checks out an existing local branch. */
  checkout(dir: string, branch: string): Promise<void>;
  /** How many commits `to` has that `from` does not (`rev-list --count from..to`); null when git cannot tell. */
  countBetween(dir: string, from: string, to: string): Promise<number | null>;
```

Find:

```text
    async checkout(dir, branch) {
      await git(['checkout', '-q', branch, '--'], { cwd: dir });
    },
```

Replace with:

```text
    async checkout(dir, branch) {
      await git(['checkout', '-q', branch, '--'], { cwd: dir });
    },
    async countBetween(dir, from, to) {
      // why: only commit ids reach git here, so nothing can be read as an option (plan 025).
      const sha = /^[0-9a-f]{7,64}$/;
      if (!sha.test(from) || !sha.test(to)) return null;
      const r = await git(['rev-list', '--count', `${from}..${to}`], { cwd: dir, allowFail: true });
      const n = Number.parseInt(r.stdout.trim(), 10);
      return r.code === 0 && Number.isFinite(n) ? n : null;
    },
```

### 2. The fault-injecting GitOps wrapper knows the new method

File `packages/core/src/testing.ts`.

Find:

```text
        'checkout',
        'remoteAdd',
        'identity',
      ] as const
```

Replace with:

```text
        'checkout',
        'remoteAdd',
        'identity',
        'countBetween',
      ] as const
```

### 3. Test for countBetween

File `packages/git/src/gitops.test.ts`.

Find:

```text
  it('reports the checked-out branch, and null when HEAD is unborn or detached', async () => {
```

Replace with:

```text
  it('counts the commits between two points, and says null for anything that is not a commit id (plan 025)', async () => {
    const dir = await repo();
    const a = (await git.headSha(dir))!;
    writeFileSync(path.join(dir, 'b.txt'), 'two\n');
    await git.addAll(dir);
    await git.commit(dir, 'chore: two', ident);
    writeFileSync(path.join(dir, 'c.txt'), 'three\n');
    await git.addAll(dir);
    const c = await git.commit(dir, 'chore: three', ident);
    expect(await git.countBetween(dir, a, c)).toBe(2);
    expect(await git.countBetween(dir, c, a)).toBe(0);
    expect(await git.countBetween(dir, '--all', c)).toBeNull();
    expect(await git.countBetween(dir, 'f'.repeat(40), c)).toBeNull();
  });

  it('reports the checked-out branch, and null when HEAD is unborn or detached', async () => {
```

### 4. The reducer: a refresh forgets the steps that read the repository

File `packages/core/src/state.ts`.

Find:

```text
export type RunStateName = (typeof RUN_STATES)[number];
```

Replace with:

```text
export type RunStateName = (typeof RUN_STATES)[number];

/** The steps a repository refresh runs again (plan 025): the folder check, the copy, and the summary. */
const REFRESHED_STEPS: readonly string[] = ['folder.base', 'adopt.acquire', 'enhance.summary'];
```

Find:

```text
      case 'run.done':
        s = { ...s, state: 'DONE', done: true, failure: null, stopped: null };
        break;
      default:
        break;
```

Replace with:

```text
      case 'run.done':
        s = { ...s, state: 'DONE', done: true, failure: null, stopped: null };
        break;
      case 'repo.refresh':
        // why: a refresh (plan 025) reads the repository again, so the steps that checked, copied and
        // summarised it run again, and the new plan needs approving again.
        s = {
          ...s,
          steps: Object.fromEntries(
            Object.entries(s.steps).filter(([id]) => !REFRESHED_STEPS.includes(id)),
          ),
          pendingQuestions: null,
          approvedHash: null,
        };
        break;
      default:
        break;
```

### 5. Engine: the GitOps type, `RepoMove` and the planning states

File `packages/core/src/engine.ts`.

Find:

```text
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
```

Replace with:

```text
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
```

Find:

```text
import type { RepoRef } from '@incubator/git';
```

Replace with:

```text
import type { GitOps, RepoRef } from '@incubator/git';
```

Find:

```text
/** One tool and model that did one kind of work in a run. */
export interface ModelUse {
```

Replace with:

```text
/** Where an update run's repository stands against the commit the run read (plan 025). */
export interface RepoMove {
  /** The repository has new commits (or another branch is checked out) since the run read it. */
  moved: boolean;
  /** The commit the run read, or null when it has not read one yet. */
  recorded: string | null;
  /** The commit there now, or null when it could not be read. */
  current: string | null;
  /** The branch there now (the default branch for a GitHub repository). */
  branch: string | null;
  /** How many commits are new; null when they cannot be counted (a GitHub repository). */
  commits: number | null;
}

/** The states in which an update run is still planning, so a refresh can still change the plan (plan 025). */
const PLANNING_STATES: readonly RunStateName[] = [
  'INTAKE',
  'ANALYZE',
  'REQUEST',
  'DRAFT_SPEC',
  'CLARIFY',
  'REVIEW',
  'APPROVED',
];

/** One tool and model that did one kind of work in a run. */
export interface ModelUse {
```

### 6. Engine: the change request counts only since the latest refresh

File `packages/core/src/engine.ts`.

Find:

```text
  /** The owner's change request: a submitted one wins over the one given at start. */
  requestText(runId: string): string {
    const submitted = this.entries(runId).findLast((e) => e.type === 'enhance.request');
    return sanitizeRequest(
      typeof submitted?.['text'] === 'string'
        ? submitted['text']
        : (this.state(runId).input.request ?? ''),
    );
  }
```

Replace with:

```text
  /**
   * The owner's change request: a submitted one wins over the one given at start. After a refresh (plan 025)
   * only a request submitted since counts; until there is one it is empty and the run asks again.
   */
  requestText(runId: string): string {
    const cut = this.since(runId);
    const submitted = this.entries(runId).findLast(
      (e) => e.type === 'enhance.request' && e.seq > cut,
    );
    const given = cut > 0 ? '' : (this.state(runId).input.request ?? '');
    return sanitizeRequest(typeof submitted?.['text'] === 'string' ? submitted['text'] : given);
  }

  /** The seq of the latest repository refresh (plan 025), or 0: what the owner said before it is asked again. */
  private since(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'repo.refresh')?.seq ?? 0;
  }

  /** After a refresh (plan 025): the earlier request, with the corrections given at review, to confirm or edit. */
  previousRequest(runId: string): string | null {
    const e = this.entries(runId).findLast((x) => x.type === 'repo.refresh');
    return typeof e?.['previous'] === 'string' && e['previous'] ? e['previous'] : null;
  }
```

### 7. Engine: the latest scan's checks, and the request step asks to confirm after a refresh

File `packages/core/src/engine.ts`.

Find:

```text
    const e = this.entries(runId).find((x) => x.type === 'enhance.scan');
```

Replace with:

```text
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.scan');
```

Find:

```text
  approvedChecks(runId: string): string[] | null {
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.checks');
```

Replace with:

```text
  approvedChecks(runId: string): string[] | null {
    // why: commands approved before a refresh (plan 025) were chosen for the old snapshot: ask again.
    const cut = this.since(runId);
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.checks' && x.seq > cut);
```

Find:

```text
  private requestStep(runId: string): void {
    if (!this.requestText(runId))
      throw new ParkError(
        'needs_request',
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    this.enter(runId, 'DRAFT_SPEC', 1);
  }
```

Replace with:

```text
  private requestStep(runId: string): void {
    if (!this.requestText(runId)) {
      const previous = this.previousRequest(runId);
      // why: after a refresh (plan 025) the owner confirms or edits what they asked for before.
      if (previous)
        throw new ParkError(
          'needs_request',
          'the repository was read again: confirm what you want to change, or edit it',
          { previous },
        );
      throw new ParkError(
        'needs_request',
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    }
    this.enter(runId, 'DRAFT_SPEC', 1);
  }
```

### 8. Engine: answers and corrections count only since the latest refresh

File `packages/core/src/engine.ts`.

Find:

```text
    const questions = new Map<string, AskedInfo>();
    for (const e of this.entries(runId)) {
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
```

Replace with:

```text
    const questions = new Map<string, AskedInfo>();
    // why: answers given before a refresh (plan 025) are asked again, not taken as decisions.
    const cut = this.since(runId);
    for (const e of this.entries(runId)) {
      if (e.seq <= cut) continue;
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
```

Find:

```text
  /** The owner's corrections at review, oldest first (plan 021). */
  private reviewFeedback(runId: string): string[] {
    return this.entries(runId)
      .filter((e) => e.type === 'review.feedback' && typeof e['text'] === 'string')
      .map((e) => e['text'] as string);
  }
```

Replace with:

```text
  /** The owner's corrections at review, oldest first (plan 021); after a refresh, only those since (plan 025). */
  private reviewFeedback(runId: string): string[] {
    const cut = this.since(runId);
    return this.entries(runId)
      .filter((e) => e.type === 'review.feedback' && e.seq > cut && typeof e['text'] === 'string')
      .map((e) => e['text'] as string);
  }

  /**
   * Whether the repository an update run read has moved on since (plan 025): new commits, or another branch
   * checked out in the owner's folder. Only asked while the run is planning; otherwise it says not moved.
   */
  async repoMoved(runId: string): Promise<RepoMove> {
    const none: RepoMove = {
      moved: false,
      recorded: null,
      current: null,
      branch: null,
      commits: null,
    };
    const s = this.state(runId);
    const at = s.state === 'PARKED' ? s.parked?.state : s.state;
    const pub = this.deps.publish;
    const repo = s.input.repo;
    if (s.input.kind !== 'enhance' || !repo || s.done || !pub || !at) return none;
    if (!PLANNING_STATES.includes(at)) return none;
    try {
      if (s.input.dir) {
        const base = s.steps['folder.base']?.data as
          | { head?: string; branch?: string | null }
          | undefined;
        if (!base?.head) return none;
        return await this.compareHead(pub.git, this.runDir(s), base.head, base.branch ?? null);
      }
      const existing = (
        this.draft(runId) as { existingRepo?: { baseSha?: string; defaultBranch?: string } }
      ).existingRepo;
      const recorded = existing?.baseSha;
      if (!recorded || /^0+$/.test(recorded)) return none;
      if (!/^[a-z]+:\/\//i.test(repo) && !repo.startsWith('git@'))
        return await this.compareHead(pub.git, path.resolve(repo), recorded, undefined);
      const branch = existing?.defaultBranch ?? 'main';
      const token = await pub.resolveToken();
      const current = await pub.git.remoteSha(repo, `refs/heads/${branch}`, token?.token);
      const moved = current !== null && current !== recorded;
      return { moved, recorded, current, branch, commits: null };
    } catch {
      return none;
    }
  }

  /** A local repository's HEAD against the recorded commit, and its branch when one was recorded (plan 025). */
  private async compareHead(
    git: GitOps,
    dir: string,
    recorded: string,
    branchWas: string | null | undefined,
  ): Promise<RepoMove> {
    const current = await git.headSha(dir);
    const branch = await git.currentBranch(dir);
    const moved =
      current !== null &&
      (current !== recorded || (branchWas !== undefined && branch !== branchWas));
    const commits =
      moved && current !== null ? await git.countBetween(dir, recorded, current) : 0;
    return { moved, recorded, current, branch, commits };
  }

  /** Before the plan is built (plan 025): an update run whose repository moved on parks until it is refreshed. */
  private async guardRepo(runId: string): Promise<void> {
    const m = await this.repoMoved(runId);
    if (!m.moved) return;
    const count = m.commits ? ` (${m.commits} new commit${m.commits === 1 ? '' : 's'})` : '';
    throw new ParkError(
      'repo_moved',
      `the repository changed since this run read it${count}: refresh the run to read it again`,
      { recorded: m.recorded, current: m.current, commits: m.commits },
    );
  }

  /**
   * Reads an update run's repository again (plan 025). The run goes back to ANALYZE: a fresh copy, scan and
   * summary, a new draft from them, and the owner confirms the change request again. Only while planning.
   */
  async refreshRepo(runId: string): Promise<RepoMove> {
    const s = this.state(runId);
    if (s.input.kind !== 'enhance' || !s.input.repo)
      throw new PolicyError(`run ${runId} is not an update of an existing repository`, {
        code: 'not_enhance',
      });
    const at = s.state === 'PARKED' ? s.parked?.state : s.state;
    if (s.done || !at || !PLANNING_STATES.includes(at))
      throw new PolicyError(`run ${runId} is past planning: its plan is already being built`, {
        code: 'too_late',
      });
    const m = await this.repoMoved(runId);
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const asked = this.requestText(runId);
    const corrections = this.reviewFeedback(runId);
    const withCorrections = corrections.length
      ? `${asked}\n\nCorrections you gave at review:\n${corrections.map((c) => `- ${c}`).join('\n')}`
      : asked;
    // why: a second refresh before the request was confirmed keeps the text from the first.
    const previous = asked ? sanitizeRequest(withCorrections) : (this.previousRequest(runId) ?? '');
    // why: the summary is only rewritten when the model call succeeds; the old snapshot's must not survive.
    rmSync(this.enhanceFile(runId, 'analysis-summary.md'), { force: true });
    this.record(runId, 'repo.refresh', {
      from: m.recorded,
      to: m.current,
      commits: m.commits,
      previous,
    });
    this.enter(runId, 'ANALYZE');
    return m;
  }
```

### 9. Engine: no plan is built on a repository that moved on

File `packages/core/src/engine.ts`.

Find:

```text
            this.enter(runId, 'SCAFFOLD');
            break;
          case 'SCAFFOLD':
```

Replace with:

```text
            // why: the plan must be built on the repository as it is now, not as it was read (plan 025).
            if (s.input.kind === 'enhance') await this.guardRepo(runId);
            this.enter(runId, 'SCAFFOLD');
            break;
          case 'SCAFFOLD':
```

### 10. Fixtures for the refresh test

Run exactly (PowerShell, from the repository root):

```powershell
New-Item -ItemType Directory -Force packages/core/fixtures/enhance/refresh | Out-Null
Copy-Item packages/core/fixtures/enhance/export-orders/00-AnalysisSummary.json packages/core/fixtures/enhance/refresh/00-AnalysisSummary.json
Copy-Item packages/core/fixtures/enhance/export-orders/01-DiscoveryTurn.json packages/core/fixtures/enhance/refresh/01-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/review-changes/02-DiscoveryTurn.json packages/core/fixtures/enhance/refresh/02-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/export-orders/00-AnalysisSummary.json packages/core/fixtures/enhance/refresh/03-AnalysisSummary.json
Copy-Item packages/core/fixtures/enhance/review-changes/02-DiscoveryTurn.json packages/core/fixtures/enhance/refresh/04-DiscoveryTurn.json
Copy-Item packages/core/fixtures/enhance/export-orders/narrative.md packages/core/fixtures/enhance/refresh/narrative.md
```

The order of calls these answer:

1. the first analysis summary;
2. the first draft;
3. the draft after a correction at review;
4. the analysis summary after the refresh;
5. the draft after the refresh.

### 11. Folder tests: imports

File `packages/core/src/folder-runs.test.ts`.

Find:

```text
import type { Capabilities } from '@incubator/llm';
```

Replace with:

```text
import type { Capabilities, FakeLlmAdapter } from '@incubator/llm';
```

Find:

```text
import { DefaultsPrompter, NonInteractivePrompter } from './prompter.js';
```

Replace with:

```text
import { DefaultsPrompter, NonInteractivePrompter, ScriptedPrompter } from './prompter.js';
```

### 12. Folder tests: the move parks at approval, and a refresh reads the folder again

File `packages/core/src/folder-runs.test.ts`.

The existing test below committed to the folder after review and expected `folder_changed` at delivery. The run
now parks earlier, at approval, with `repo_moved`. Its other assertions (nothing touched) stay. A new test right
after it keeps `folder_changed` covered: uncommitted work at delivery.

Find:

```text
  it('parks, touching nothing, when the folder moved on between the scan and the delivery', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(s.parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'later'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    h.engine.approve(runId);
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ reason: 'folder_changed' });
    expect(await out(['rev-parse', 'HEAD'], dir)).toBe(head);
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    expect(await out(['status', '--porcelain'], dir)).toBe('');
  });
```

Replace with:

```text
  it('parks at approval, touching nothing, when the folder has new commits since the scan (plan 025)', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(s.parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'later'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    h.engine.approve(runId);
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ state: 'APPROVED', reason: 'repo_moved' });
    expect(await out(['rev-parse', 'HEAD'], dir)).toBe(head);
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    expect(await out(['status', '--porcelain'], dir)).toBe('');
  });

  it('parks, touching nothing, when uncommitted work appears in the folder between the scan and the delivery', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new NonInteractivePrompter());
    expect(s.parked).toMatchObject({ state: 'REVIEW' });
    writeFileSync(path.join(dir, 'later.txt'), 'the owner kept working\n');
    const head = await out(['rev-parse', 'HEAD'], dir);
    h.engine.approve(runId);
    const parked = await h.engine.advance(runId, new DefaultsPrompter());
    expect(parked.parked).toMatchObject({ reason: 'folder_changed' });
    expect(await out(['rev-parse', 'HEAD'], dir)).toBe(head);
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    expect(await out(['status', '--porcelain'], dir)).toBe('?? later.txt');
  });

  it('notices new commits, refuses to build on the old snapshot, and a refresh reads the folder again and asks to confirm the request (plan 025)', async () => {
    const h = harness({ llm: { dir: enhanceFixtureDir('refresh') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'bare-node',
      path.join(analyzerFixtures, 'bare-node'),
    );
    await setOwner(dir);
    const runId = start(h, dir, ref);
    const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false });
    const correction = 'Also let kitchen staff filter the export by date.';
    h.engine.requestChanges(runId, correction);
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    // The owner keeps working on the folder.
    const before = await out(['rev-parse', 'HEAD'], dir);
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'src', 'report.js'), 'export const report = () => [];\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'add a report'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toEqual({
      moved: true,
      recorded: before,
      current: head,
      branch: 'main',
      commits: 1,
    });
    // Approving does not build on the old snapshot.
    h.engine.approve(runId);
    const stopped = await h.engine.advance(runId, waiting);
    expect(stopped.parked).toMatchObject({
      state: 'APPROVED',
      reason: 'repo_moved',
      evidence: { recorded: before, current: head, commits: 1 },
    });
    expect(await out(['branch', '--list', ENHANCE], dir)).toBe('');
    // The refresh reads the folder again and asks to confirm the request, the correction included.
    await h.engine.refreshRepo(runId);
    const asked = await h.engine.advance(runId, waiting);
    const previous = `${REQUEST}\n\nCorrections you gave at review:\n- ${correction}`;
    expect(asked.parked).toMatchObject({
      state: 'REQUEST',
      reason: 'needs_request',
      evidence: { previous },
    });
    expect(h.engine.requestText(runId)).toBe('');
    expect(h.engine.previousRequest(runId)).toBe(previous);
    const scans = h.engine.entries(runId).filter((e) => e.type === 'enhance.scan');
    expect(scans).toHaveLength(2);
    expect(scans[1]!['hash']).not.toBe(scans[0]!['hash']);
    const draft = h.engine.draft(runId) as { existingRepo?: { baseSha?: string } };
    expect(draft.existingRepo?.baseSha).toBe(head);
    expect(h.engine.state(runId).steps['folder.base']?.data).toMatchObject({ head });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false, commits: 0 });
    // Confirming it drafts against the new scan; the old correction travels in the request text only.
    h.engine.submitRequest(runId, previous);
    expect((await h.engine.resume(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    const llm = h.llm as FakeLlmAdapter;
    expect(llm.calls.filter((c) => c.schemaName === 'AnalysisSummary')).toHaveLength(2);
    const turns = llm.calls.filter((c) => c.schemaName === 'DiscoveryTurn');
    expect(turns).toHaveLength(3);
    expect(turns[2]!.user).toContain('Corrections you gave at review:');
    expect(turns[2]!.user).not.toContain("## Owner's corrections at review");
    expect(llm.remaining).toBe(0);
    expect(h.engine.finalSpec(runId)!.intent.coreFeatures.map((f) => f.id)).toEqual([
      'export-orders',
      'export-filter',
    ]);
    // A second refresh sets aside the request confirmed since the first one, and keeps it to confirm again.
    await h.engine.refreshRepo(runId);
    expect(h.engine.requestText(runId)).toBe('');
    expect(h.engine.previousRequest(runId)).toBe(previous);
    expect(existsSync(path.join(h.store.runDir(runId), 'enhance', 'analysis-summary.md'))).toBe(
      false,
    );
  });

  it('notices a push to the GitHub repository of an update run outside a folder (plan 025)', async () => {
    const h = harness({ llm: { dir: enhanceFixtureDir('refresh') } });
    const { ref, dir } = await seedExistingRepo(
      h.github,
      'bare-node',
      path.join(analyzerFixtures, 'bare-node'),
    );
    await setOwner(dir);
    const runId = h.engine.start({
      kind: 'enhance',
      repo: h.github.remoteUrl(ref),
      repoRef: ref,
      request: REQUEST,
      yes: true,
      noPublish: true,
      surface: 'test',
    });
    const waiting = new ScriptedPrompter({}, { approve: false, reason: 'owner is reading' });
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({ state: 'REVIEW' });
    const before = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false, recorded: before });
    writeFileSync(path.join(dir, 'later.txt'), 'pushed by someone else\n');
    await git(['add', '-A'], dir);
    await git(['commit', '-q', '-m', 'later'], dir);
    await git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], dir);
    const head = await out(['rev-parse', 'HEAD'], dir);
    expect(await h.engine.repoMoved(runId)).toEqual({
      moved: true,
      recorded: before,
      current: head,
      branch: 'main',
      commits: null,
    });
    h.engine.approve(runId);
    expect((await h.engine.advance(runId, waiting)).parked).toMatchObject({
      state: 'APPROVED',
      reason: 'repo_moved',
      evidence: { recorded: before, current: head, commits: null },
    });
  });

  it('refuses a refresh once the plan is being built, and on a run that is not an update (plan 025)', async () => {
    const { h, ref, dir } = await seeded();
    const runId = start(h, dir, ref);
    const s = await h.engine.advance(runId, new DefaultsPrompter());
    expect(s.parked).toMatchObject({ state: 'COMMIT', reason: 'needs_commit' });
    expect(await h.engine.repoMoved(runId)).toMatchObject({ moved: false });
    await expect(h.engine.refreshRepo(runId)).rejects.toMatchObject({ code: 'too_late' });
    const other = h.engine.startFromSpec(spec(), {
      kind: 'new',
      surface: 'test',
      dir: freshFolder(),
    });
    await expect(h.engine.refreshRepo(other)).rejects.toMatchObject({ code: 'not_enhance' });
  });
```

### 13. Format the touched files

Run exactly:

```powershell
pnpm exec prettier --write packages/git/src/gitops.ts packages/git/src/gitops.test.ts packages/core/src/testing.ts packages/core/src/state.ts packages/core/src/engine.ts packages/core/src/folder-runs.test.ts packages/core/fixtures/enhance/refresh
```

## Touched files and markers

| File                                                           | Marker                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/git/src/gitops.ts`                                   | `async countBetween(dir, from, to) {`                                                                  |
| `packages/git/src/gitops.test.ts`                              | `counts the commits between two points, and says null for anything that is not a commit id (plan 025)` |
| `packages/core/src/testing.ts`                                 | `'countBetween',`                                                                                      |
| `packages/core/src/state.ts`                                   | `case 'repo.refresh':`                                                                                 |
| `packages/core/src/engine.ts`                                  | `async refreshRepo(runId: string): Promise<RepoMove> {`                                                |
| `packages/core/fixtures/enhance/refresh/04-DiscoveryTurn.json` | `"export-filter"`                                                                                      |
| `packages/core/src/folder-runs.test.ts`                        | `a refresh reads the folder again and asks to confirm the request (plan 025)`                          |

## Acceptance commands

```sh
pnpm exec vitest run --project unit packages/git/src/gitops.test.ts packages/core/src/folder-runs.test.ts
pnpm exec vitest run --project unit packages/core/src/enhance.test.ts packages/core/src/discovery.test.ts packages/core/src/stop.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core packages/git
(Select-String -SimpleMatch -Path packages/core/src/engine.ts 'this.since(runId)').Count
(Select-String -SimpleMatch -Path packages/core/src/engine.ts 'if (e.seq <= cut) continue;').Count
(Select-String -SimpleMatch -Path packages/core/src/engine.ts 'e.seq > cut').Count
(Select-String -SimpleMatch -Path packages/core/src/engine.ts 'x.seq > cut').Count
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "find((x) => x.type === 'enhance.scan')").Count
(Get-ChildItem packages/core/fixtures/enhance/refresh -Filter *.json).Count
pnpm check:quick
```

```text
both vitest runs pass, including the five folder tests named in work item 12 and the countBetween test
pnpm typecheck exits 0
eslint on packages/core and packages/git exits 0 (no eslint-disable comment may be added)
the since count prints 4 (requestText, approvedChecks, answers, reviewFeedback)
the "if (e.seq <= cut) continue;" count prints 1 (answers)
the "e.seq > cut" count prints 2 (requestText, reviewFeedback)
the "x.seq > cut" count prints 1 (approvedChecks)
the find count prints 0 (proposedChecks now uses findLast)
the fixture count prints 5
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                                | Why                                                                        | Mechanical check                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The reducer case is added but the steps are not dropped, so ANALYZE reuses the old copy and summary | `adopt.acquire` and `enhance.summary` return early when their step is `ok` | the refresh test asserts two `enhance.scan` entries with different hashes, two `AnalysisSummary` calls, and `folder.base` at the new HEAD                                        |
| Old corrections still reach the model as corrections after the refresh                              | `reviewFeedback` must filter on `since`                                    | the refresh test asserts the third draft prompt does not contain `## Owner's corrections at review`                                                                              |
| The run drafts with the old request instead of asking                                               | `requestText` must ignore requests before the refresh                      | the refresh test asserts the `needs_request` park with `evidence.previous` and `requestText` empty                                                                               |
| The guard is skipped or placed after SCAFFOLD                                                       | a plan would be built on the old snapshot                                  | the refresh test asserts the park is at `APPROVED` and the enhance branch does not exist in the folder                                                                           |
| The guard fires on a run whose repository did not move                                              | `repoMoved` compares the wrong commit                                      | the refusal test runs a whole folder run to `needs_commit` with the guard in place                                                                                               |
| `countBetween` passes an option to git                                                              | a ref starting with `-` would be read as an option                         | the gitops test asserts `--all` returns null                                                                                                                                     |
| `faultyGit` lacks the new method, so folder tests call `undefined`                                  | the wrapper lists methods by name                                          | the folder tests call `repoMoved`, which calls `countBetween` through the wrapper                                                                                                |
| A `find` for `enhance.scan` stays, so a refreshed run keeps the first scan's checks                 | `proposedChecks` read the first scan                                       | the Select-String `find` count prints 0                                                                                                                                          |
| A filter on `since` is missed                                                                       | request, answers, corrections and approved checks must all be cut          | the four Select-String counts (`since` 4, `<= cut` 1, `e.seq > cut` 2, `x.seq > cut` 1); the second refresh in the refresh test fails if the submitted-request filter is dropped |
| The old snapshot's analysis summary ships with the new plan                                         | the summary file is only rewritten when the model call succeeds            | the refresh test asserts `analysis-summary.md` is gone after the second refresh                                                                                                  |
| The GitHub-URL path in `repoMoved` drifts and fails open                                            | it sits inside a `try … catch { return none; }`                            | the URL test asserts `moved: true` with `commits: null` and the `repo_moved` park                                                                                                |
| Changing the existing folder test weakens it                                                        | its expected reason changes                                                | its other assertions stay; the new uncommitted-work test keeps `folder_changed` covered                                                                                          |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                    | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The owner asked for a refresh of an update run whose repository moved on, redoing the design and asking again for what they had said                                                                                                                                                                                                                                                                                       | CLOSED |
| 2     | Design: parking on every resume would drop answers the web submits through resume, so the move is checked at approval (a park) and shown by the web (plan 027)                                                                                                                                                                                                                                                             | CLOSED |
| 3     | Adversarial review (Opus 5.5, applied literally in a scratch copy): FIX-FIRST. Import must be `import type` (lint); the submitted-request cut was untested; the count checks did not prove the filters; the URL path was untested; the old analysis summary survived a refresh; approved check commands were not cut; 025 needs 026/027 to ship with it; the reconfirm message was wrong when nothing moved. All folded in | CLOSED |
| 4     | Second pass: SHIP, every finding CLOSED. Accepted as known: the portfolio summary does not refresh, the `enhance.gaps_unavailable` warning is not cleared, and the old spec and brief stay visible until ANALYZE writes a new revision                                                                                                                                                                                     | CLOSED |
