# Plan 008: Phase 7 — enhance an existing repository

## Executor preamble

Build `incubator enhance <url|path>` (TDD §7.4, ADR-020, ADR-021). An existing repo is scanned in full,
the owner describes what to change, the discovery loop turns that into enhancement requests grounded
in the scan, and the delivery is additive: a plan, tickets, design notes and a scan report on a
branch, with canonical gaps optional. Pieces:

- `RepoView.stats()` and a pure `deepScan()` with a deterministic scan report that states what it
  skipped and why.
- An `enhance` run kind and a `REQUEST` state: `INTAKE → ANALYZE → REQUEST → DRAFT_SPEC → CLARIFY →
REVIEW → APPROVED → SCAFFOLD → PUBLISH → HANDOFF → DONE`, all journaled, resumable.
- A `design.md` lane template for `enhancement/existing` and `enhancement/new`, rendered per feature.
- Resume checks against the real world for adopt and enhance (branch exists, PR exists).
- CLI `enhance`; web and desktop "What do you want to change?" step and an "Enhance" action on recent runs.
- Stage B (last commits): spec 1.1 and the analysis-summary schema with the LLM `ANALYZE` summary.
  These edit pinned contracts; `pnpm contracts:pin` is a human-only action and is recorded as a
  request, never run.

Hard rules: never modify an existing file, never spawn through a shell, no symlinks or path-shape
assumptions in tests, no absolute machine paths, no live tests, no edits to
`security/accepted-risks.json` or run ceilings. Source of truth: `docs/TDD.md` §3.2, §7.3, §7.4, §8.

## Touched files and markers

| File or directory                                                                                  | Marker / note                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `packages/analyzer/src/{repo-view,scan,scan-report}.ts`                                            | `stats()`; `deepScan`; `renderScanReport` ("Scanned N of M files")             |
| `packages/analyzer/fixtures/node-service-rich/`                                                    | routes, migrations, models, CI, lint config; `expected-scan.json` snapshot     |
| `packages/core/src/{enhance,adopt,engine,state,store}.ts`                                          | Enhancer; `REQUEST` state; resume checks for branch and PR                     |
| `packages/core/prompts/enhance.md`                                                                 | versioned, snapshot-pinned system prompt for enhance runs                      |
| `packages/git/src/gitops.ts`, `packages/git/src/github*.ts`                                        | `branchExists`, `findOpenPr`                                                   |
| `packs/base/files/.incubator/lanes/lane/design.md.eta`, `.incubator/lanes/enhancement/*/design.md` | `design` stage template                                                        |
| `scripts/guard/lane-contract.mjs`                                                                  | optional `design.md` check (additive)                                          |
| `apps/cli/src/commands/enhance.ts`, `apps/cli/src/main.ts`                                         | `incubator enhance`                                                            |
| `apps/web/src/server/server.ts`, `apps/web/src/ui/views/*`                                         | `kind: enhance`, `POST /api/runs/:id/request`, `ChangeRequest`, Enhance action |
| `apps/desktop/{scripts/build.mjs,smoke,src/testing-fixtures}`                                      | stage prompt and templates; enhance smoke flow on fakes                        |
| `tests/scenarios/enhance-existing/`, `tests/adapters/enhance-existing.ts`, `config/features.json`  | 2 happy, 3 validation, 3 fault scenarios                                       |
| `packages/spec/schema/*.schema.json` (Stage B only)                                                | spec 1.1; `analysis-summary.schema.json`; needs the owner's `contracts:pin`    |

## Acceptance commands

```sh
pnpm check:quick
pnpm vitest run --project unit packages/analyzer packages/core apps/cli apps/web tests/scenarios.test.ts
INCUBATOR_GOLDEN_UPDATE=1 pnpm vitest run --project unit packages/analyzer   # refresh snapshots on purpose only
pnpm check
```

```text
Stage A: pnpm check exits 0
the enhance-existing scenarios (2 happy, 3 validation, 3 fault) pass
the scan report is byte-identical across two runs and starts with "Scanned N of M files"
every enhance branch diff is `A` only; source file hashes are identical before and after
Stage B: pnpm check fails on contracts-pin only, and the pin request is recorded in docs/phases/phase-7.md
```

## Drift and hallucination guardrails

| Trap                                                     | Why                                                      | Mechanical check                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Enhance modifies an existing file                        | Brief §9: no existing file is ever modified              | `wx` writer; commit verified `A`-only with `git diff --name-status`; hash test                                    |
| Repository text steers the spec, prompt or plan          | Prompt injection from repo content (T6)                  | scan is regex/manifest only; digest is fenced, capped, control/bidi-stripped; `extraCheck` locks protected fields |
| The scan silently ignores part of the repo               | The owner would trust an incomplete map                  | `stats()` skip accounting; report header states scanned/total/skipped; tested with caps lowered                   |
| A replayed step repeats an effect                        | Duplicate PR or "branch already exists" on resume        | `branchExists` / `findOpenPr` checks; fault scenarios crash after commit and after PR                             |
| A run that changes nothing opens a PR                    | Noise, and a lie about work done                         | `run.done {noop:true}`, exit 0, message; scenario `validation-noop-nothing-to-change`                             |
| Tests assume path shape, quoting or symlinks             | Windows 11 with a space in the path broke earlier phases | paths via `path.join`/`relative`; no symlink creation; all spawns through `Exec` (`shell: false`)                 |
| Editing a pinned contract without the owner              | `contracts:pin` is a human-only action                   | Stage B is last; `check` output shows `contracts-pin` as the only failure; pin request recorded                   |
| Lanes other than `enhancement/*` slip into enhance specs | Wrong templates and tickets                              | `extraCheck` rejects them; unit test                                                                              |

## Review rounds

| Round | Finding                                                                | Status |
| ----- | ---------------------------------------------------------------------- | ------ |
| 1     | Plan drafted and approved by the owner, including the staged pin split | CLOSED |
