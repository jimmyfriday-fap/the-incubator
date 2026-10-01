# Plan 009: Phase 8 — the wizard and the local-folder workflow

## Executor preamble

The owner asked for the app to open as a wizard (ADR-022, ADR-023):

- A first dropdown, "What would you like to do", with **New solution** and **Update an existing solution**.
  Each leads into a path that already exists.
- Both paths start by choosing a **local folder** with the native folder dialog (desktop app and
  `incubator ui`), with a paste-a-path fallback.
- **New solution:** the chosen folder itself becomes the repository (empty or missing, else refused).
  GitHub stays up front, as today.
- **Update:** the coding agent works in the owner's own folder on a new branch; the working tree must be
  clean and the current branch is never written to.
- After the coding iteration, **commit and push are requests shown to the owner** (changed files, the
  agent's own summary, a drafted message). The agent loses `git commit`.

Pieces: a host-capability hook on the web server (the renderer still only speaks HTTP, ADR-012
unchanged); `inspectFolder`; folder runs in the engine (`dir`, the `CODE`, `COMMIT` and `PUSH`
states); new `GitOps` (`status`, `fetch`, `checkout`, `remoteAdd`, owner-identity commit, `--` before clone
operands); a handoff that streams progress and keeps the agent's summary; the wizard UI.

Hard rules: the owner's files are never deleted or overwritten; the owner's current branch is never
written to; no subprocess through a shell; no live tests; no pinned-contract changes (a folder is run
input, not spec); no edits to `security/accepted-risks.json` or run ceilings. Source of truth:
`docs/TDD.md` §7.5 and §9.

## Touched files and markers

| File or directory                                                                   | Marker / note                                                                |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/git/src/gitops.ts`                                                        | `status`, `fetch`, `checkout`, `remoteAdd`, owner-identity commit, `--`      |
| `packages/core/src/{handoff,folders,finish,engine,publish,store,state,testing}.ts`  | allowed tools without commit; `summary`; folder runs; CODE/COMMIT/PUSH       |
| `packages/core/prompts/handoff.md`                                                  | v1.1.0: the agent does not commit                                            |
| `packages/core/fixtures/handoff/fake-agent.mjs`                                     | `edit` mode: writes a file, emits result text                                |
| `apps/web/src/server/{server,driver}.ts`, `apps/web/src/api-types.ts`               | `host.pickFolder`, `/api/folders/*`, coding/commit/push routes               |
| `apps/web/src/ui/views/{Home,Wizard,Coding,FinishChanges}.tsx`                      | the wizard, live progress, the commit and push requests                      |
| `apps/cli/src/{folder-picker.ts,commands/{finish,new,enhance,resume,ui}.ts}`        | native picker per OS; `new --dir`, `enhance --in-place`, `resume --commit`   |
| `apps/desktop/{src/main.ts,src/testing-fixtures/fakes.ts,scripts/build.mjs,smoke/}` | `dialog.showOpenDialog` as the host picker; test-build fake picker and agent |
| `tests/scenarios/local-folder/`, `tests/adapters/local-folder.ts`                   | happy, validation and fault scenarios                                        |

## Acceptance commands

```sh
pnpm check:quick
pnpm vitest run --project unit packages/core packages/git apps/cli apps/web tests/scenarios.test.ts
pnpm --filter @incubator/web build:ui && pnpm vitest run --project e2e
xvfb-run -a pnpm test:desktop-smoke
pnpm check
```

```text
pnpm check exits 0
both wizard paths run from the dropdown to DONE in a real browser and in the Electron test build
the owner's files are never deleted; the original branch is unchanged; commit and push need approval
```

## Drift and hallucination guardrails

| Trap                                             | Why                                       | Mechanical check                                                               |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------ |
| The Publisher wipes or cleans the owner's folder | Its workspace mode deletes and re-renders | folder mode never calls the wipe; a test seeds a file and asserts it survives  |
| The agent commits or pushes on its own           | The owner approves both                   | `git commit`/`add`/`checkout -b` absent from the allowed tools; a unit test    |
| Work lands on the owner's current branch         | Never write to it                         | clean-tree check, a new branch, a test comparing the original branch's SHA     |
| A renderer reaches the OS                        | ADR-012: no preload, no IPC               | the picker is an HTTP route; desktop smoke still sees no `require`             |
| A path is injected into a shell or a git option  | User-chosen path                          | argv only, `--` before operands, a test with a path containing a space and `-` |
| Staging deploys from agent work                  | `main` deploys staging                    | coding happens on `incubator/build-<date>`; the PR targets `main`              |
| A resumed run repeats an effect                  | Duplicate commit or PR                    | journaled steps, crash-resume matrix for CODE, COMMIT and PUSH                 |

## Review rounds

| Round | Finding                                                                | Status |
| ----- | ---------------------------------------------------------------------- | ------ |
| 1     | Plan drafted and approved by the owner, decisions recorded in ADR-023  | CLOSED |
| 2     | The picker's `purpose` only picks a title; no input reaches a script   | CLOSED |
| 3     | A folder re-check was missing after the owner cleans up: "Check again" | CLOSED |
| 4     | `--yes` must not stand in for consent to commit or push (CLI)          | CLOSED |
