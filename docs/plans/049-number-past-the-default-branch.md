# Plan 049: an update run numbers its plan, and tells the agent how to number new files, past what the default branch already has

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/git/src/gitops.ts` contains `countBetween(dir: string, from: string, to: string)` and that `packages/core/src/engine.ts` contains `step: 'folder.base',`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** An update run on the owner's folder works on a clone of the folder's checked-out branch. When that branch is behind `origin/main`, the Incubator and the agent only see the branch. In a real run, the agent added migration `051` while `origin/main` already had `052` and `053`, so the files clashed when the branches met. The plan number has the same problem: `nextPlanNumber` reads only the branch's `docs/plans/`.

After this plan, when the run starts, the Incubator reads the file list of the folder's remote-tracking default branch: `origin/HEAD` if it is set, else `origin/main`, else `origin/master`. Nothing is fetched; it reads what the last fetch left. It keeps two things in the `folder.base` journal step:

- the numbered folders where the default branch already uses higher numbers than the branch's HEAD (both lists come from git);
- the default branch's plan files.

The delivered plan is then:

- numbered past both the branch's plans and the default branch's plans;
- given a `## Numbered files` section listing those folders (at most 30; `docs/plans/` is left out, since the plan's own number covers it).

A run whose folder has no such remote branch, or whose branch is up to date, gets the same plan as before.

## Work items

### 1. `upstreamFiles` in the git operations

In `packages/git/src/gitops.ts`:

Find:

```text
  /** How many commits `to` has that `from` does not (`rev-list --count from..to`); null when git cannot tell. */
  countBetween(dir: string, from: string, to: string): Promise<number | null>;
```

Replace with:

```text
  /** How many commits `to` has that `from` does not (`rev-list --count from..to`); null when git cannot tell. */
  countBetween(dir: string, from: string, to: string): Promise<number | null>;
  /**
   * Plan 049: the files of the remote-tracking default branch (`origin/HEAD`, else `origin/main`, else
   * `origin/master`) as of the last fetch, and the files at HEAD, both from `git ls-tree`; null when there
   * is none. Nothing is fetched.
   */
  upstreamFiles(dir: string): Promise<{ ref: string; files: string[]; head: string[] } | null>;
```

Find:

```text
      const r = await git(['rev-list', '--count', `${from}..${to}`], { cwd: dir, allowFail: true });
      const n = Number.parseInt(r.stdout.trim(), 10);
      return r.code === 0 && Number.isFinite(n) ? n : null;
    },
```

Replace with:

```text
      const r = await git(['rev-list', '--count', `${from}..${to}`], { cwd: dir, allowFail: true });
      const n = Number.parseInt(r.stdout.trim(), 10);
      return r.code === 0 && Number.isFinite(n) ? n : null;
    },
    async upstreamFiles(dir) {
      const head = await git(['rev-parse', '--abbrev-ref', 'refs/remotes/origin/HEAD'], {
        cwd: dir,
        allowFail: true,
      });
      const named = head.stdout.trim();
      // why: only a plain origin/<branch> name reaches git below, so nothing can be read as an option.
      const refs = [
        ...(head.code === 0 && /^origin\/[A-Za-z0-9._/-]+$/.test(named) ? [named] : []),
        'origin/main',
        'origin/master',
      ];
      for (const ref of refs) {
        const r = await git(['ls-tree', '-r', '--name-only', '-z', `refs/remotes/${ref}`, '--'], {
          cwd: dir,
          allowFail: true,
        });
        if (r.code === 0) {
          const h = await git(['ls-tree', '-r', '--name-only', '-z', 'HEAD', '--'], {
            cwd: dir,
            allowFail: true,
          });
          return {
            ref,
            files: r.stdout.split('\0').filter(Boolean),
            head: h.code === 0 ? h.stdout.split('\0').filter(Boolean) : [],
          };
        }
      }
      return null;
    },
```

### 2. The test engine passes the new operation through

In `packages/core/src/testing.ts`:

Find:

```text
        'identity',
        'countBetween',
      ] as const
```

Replace with:

```text
        'identity',
        'countBetween',
        'upstreamFiles',
      ] as const
```

