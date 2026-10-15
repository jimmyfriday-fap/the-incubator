# Plan 053: a new project's GitHub owner is checked before anything is written, and the park says which account to use

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 6 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `packages/git/src/github.ts` contains `getRepo(ref: RepoRef): Promise<RepoInfo | null>;` and that `packages/core/src/publish.ts` contains `{ code: 'no_owner' },`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A new project's plan said the GitHub owner was the organization `backshack`, which does not exist (the owner has no organizations). The run scaffolded and verified the whole project and only then parked at PUBLISH with `github_404` ("create repository: HTTP 404 Not Found"), with nothing in the message about the owner. The name check in `preflight` reads `GET /repos/{owner}/{name}`, and a missing organization makes that a 404 too, which `getRepo` reports as "no such repository, the name is free". So the owner was never checked.

After this plan, `preflight` (it runs at the start of SCAFFOLD, before any file is rendered) asks GitHub whether the owner exists (`GET /users/{login}` answers for users and organizations). A missing owner parks the run at once with `owner_not_found` and says which account the token belongs to, so the owner can switch to their own account. Nothing else about owners changes: whether the owner is a user or an organization is not compared.

## Work items

### 1. The GitHub adapter and its fake

In `packages/git/src/github.ts`:

Find:

```text
  getRepo(ref: RepoRef): Promise<RepoInfo | null>;
```

Replace with:

```text
  getRepo(ref: RepoRef): Promise<RepoInfo | null>;
  /** Plan 053: whether `login` is a GitHub user or an organization (`GET /users/{login}`); null when there is no such account. */
  ownerKind(login: string): Promise<'user' | 'org' | null>;
```

Find:

```text
      protectionUnsupported?: boolean;
    } = {},
```

Replace with:

```text
      protectionUnsupported?: boolean;
      /** Plan 053: owners that do not exist on this fake GitHub; every other owner is found (the token's login as a user, the rest as organizations). */
      missingOwners?: string[];
    } = {},
```

Find:

```text
  getRepo(ref: RepoRef): Promise<RepoInfo | null> {
    return this.call('getRepo', [ref], () => {
```

Replace with:

```text
  ownerKind(login: string): Promise<'user' | 'org' | null> {
    return this.call('ownerKind', [login], () => {
      const wanted = login.toLowerCase();
      if (this.opts.missingOwners?.some((m) => m.toLowerCase() === wanted)) return null;
      return wanted === (this.opts.login ?? 'octo').toLowerCase() ? 'user' : 'org';
    });
  }

  getRepo(ref: RepoRef): Promise<RepoInfo | null> {
    return this.call('getRepo', [ref], () => {
```

### 2. The live adapter

In `packages/git/src/octokit.ts`:

Find:

```text
  async getRepo(ref: RepoRef): Promise<RepoInfo | null> {
```

Replace with:

```text
  async ownerKind(login: string): Promise<'user' | 'org' | null> {
    const res = await orNull('get owner', this.kit.rest.users.getByUsername({ username: login }));
    if (!res) return null;
    return res.data.type === 'Organization' ? 'org' : 'user';
  }

  async getRepo(ref: RepoRef): Promise<RepoInfo | null> {
```

### 3. The owner check in the preflight

In `packages/core/src/publish.ts`:

Find:

```text
        { code: 'no_owner' },
      );
    for (const name of this.repoNames(ctx.spec)) {
```

Replace with:

```text
        { code: 'no_owner' },
      );
    // Plan 053: a missing organization makes the name check below read "free" (a 404), and the run then fails at PUBLISH.
    if (!(await gh.ownerKind(ctx.spec.project.owner.login)))
      throw new PolicyError(
        `the GitHub owner "${ctx.spec.project.owner.login}" was not found, or the token cannot see it. The token belongs to "${info.login}": to publish under that account, set project.owner to { "type": "user", "login": "${info.login}" } in incubator.json and resume.`,
        { code: 'owner_not_found' },
      );
    for (const name of this.repoNames(ctx.spec)) {
```

### 4. A test for the live adapter

In `packages/git/src/octokit.test.ts`:

Find:

```text
  it('gets and creates repositories for users and orgs', async () => {
```

Replace with:

