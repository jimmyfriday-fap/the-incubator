# Plan 054: a new project is owned by the GitHub account of the token, private, and the owner is not asked

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 5 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/core/src/publish.ts` contains `private ref(spec: IncubatorSpec, name = spec.project.slug): RepoRef {` and that `packages/core/src/engine.ts` contains `private async draftStep(runId: string, s: RunState): Promise<void> {`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A new project starts with no owner (`project.owner.login` is empty), so the model asks the owner two questions: "Who should own the GitHub repository?" and "Which GitHub org should own the repository?". An owner with no organization has to guess a name. In a real run the answers were an organization that does not exist, and the run failed at PUBLISH (plan 053 now catches that early). The owner wants a personal, private repository by default.

After this plan, when a new project's discovery starts and publishing is configured, the engine reads the GitHub account the token belongs to (best effort). It sets the draft's owner to that account as a user, and records the two owner decisions with source `default`. The engine already drops a model's question for a key that is decided with a source other than `inferred` ("already decided"), so the owner is no longer asked. The visibility stays `private` (the spec default). The owner can still change the owner at review, in the spec editor. Nothing changes when publishing is not configured, when no account can be read (no token, or GitHub unreachable), or when an owner is already set or decided; adopt and update runs are untouched.

## Work items

### 1. The account of the token

In `packages/core/src/publish.ts`:

Find:

```text
  private ref(spec: IncubatorSpec, name = spec.project.slug): RepoRef {
```

Replace with:

```text
  /** Plan 054: the GitHub account the token belongs to; null when there is no token or GitHub cannot be reached. */
  async accountLogin(): Promise<string | null> {
    try {
      const { gh } = await this.github();
      return (await gh.tokenInfo()).login || null;
    } catch {
      return null;
    }
  }

  private ref(spec: IncubatorSpec, name = spec.project.slug): RepoRef {
```

### 2. The engine sets the owner before the model is asked

In `packages/core/src/engine.ts`:

Find:

```text
  private async draftStep(runId: string, s: RunState): Promise<void> {
```

Replace with:

```text
  /**
   * Plan 054: a new project is owned by the GitHub account of the token, so the model is never asked who owns it.
   * Skipped when publishing is not configured, when no account can be read, or when an owner is already set or decided.
   */
  private async defaultOwner(runId: string, s: RunState): Promise<void> {
    if (s.input.kind !== 'new' || !this.deps.publish) return;
    const draft = this.draft(runId);
    const decisions = draft.decisions ?? [];
    const project = (draft['project'] ?? {}) as { owner?: { login?: string } };
    if (project.owner?.login || decisions.some((d) => d.key.startsWith('project.owner'))) return;
    const login = await this.publisher().accountLogin();
    if (!login) return;
    this.writeRevision(runId, {
      ...draft,
      project: { ...project, owner: { type: 'user', login } },
      decisions: [
        ...decisions,
        {
          key: 'project.owner.type',
          question: 'Who owns the GitHub repository?',
          answer: 'user',
          source: 'default',
        },
        {
          key: 'project.owner.login',
          question: 'Which GitHub account owns the repository?',
          answer: login,
          source: 'default',
        },
      ],
    });
  }

  private async draftStep(runId: string, s: RunState): Promise<void> {
```

Find:

```text
    const before = this.draft(runId);
    const narrative = this.narrativeFor(runId, s);
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
```

Replace with:

```text
    await this.defaultOwner(runId, s);
    const before = this.draft(runId);
    const narrative = this.narrativeFor(runId, s);
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
```

### 3. A test: the owner is the token's account, and the model's owner questions are dropped

In `packages/core/src/publish.test.ts`:

Find:

```text
import { FAKE_GITHUB_TOKEN, fakePublishEngine } from './testing.js';
```

Replace with:

```text
import { DefaultsPrompter } from './prompter.js';
import { FAKE_GITHUB_TOKEN, discoveryFixtureDir, fakePublishEngine } from './testing.js';
```

Find:

```text
  it('warns instead of failing when branch protection is unavailable', async () => {
```

Replace with:

```text
  it('owns a new project by the account of the token, as a default decision, and keeps it private (plan 054)', async () => {
    const h = fakePublishEngine({
      github: { login: 'jimmy' },
      llm: { dir: discoveryFixtureDir('ts-library') },
    });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'A small TypeScript library.',
      specOnly: true,
      surface: 'test',
    });
    expect((await h.engine.advance(runId, new DefaultsPrompter())).state).toBe('DONE');
    const draft = h.engine.draft(runId) as unknown as {
      project: { owner: unknown; visibility: string };
      decisions: { key: string; answer: string; source: string }[];
    };
    expect(draft.project.owner).toEqual({ type: 'user', login: 'jimmy' });
    expect(draft.project.visibility).toBe('private');
    expect(draft.decisions.filter((d) => d.key.startsWith('project.owner'))).toEqual([
      expect.objectContaining({ key: 'project.owner.type', answer: 'user', source: 'default' }),
      expect.objectContaining({ key: 'project.owner.login', answer: 'jimmy', source: 'default' }),
    ]);
    expect(h.github.calls.filter((c) => c.method === 'tokenInfo')).toHaveLength(1);
  });

  it('leaves the owner empty for a new project when no account can be read (plan 054)', async () => {
    const h = fakePublishEngine({
      github: { failAtTokenInfo: true },
      llm: { dir: discoveryFixtureDir('ts-library') },
    });
    const runId = h.engine.start({
      kind: 'new',
      narrative: 'A small TypeScript library.',
      specOnly: true,
      surface: 'test',
    });
    await h.engine.advance(runId, new DefaultsPrompter());
    const draft = h.engine.draft(runId) as unknown as { project: { owner: { login: string } } };
    expect(draft.project.owner.login).toBe('');
  });

  it('warns instead of failing when branch protection is unavailable', async () => {
```

### 4. The fake GitHub can fail its token check

The second test above needs the fake to fail `tokenInfo` on request.

In `packages/git/src/github.ts`:

Find:

```text
      protectionUnsupported?: boolean;
```

Replace with:

```text
      protectionUnsupported?: boolean;
      /** Plan 054: `tokenInfo` throws, as when GitHub cannot be reached. */
      failAtTokenInfo?: boolean;
```

Find:

```text
    return this.call('tokenInfo', [], () => ({
      login: this.opts.login ?? 'octo',
      kind: this.opts.kind ?? 'classic',
      scopes: this.opts.scopes ?? ['repo', 'workflow'],
    }));
```

Replace with:

```text
    return this.call('tokenInfo', [], () => {
      if (this.opts.failAtTokenInfo)
        throw new ToolError('fake: GitHub cannot be reached', { code: 'injected' });
      return {
        login: this.opts.login ?? 'octo',
        kind: this.opts.kind ?? 'classic',
        scopes: this.opts.scopes ?? ['repo', 'workflow'],
      };
    });
```

### 5. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/publish.ts packages/core/src/engine.ts packages/core/src/publish.test.ts packages/git/src/github.ts
```

## Touched files and markers

| File                                | Marker                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `packages/core/src/publish.ts`      | `async accountLogin(): Promise<string \| null> {`                         |
| `packages/core/src/engine.ts`       | `private async defaultOwner(runId: string, s: RunState): Promise<void> {` |
| `packages/core/src/publish.test.ts` | `owns a new project by the account of the token, as a default decision`   |
| `packages/git/src/github.ts`        | `failAtTokenInfo?: boolean;`                                              |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/publish.test.ts packages/core/src/discovery.test.ts packages/core/src/stop.test.ts tests/scenarios.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "defaultOwner(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core packages/git
pnpm check:quick
```

```text
publish.test.ts, discovery.test.ts, stop.test.ts and tests/scenarios.test.ts pass, including the two new plan 054 tests
the Select-String count prints 2
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                  | Why                                                                                                    | Mechanical check                                                                                                                                    |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recorded discovery fixtures stop matching                             | their prompt keys include the draft; the discovery tests build an engine with no publishing configured | `defaultOwner` returns at once without `deps.publish`; `discovery.test.ts` (which uses `fakeEngine`) runs unchanged in the first acceptance command |
| Adopt and update runs get an owner of their own                       | they take the owner from the repository they read                                                      | `defaultOwner` returns unless `s.input.kind` is `'new'`; the adopt and enhance tests run in `pnpm check:quick`                                      |
| The owner questions are still asked                                   | `selectQuestions` drops a question only for a key decided with a source other than `inferred`          | both decisions are recorded with source `'default'`; the publish test checks the decisions                                                          |
| An owner the model or the owner set is overwritten                    | a re-entered DRAFT_SPEC round would run the default again                                              | `defaultOwner` returns when `project.owner.login` is set or any decision key starts with `project.owner`                                            |
| A run with no token fails instead of continuing                       | the owner questions are a fallback and must stay possible                                              | `accountLogin` catches every error and returns null; the second publish test shows the owner stays empty                                            |
| `tokenInfo` is called an extra time in an existing call-sequence test | the sequence test uses `startFromSpec`, which never runs DRAFT_SPEC                                    | the existing "TDD call sequence" inline snapshot is untouched by this plan                                                                          |

## Review rounds

| Round | Finding                                                                                                                                                                                                           | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from a real new-project run (Repo Audit and Adopt): the questions offered an organization, the owner has none, and the run failed at PUBLISH; the owner wants a personal, private repository by default | CLOSED |
