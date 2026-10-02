# Plan 010: a GitHub remote that is not `origin` is suggested for the push

## Executor preamble

On Windows the wizard showed "The origin is not a GitHub repository" for a folder whose `origin` is
GitLab and whose `github` remote is GitHub, which read like "this is not a git repository". Fix it in
`inspectFolder` (TDD §7.5): look at every remote, suggest the one GitHub remote that is not `origin`,
pre-fill the repository field of the wizard with it, and reword the warning so it says the folder is a
git repository and names only the host `origin` points to. The engine is unchanged: the push target
stays "explicit `repoRef`, else `origin`".

## Touched files and markers

| File or directory                                                                                      | Marker / note                                                                 |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/git/src/gitops.ts`, `packages/core/src/testing.ts`                                           | `remotes(dir)` and its wrapped-method entry                                   |
| `packages/core/src/folders.ts`                                                                         | `suggested`; `remoteHost`; the reworded warnings                              |
| `apps/web/src/api-types.ts`, `apps/web/src/ui/views/Wizard.tsx`                                        | `suggested` in the check; pre-fill that never overwrites typed text           |
| `apps/cli/src/commands/enhance.ts`                                                                     | prints the verdict warnings for `--in-place`                                  |
| `packages/git/src/gitops.test.ts`, `packages/core/src/folders.test.ts`, `apps/web/e2e/web.e2e.test.ts` | remotes, suggestion, several remotes, credential never shown, wizard pre-fill |
| `docs/TDD.md`                                                                                          | one paragraph in §7.5                                                         |

## Acceptance commands

```sh
pnpm exec vitest run packages/git/src/gitops.test.ts packages/core/src/folders.test.ts
INCUBATOR_E2E_CHANNEL=chrome pnpm check
```

```text
the unit tests pass; pnpm check exits 0
inspectFolder on a folder with origin on GitLab and a GitHub remote named github suggests that remote
```

## Drift and hallucination guardrails

| Trap                                                | Why                             | Mechanical check                                                                         |
| --------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| A remote URL with a token reaches the screen or log | the warning is shown and logged | folders.test.ts asserts the token and the user part are absent and only the host appears |
| The wizard overwrites what the owner typed          | the field is also an input      | e2e test types a value, re-checks the folder, and asserts the value survived             |
| Two GitHub remotes are guessed between              | a wrong push target is worse    | folders.test.ts asserts no suggestion and both repositories listed                       |
| A GitHub origin loses to a mirror                   | origin must keep priority       | folders.test.ts asserts origin stays the target and no suggestion is made                |

## Review rounds

| Round | Finding                                                                                                          | Status |
| ----- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Owner read "origin is not a GitHub repository" as "not a git repository" on a repo with a GitHub remote `github` | CLOSED |
