# Phase 8 — The wizard and the local-folder workflow: acceptance evidence

Plan: [docs/plans/009-phase-8-wizard.md](../plans/009-phase-8-wizard.md).
Decisions: [ADR-022](../adr/022-host-capabilities-over-http.md),
[ADR-023](../adr/023-local-folder-workflow.md). Design: [TDD §7.5 and §9](../TDD.md).

No pinned contract changed (a folder is run input, not spec), so there is no patch for the owner to
apply and no re-pin.

| #   | Criterion (owner's Phase 8 feedback)                                                                         | Status                                                   |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1   | The app opens on a dropdown "What would you like to do": New solution / Update an existing solution          | PASS (real Chromium, and Electron on Linux)              |
| 2   | Update: browse to a folder holding a local repository, with the native folder dialog                         | PASS with a fake picker; the real Windows dialog PENDING |
| 3   | New solution: pick the folder where the new repository is initialized                                        | PASS with a fake picker; the real Windows dialog PENDING |
| 4   | The coding agent works in that folder; the agent can no longer commit, add or check out                      | PASS                                                     |
| 5   | Commit and push are requests at the end of the coding iteration, based on the agent's reported result        | PASS (web, desktop on fakes, CLI)                        |
| 6   | The owner's files are never deleted; the starting branch is never written to; commit is as the owner         | PASS                                                     |
| 7   | New and crashed runs resume without a second commit or PR (journaled CODE, COMMIT, PUSH)                     | PASS                                                     |
| 8   | `incubator ui` offers the same native dialog (PowerShell, osascript, zenity/kdialog); paste-a-path fallback  | PASS (argv and parsing); real dialogs PENDING            |
| 9   | CLI: `new --dir`, `enhance --in-place`, `resume --commit/--push/--skip-push/--leave`; `--yes` is not consent | PASS                                                     |
| 10  | A real coding agent in a real folder, against live GitHub                                                    | PENDING LOCAL VERIFICATION                               |
| 11  | Windows rules: no shell, no path-shape assumptions, no symlinks, folder paths with a space                   | PASS by construction; Windows run PENDING                |
| 12  | `pnpm check` green                                                                                           | PASS (section 6)                                         |

## 1. Git operations and folder inspection

```sh
pnpm vitest run --project unit packages/git packages/core/src/folders.test.ts packages/core/src/folder-runs.test.ts --reporter verbose
```

```text
✓ GitOps > lists changes: modified, untracked (spaces included), renamed; ignored files stay out
✓ GitOps > fetches a branch from another local repository, checks it out, and leaves the current branch alone
✓ GitOps > adds a remote once, accepts the same URL again, and refuses a different one
✓ GitOps > reads the configured identity, and commits as it when none is passed
✓ GitOps > never reads a source that starts with a dash as an option
✓ inspectFolder: a new solution > refuses a non-empty folder, a file, a missing parent and anything that is not a full path
✓ inspectFolder: an existing solution > refuses uncommitted changes (naming them), a folder that is not a repository, and a repo with no commits
…
Tests  60 passed (60)
```

## 2. Folder runs: new solution and update (engine)

```text
✓ new solution in a chosen folder > renders into the folder, publishes, lets the agent code on a build branch, and stops for the commit
✓ … > asks before every commit and push: git must know the owner, then commit, then push opens one PR
✓ … > lets the owner skip the push, or leave the changes uncommitted
✓ … > refuses a folder that already has files, before anything reaches GitHub, and never touches them
✓ rendering into a folder that a crashed render left behind > reuses a folder holding only files this render writes …
✓ rendering into a folder that a crashed render left behind > refuses the same folder when it holds anything else …
✓ update an existing solution in the owner's folder > delivers the plan onto a new branch in the folder, codes there, and never writes to the original branch
✓ … > refuses a folder with uncommitted work, and continues once it is clean
✓ … > parks, touching nothing, when the folder moved on between the scan and the delivery
✓ … > says there is nowhere to push when the folder has no GitHub origin, and ends committed locally
```