### 3. A test for `upstreamFiles`

In `packages/git/src/gitops.test.ts`:

Find:

```text
    expect(await git.countBetween(dir, '--all', c)).toBeNull();
    expect(await git.countBetween(dir, 'f'.repeat(40), c)).toBeNull();
  });
```

Replace with:

```text
    expect(await git.countBetween(dir, '--all', c)).toBeNull();
    expect(await git.countBetween(dir, 'f'.repeat(40), c)).toBeNull();
  });

  it("lists the default branch's files as of the last fetch, and fetches nothing itself (plan 049)", async () => {
    const src = tmp('gitops-upstream-src-');
    await git.init(src, 'trunk');
    writeFileSync(path.join(src, 'a.txt'), 'one\n');
    await git.addAll(src);
    await git.commit(src, 'chore: one', ident);
    const dest = path.join(tmp('gitops-upstream-'), 'dest');
    await git.clone(src, dest);
    mkdirSync(path.join(src, 'db'));
    writeFileSync(path.join(src, 'db', '002_more.sql'), '-- more\n');
    await git.addAll(src);
    await git.commit(src, 'chore: two', ident);
    // Nothing was fetched, so the clone still sees the first commit.
    expect(await git.upstreamFiles(dest)).toEqual({
      ref: 'origin/trunk',
      files: ['a.txt'],
      head: ['a.txt'],
    });
    await git.fetch(dest, 'origin', '+refs/heads/trunk:refs/remotes/origin/trunk');
    expect(await git.upstreamFiles(dest)).toEqual({
      ref: 'origin/trunk',
      files: ['a.txt', 'db/002_more.sql'],
      head: ['a.txt'],
    });
    // A repository with no remote has no default branch to read.
    expect(await git.upstreamFiles(src)).toBeNull();
  });
```

### 4. Numbered folders, and the plan's note about them

In `packages/core/src/enhance.ts`:

Find:

```text
  external?: boolean;
}

/**
 * The two places the lane templates name the Incubator's own gate, and what an external repository
```

Replace with:

```text
  external?: boolean;
  /** Plan 049: numbered folders where the folder's default branch is past this branch; null when unknown. */
  numbered?: { ref: string; ahead: NumberedAhead[] } | null;
}

/**
 * The two places the lane templates name the Incubator's own gate, and what an external repository
```

Find:

```text
    ...steps,
    '## Touched files and markers',
```

Replace with:

```text
    ...steps,
    ...numberedSection(d.numbered ?? null),
    '## Touched files and markers',
```

Find:

```text
/** The next free `docs/plans/NNN-` number in the repository (001 when there are none). */
```

Replace with:

```text
/** Plan 049: the folder's default branch as of its last fetch: the numbered folders it is past HEAD in, and its plan files. */
export interface FolderUpstream {
  ref: string;
  ahead: NumberedAhead[];
  plans: string[];
}

/** Plan 049: a folder where the default branch already uses higher numbers than this branch. */
export interface NumberedAhead {
  dir: string;
  local: string | null;
  upstream: string;
}

/**
 * Plan 049: the highest number in each folder of numbered files (`docs/plans/012-x.md`,
 * `supabase/migrations/053_y.sql`), as written. Files at the repository root are left out.
 */
export function numberedMax(files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of files) {
    const m = /^((?:[^/]+\/)+)(\d+)[-_][^/]*$/.exec(f);
    if (!m) continue;
    const dir = m[1]!;
    const num = m[2]!;
    const was = out[dir];
    if (was === undefined || Number(num) > Number(was)) out[dir] = num;
  }
  return out;
}

/** Plan 049: the folders where `upstream` goes past `local` (or `local` has none), sorted by folder. */
export function numberedAhead(
  local: Record<string, string>,
  upstream: Record<string, string>,
): NumberedAhead[] {
  return Object.keys(upstream)
    .sort(cmp)
    .filter((dir) => local[dir] === undefined || Number(upstream[dir]) > Number(local[dir]))
    .map((dir) => ({ dir, local: local[dir] ?? null, upstream: upstream[dir]! }));
}

/** Plan 049: the plan's note on numbered folders where the default branch is past this branch. */
function numberedSection(n: { ref: string; ahead: NumberedAhead[] } | null): string[] {
  // why: the plan's own number already accounts for docs/plans/.
  const ahead = (n?.ahead ?? []).filter((a) => a.dir !== 'docs/plans/');
  if (!n || !ahead.length) return [];
  const shown = ahead.slice(0, 30);
  return [
    '## Numbered files',
    '',
    `\`${n.ref}\` (as of the last fetch before this run started) already has numbered files past this branch's. A new file in one of these folders takes the next number after the higher of the two, so it does not clash when the branches meet:`,
    '',
    ...shown.map(
      (a) =>
        `- \`${a.dir}\`: this branch goes up to ${a.local === null ? 'none' : `\`${a.local}\``}, \`${n.ref}\` to \`${a.upstream}\`.`,
    ),
    ...(ahead.length > shown.length ? [`- and ${ahead.length - shown.length} more folders.`] : []),
    '',
  ];
}

