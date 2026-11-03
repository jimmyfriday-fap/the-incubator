# Plan 069: reverse out of a run that did not finish

## Executor preamble

A run that is parked, failed, stopped or cancelled can be reversed out from its page. "Reverse out" shows what
would be removed and what would stay, then removes the run's branch in the owner's folder (going back to the
branch the owner started on first), a Backshack run's worktree and its branch, the run's folder under the
Incubator home, and the run's place in the portfolio. Everything goes through `GitOps` (`Exec`, no shell) and
`RunStore.remove`. Uncommitted work in the owner's folder is never discarded: the plan refuses with `dirty_tree`.
A Backshack worktree with uncommitted files needs an explicit confirmation. A GitHub repository the run created
is named with its link and left alone. Refusals answer 422, like the other policy refusals.

## Touched files and markers

| File                                  | Marker                                        |
| ------------------------------------- | --------------------------------------------- |
| packages/core/src/reverse-out.ts      | `export function planReverseOut(`             |
| packages/core/src/engine.ts           | `async reverseOut(`                           |
| packages/core/src/portfolio.ts        | `detachRun(runId: string)`                    |
| packages/git/src/gitops.ts            | `async deleteBranch(dir, branch)`             |
| packages/git/src/gitops.ts            | `async worktreeRemove(repo, dir, force)`      |
| apps/web/src/server/server.ts         | `/api/runs/:id/reverse-out`                   |
| apps/web/src/ui/views/ReverseOut.tsx  | `export function ReverseOut(`                 |
| packages/core/src/reverse-out.test.ts | `planning a reverse-out (plan 069)`           |
| packages/git/src/gitops.test.ts       | `removing a branch and a worktree (plan 069)` |
| apps/web/src/server/server.test.ts    | `reverses out of a cancelled run`             |

## Acceptance commands

```bash
pnpm exec vitest run --project unit packages/core/src/reverse-out.test.ts packages/git/src/gitops.test.ts apps/web/src/server/server.test.ts
pnpm check:quick
```

```text
Tests  all passed
exit 0
```

## Drift and hallucination guardrails

| Trap                                           | Why                                                | Mechanical check                                              |
| ---------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| The owner's uncommitted work is discarded      | The run branch may be checked out over their edits | reverse-out.test.ts "refuses to touch uncommitted work"       |
| A branch the Incubator did not make is deleted | A recorded name could be `main`                    | reverse-out.test.ts "never deletes a branch ... did not name" |
| A finished or working run is removed           | A finished run is the owner's result               | reverse-out.test.ts "refuses a working run ..."               |
| A GitHub repository is deleted                 | No undo; the owner decides                         | reverse-out.test.ts "names a repository ..."                  |
| A path outside the Incubator home is removed   | Only `store.runDir(runId)` is passed to `remove`   | engine `reverseOut` has no other `removeTree` call            |
| A new git method is missing from the test git  | The harness wraps a fixed list of methods          | server.test.ts reverse-out test (500 without it)              |

## Review rounds

| Round | Reviewer            | Finding                                   | Status |
| ----- | ------------------- | ----------------------------------------- | ------ |
| 1     | Claude (in-session) | Plan written and reviewed before dispatch | CLOSED |