```text
  it('tells a user, an organization and a missing owner apart (plan 053)', async () => {
    const { gh } = make({
      'GET /users/octo': { status: 200, body: { login: 'octo', type: 'User' } },
      'GET /users/acme': { status: 200, body: { login: 'acme', type: 'Organization' } },
      'GET /users/ghost': { status: 404, body: { message: 'Not Found' } },
    });
    expect(await gh.ownerKind('octo')).toBe('user');
    expect(await gh.ownerKind('acme')).toBe('org');
    expect(await gh.ownerKind('ghost')).toBeNull();
  });

  it('gets and creates repositories for users and orgs', async () => {
```

### 5. Tests for the publish step

In `packages/core/src/publish.test.ts`:

Find:

```text
      [
        "tokenInfo",
        "getRepo",
        "getRepo",
        "createRepo",
```

Replace with:

```text
      [
        "tokenInfo",
        "ownerKind",
        "getRepo",
        "getRepo",
        "createRepo",
```

Find:

```text
  it('warns instead of failing when branch protection is unavailable', async () => {
```

Replace with:

```text
  it('parks before rendering anything when the GitHub owner does not exist, and says which account to use (plan 053)', async () => {
    const h = fakePublishEngine({ github: { missingOwners: ['backshack'] } });
    const base = spec('node-lib.in-repo.package-release');
    const runId = h.engine.startFromSpec(
      { ...base, project: { ...base.project, owner: { type: 'org', login: 'backshack' } } },
      { kind: 'scaffold', surface: 'test' },
    );
    const s = await h.engine.advance(runId, undefined as never);
    expect(s.state).toBe('PARKED');
    expect(s.parked).toMatchObject({ state: 'SCAFFOLD', reason: 'owner_not_found' });
    const park = h.engine.entries(runId).findLast((e) => e.type === 'park');
    expect(park?.['message']).toContain('"backshack" was not found');
    expect(park?.['message']).toContain('"octo"');
    expect(h.github.calls.some((c) => c.method === 'createRepo')).toBe(false);
    expect(h.engine.state(runId).steps['render']).toBeUndefined();
  });

  it('warns instead of failing when branch protection is unavailable', async () => {
```

### 6. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/git/src/github.ts packages/git/src/octokit.ts packages/git/src/octokit.test.ts packages/core/src/publish.ts packages/core/src/publish.test.ts
```

## Touched files and markers

| File                                | Marker                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `packages/git/src/github.ts`        | `ownerKind(login: string): Promise<'user' \| 'org' \| null>;`          |
| `packages/git/src/octokit.ts`       | `async ownerKind(login: string)`                                       |
| `packages/git/src/octokit.test.ts`  | `tells a user, an organization and a missing owner apart (plan 053)`   |
| `packages/core/src/publish.ts`      | `code: 'owner_not_found'`                                              |
| `packages/core/src/publish.test.ts` | `parks before rendering anything when the GitHub owner does not exist` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/git/src/octokit.test.ts packages/core/src/publish.test.ts tests/scenarios.test.ts
(Select-String -SimpleMatch -Path packages/core/src/publish.ts "ownerKind(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/git packages/core
pnpm check:quick
```

```text
octokit.test.ts, publish.test.ts and tests/scenarios.test.ts pass, including the two new plan 053 tests
the Select-String count prints 1
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                   | Why                                                                                             | Mechanical check                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The check runs after the project is rendered           | the whole point is to stop before scaffolding; `preflight` already runs first in `scaffoldStep` | the new publish test asserts the run parked at `SCAFFOLD` and that `steps['render']` is undefined                                                                         |
| The call sequence snapshot is left stale               | `preflight` now makes one more GitHub call                                                      | the inline snapshot in `publish.test.ts` is updated by work item 5; the first acceptance command fails if it is not                                                       |
| Existing runs with other owners start failing          | the fake used to know no owners                                                                 | `FakeGitHub.ownerKind` finds every owner except `missingOwners`; the existing publish, adopt and enhance tests run in the first acceptance command and `pnpm check:quick` |
| The owner type (user or organization) is compared      | the spec's `owner.type` can be wrong for a real account; comparing would add a new failure      | `ownerKind`'s answer is only tested for null in `publish.ts`; the Select-String count of `ownerKind(` in `publish.ts` prints 1                                            |
| A user whose login differs in case is reported missing | GitHub logins are case-insensitive                                                              | the fake compares lower-cased logins; the live check uses GitHub's own lookup                                                                                             |

## Review rounds

| Round | Finding                                                                                                                                                                                                               | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Follow-up from a real new-project run (Repo Audit and Adopt): the plan named the nonexistent organization `backshack`; the run scaffolded, verified, and only then parked with an unexplained `github_404` at PUBLISH | CLOSED |