/** The next free `docs/plans/NNN-` number in the repository (001 when there are none). */
```

### 5. The engine reads the default branch once, at the start of the run

In `packages/core/src/engine.ts`:

Find:

```text
  featureIssues,
  nextPlanNumber,
  outsideIntentIssues,
```

Replace with:

```text
  featureIssues,
  nextPlanNumber,
  numberedAhead,
  numberedMax,
  outsideIntentIssues,
```

Find:

```text
  ticketId,
  type EnhancePlanRecord,
} from './enhance.js';
```

Replace with:

```text
  ticketId,
  type EnhancePlanRecord,
  type FolderUpstream,
} from './enhance.js';
```

Find:

```text
    this.record(runId, 'step.ok', {
      step: 'folder.base',
      data: { head: v.git!.head, branch: v.git!.branch, origin: v.git!.origin },
    });
```

Replace with:

```text
    // Plan 049: what the folder's default branch holds as of its last fetch (nothing is fetched), so the
    // plan and the agent's new numbered files are numbered past it.
    const up = await git.upstreamFiles(this.runDir(s));
    const upstream: FolderUpstream | null = up
      ? {
          ref: up.ref,
          // why: both lists come from git; the scan's file view skips vendor/ and build/ and stops at 5,000 files.
          ahead: numberedAhead(numberedMax(up.head), numberedMax(up.files)),
          plans: up.files.filter((f) => /^docs\/plans\/\d{3}-/.test(f)),
        }
      : null;
    this.record(runId, 'step.ok', {
      step: 'folder.base',
      data: { head: v.git!.head, branch: v.git!.branch, origin: v.git!.origin, upstream },
    });
```

### 6. The plan is numbered and annotated from it

In `packages/core/src/engine.ts`, inside `enhanceDelivery`:

Find:

```text
    const planPath =
      prior?.planPath ?? sameDay ?? `docs/plans/${nextPlanNumber(repoFiles)}-enhance-${date}.md`;
```

Replace with:

```text
    // Plan 049: a folder run also numbers past the plans its default branch already has.
    const upstream =
      (
        this.state(runId).steps['folder.base']?.data as
          { upstream?: FolderUpstream | null } | undefined
      )?.upstream ?? null;
    const planPath =
      prior?.planPath ??
      sameDay ??
      `docs/plans/${nextPlanNumber([...repoFiles, ...(upstream?.plans ?? [])])}-enhance-${date}.md`;
```

Find:

```text
      planPath,
      features,
      targets,
      base,
      // No Incubator gate in the repository, and none arriving with this delivery.
```

Replace with:

```text
      planPath,
      features,
      targets,
      base,
      numbered: upstream ? { ref: upstream.ref, ahead: upstream.ahead } : null,
      // No Incubator gate in the repository, and none arriving with this delivery.
```

### 7. Unit tests for the numbered folders

In `packages/core/src/enhance.test.ts`:

Find:

```text
  nextPlanNumber,
  resolveTargets,
```

Replace with:

```text
  nextPlanNumber,
  numberedAhead,
  numberedMax,
  resolveTargets,