## 3. Crash matrix for commit and push

Fourteen injected failures (git: `addAll`, `status`, `commit`, `headSha`, `push`; GitHub: `getRepo`,
`openPr`; each before and after the effect) each resume to exactly one commit and one pull request:
`the commit and push survive a crash at any step`, all `✓` in the run above. The scenario suite adds a
crash right after the commit and right after the pull request (section 5).

## 4. Web: server, UI and real-browser flows

```sh
pnpm --filter @incubator/web build:ui && pnpm vitest run --project e2e
```

```text
✓ the wizard offers two paths, shows nothing until one is chosen, and explains a folder before it starts
✓ new solution: folder → describe → questions → review → publish → coding → commit → push → DONE
✓ update: folder → only add the canonical files → review with delta statuses → pull request DONE
✓ update: browse to the repository → scan → what to change → review → the agent codes in the folder → commit → push → DONE
✓ a page on another origin cannot drive the API, and a reused launch link is refused
Tests  5 passed (5)
```

The native dialog is replaced by a fake `host.pickFolder` in these tests; the routes
`/api/folders/pick` and `/api/folders/inspect` keep the token, Origin and CSRF checks of every other
call. Screenshots land in `.reports/e2e/`.

## 5. Desktop, CLI and scenarios

```sh
pnpm --filter @incubator/desktop bundle
INCUBATOR_TEST_BUILD=1 pnpm --filter @incubator/desktop bundle
xvfb-run -a pnpm vitest run --project desktop-smoke
```

```text
✓ release build: launches, locks the renderer down and shows the app
✓ release build: refuses the test-fakes flag
✓ test build: a new solution in a chosen folder goes from the dropdown to a pushed pull request
✓ test build: updates a local repository whose path has a space, committing on a new branch
Tests  4 passed (4)
```

CLI (`apps/cli/src/main.test.ts`, `folder-picker.test.ts`): the picker per OS (argv, encoded script,
cancel, trailing slash), the commit and push answered by flags, `--yes` leaving the run parked, the
terminal prompts, and refusals for a dirty folder, a URL with `--in-place`, a non-empty `--dir`. 30 tests
pass.

Scenarios `tests/scenarios/local-folder/` (4 happy, 3 validation, 2 fault), all passing in
`tests/scenarios.test.ts`: happy new solution and update in place, stops for the commit request,
skip-push, a non-empty folder, uncommitted work, no git identity, a crash after the commit, a crash
after the pull request. Every stage also asserts that the owner's files are untouched, the starting
branch is unchanged, and `.incubator/state/` is never committed.

## 6. `pnpm check`

```sh
xvfb-run -a pnpm check
```

```text
✔ secret-scan  ✔ bom  ✔ abs-path  ✔ isolation  ✔ deps-boundary  ✔ contracts-pin  ✔ plan-lint
✔ lane-contract  ✔ scenarios  ✔ quarantine  ✔ drift  ✔ syntax  ✔ workflow-lint-strict  ✔ format
✔ lint  ✔ typecheck  ✔ typecheck-ui  ✔ build  ✔ ui-build  ✔ unit-coverage  ✔ tests-collected
✔ e2e  ✔ completeness (94/100, threshold 70)  ✔ rule-fixtures  ✔ audit
Test Files 44 passed (44); Tests 496 passed | 2 skipped (498)
exit 0
```

The desktop smoke test is its own project (`desktop-smoke`) and is not part of `pnpm check`; it ran
separately as shown in section 5.

## Pending local verification

- **The real folder dialog on Windows**, in the desktop app (`dialog.showOpenDialog`) and in
  `incubator ui` (the PowerShell `FolderBrowserDialog`). Only the argv, the encoded script and the output
  parsing are tested; no dialog was opened in the cloud session.
- **A real coding agent** (Claude Code) in a real folder, with its real final message feeding the
  drafted commit message, and the git identity from the owner's own configuration.
- **Live GitHub**: the up-front repository creation, the push of the working branch and the pull request.
- **A Windows run** of the folder paths with spaces and non-ASCII characters.