```

Find:

```text
  it('numbers plans after the highest existing one', () => {
```

Replace with:

```text
  it('finds numbered folders where the default branch is past this branch (plan 049)', () => {
    const local = numberedMax([
      'docs/plans/007-a.md',
      'supabase/migrations/051_x.sql',
      'supabase/migrations/049_y.sql',
      '01-root.md',
      'src/app.ts',
    ]);
    expect(local).toEqual({ 'docs/plans/': '007', 'supabase/migrations/': '051' });
    const upstream = numberedMax([
      'docs/plans/007-a.md',
      'supabase/migrations/053_z.sql',
      'db/seeds/002_s.sql',
    ]);
    expect(numberedAhead(local, upstream)).toEqual([
      { dir: 'db/seeds/', local: null, upstream: '002' },
      { dir: 'supabase/migrations/', local: '051', upstream: '053' },
    ]);
    expect(numberedMax(['db/9_a.sql', 'db/10_b.sql'])).toEqual({ 'db/': '10' });
    expect(numberedAhead({ 'db/': '9' }, { 'db/': '10' })).toEqual([
      { dir: 'db/', local: '9', upstream: '10' },
    ]);
    expect(numberedAhead(upstream, upstream)).toEqual([]);
  });

  it('numbers plans after the highest existing one', () => {
```

### 8. The end-to-end test on a folder behind origin/main

In `packages/core/src/folder-runs.test.ts`, inside `describe('an update run keeps going until every request is done (plan 043)', ...)`:

Find:

```text
  it('tells the next part which request is left, and finishes when it is done', async () => {
```

Replace with:

```text
  it('numbers the plan past origin/main and lists its numbered folders, when the folder is behind (plan 049)', async () => {
    const { h, dir, runId } = await seeded();
    vi.stubEnv('FAKE_AGENT_MARKS', '99');
    // A numbered file in a folder the scan skips (vendor/), the same on both sides: never listed.
    mkdirSync(path.join(dir, 'vendor', 'lib'), { recursive: true });
    writeFileSync(path.join(dir, 'vendor', 'lib', '01_same.sql'), '-- same\n');
    expect((await git(['add', '-A'], dir)).code).toBe(0);
    expect((await git(['commit', '-q', '-m', 'vendor'], dir)).code).toBe(0);
    expect((await git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], dir)).code).toBe(0);
    // Someone else pushed to origin/main; the folder fetched it, but its own main is behind.
    const other = path.join(mkdtempSync(path.join(os.tmpdir(), 'other-clone-')), 'repo');
    const url = await out(['remote', 'get-url', 'origin'], dir);
    expect((await git(['clone', '-q', url, other], os.tmpdir())).code).toBe(0);
    mkdirSync(path.join(other, 'db', 'migrations'), { recursive: true });
    writeFileSync(path.join(other, 'db', 'migrations', '005_new.sql'), '-- new\n');
    mkdirSync(path.join(other, 'docs', 'plans'), { recursive: true });
    writeFileSync(path.join(other, 'docs', 'plans', '009-other.md'), '# other\n');
    expect((await git(['add', '-A'], other)).code).toBe(0);
    expect(
      (
        await git(
          ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'other'],
          other,
        )
      ).code,
    ).toBe(0);
    expect((await git(['push', '-q', 'origin', 'HEAD:refs/heads/main'], other)).code).toBe(0);
    expect((await git(['fetch', '-q', 'origin'], dir)).code).toBe(0);
    await h.engine.advance(runId, new DefaultsPrompter());
    const planPath = h.engine.enhanceSummary(runId).plan!.planPath;
    expect(planPath).toBe('docs/plans/010-enhance-20260501.md');
    const plan = readFileSync(path.join(dir, planPath), 'utf8');
    expect(plan).toContain('## Numbered files');
    expect(plan).toContain(
      '- `db/migrations/`: this branch goes up to none, `origin/main` to `005`.',
    );
    // The plan's own number already accounts for docs/plans/, and vendor/ is the same on both sides.
    expect(plan).not.toContain('- `docs/plans/`');
    expect(plan).not.toContain('vendor/');
  });

  it('tells the next part which request is left, and finishes when it is done', async () => {
```

### 9. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/git/src/gitops.ts packages/git/src/gitops.test.ts packages/core/src/testing.ts packages/core/src/enhance.ts packages/core/src/enhance.test.ts packages/core/src/engine.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                    | Marker                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `packages/git/src/gitops.ts`            | `upstreamFiles(dir: string): Promise<{ ref: string; files: string[]; head: string[] }`                   |
| `packages/git/src/gitops.test.ts`       | `lists the default branch's files as of the last fetch, and fetches nothing itself (plan 049)`           |
| `packages/core/src/testing.ts`          | `'upstreamFiles',`                                                                                       |
| `packages/core/src/enhance.ts`          | `export function numberedMax(files: readonly string[]): Record<string, string> {`                        |
| `packages/core/src/enhance.test.ts`     | `finds numbered folders where the default branch is past this branch (plan 049)`                         |
| `packages/core/src/engine.ts`           | `const up = await git.upstreamFiles(this.runDir(s));`                                                    |
| `packages/core/src/folder-runs.test.ts` | `numbers the plan past origin/main and lists its numbered folders, when the folder is behind (plan 049)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/git/src/gitops.test.ts packages/core/src/enhance.test.ts tests/scenarios.test.ts
pnpm exec vitest run --project unit packages/core/src/folder-runs.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "upstreamFiles(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/git packages/core
pnpm check:quick
```

```text
gitops.test.ts, enhance.test.ts and tests/scenarios.test.ts pass, including the new plan 049 tests
folder-runs.test.ts passes, including the new plan 049 test
the Select-String count prints 1
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                              | Why                                                                                                                                        | Mechanical check                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The default branch is read in `enhanceDelivery`, at preview and again at scaffold | the REVIEW preview and the SCAFFOLD step must build the same plan (`enhanceDelivery` is documented as pure with respect to the repository) | the read is in `checkOwnerFolder` only, and the folders that are behind are recorded once in `folder.base`; the acceptance commands count `upstreamFiles(` in `engine.ts` and expect 1 |
| The two sides are listed differently                                              | the scan's file view skips `vendor/`, `build/` and more, and stops at 5,000 files, while `ls-tree` lists every tracked file                | both sides come from `git ls-tree` (`files` and `head`); the folder-runs test commits `vendor/lib/01_same.sql` on both sides and asserts the plan does not mention `vendor/`           |
| The test engine's git wrapper misses the new method                               | `testing.ts` lists every method by name; a missing one is `undefined` at run time, not a type error                                        | the folder-runs test calls it through `fakePublishEngine`; work item 2 adds `'upstreamFiles'`                                                                                          |
| A run whose folder is up to date gets a different plan                            | every existing enhance test runs on a folder whose `origin/main` equals its `main`                                                         | `numberedSection` returns `[]` when nothing is ahead; the existing enhance and scenario tests (exact plan paths such as `docs/plans/001-enhance-20260501.md`) still pass               |
| A name from `origin/HEAD` is passed to git as an option                           | the ref name comes from git's own output                                                                                                   | only names matching `^origin\/[A-Za-z0-9._/-]+$` are used; `ls-tree` receives `refs/remotes/<name>`, which cannot start with a dash, and the call ends with `--`                       |
| Something is fetched over the network                                             | a fetch could prompt for credentials or change refs                                                                                        | `upstreamFiles` runs `rev-parse` and `ls-tree` only; the gitops test shows a commit made after the clone stays invisible until the test fetches it itself                              |
| Numbers compared as text                                                          | `'9' > '10'` as strings                                                                                                                    | the unit test has `9` and `10` in one folder and expects `10`, and lists `db/` as behind for `9` against `10`                                                                          |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2     | Opus review: the branch side came from the scan's capped, filtered file view while the default branch came from git, so an up-to-date repository could list folders; both now come from git and the behind folders are recorded once; the number test now catches text comparison; docs/plans/ left out of the note; list capped at 30; plan formatted for check:quick | CLOSED |
| 1     | Follow-up from a real update run: plans and migrations were numbered from a stale local branch (051 clashed with origin/main's 052/053)                                                                                                                                                                                                                                | CLOSED |
