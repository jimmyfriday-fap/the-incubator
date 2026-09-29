# Plan 005: Phase 4 — brownfield analyzer and delta PR

## Executor preamble

Build `incubator adopt <url|path>` (TDD §7.3). Pieces:

- A read-only `RepoView`: file list plus lazy reads, capped at 5,000 files and 1 MiB per read, skipping
  dependency directories, binaries and symlinks.
- Pure detectors for stack, platform, deploy, tests, workflows and agent config.
- A canonical catalog, `packages/analyzer/canonical.json`, rated present / partial / missing.
- A Markdown gap report.
- A deterministic spec draft that never infers security fields.
- A delta planner (create / identical / proposed / owned) over the full rendered tree.

The engine gains the `ANALYZE → REVIEW → SCAFFOLD → PUBLISH` adopt path:

- The delta is written with the `wx` no-overwrite writer on branch `incubator/adopt-yyyymmdd`.
- The commit is proven to contain additions only.
- The branch is pushed and a PR is opened with the gap report as its body.
- An empty delta means the repo is already compliant, and no PR is opened.

The source repository is never modified: URLs and local paths are cloned into the run workspace.
Source of truth: `docs/TDD.md` §7.3 and §3.

## Touched files and markers

| File or directory                                                           | Marker / note                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/analyzer/src/{repo-view,detectors,canonical}.ts`                  | RepoView caps; detectors; catalog checks (`all`/`any`/`contains`/`when`) |
| `packages/analyzer/src/{draft,report,delta}.ts`                             | spec draft with evidence; Markdown gap report; no-overwrite delta plan   |
| `packages/analyzer/canonical.json`                                          | canonical items of the pattern (one catalog, stack-scoped via `when`)    |
| `packages/analyzer/fixtures/{bare-node,wp-plugin,python-service,compliant}` | fixture repos + `expected-gap-report.json` snapshots                     |
| `packages/core/src/adopt.ts`, `engine.ts`, `store.ts`                       | Adopter (acquire, inspect, plan, commit, publish); adopt states          |
| `packages/git/src/gitops.ts`                                                | `clone`, `checkoutNewBranch`, `diffNameStatus`, `remoteGetUrl`           |
| `apps/cli/src/commands/adopt.ts`                                            | `incubator adopt <url\|path> [--repo] [--org] [--no-publish] [--yes]`    |

## Acceptance commands

```sh
pnpm vitest run --project unit packages/analyzer packages/core/src/adopt.test.ts apps/cli
INCUBATOR_GOLDEN_UPDATE=1 pnpm vitest run --project unit packages/analyzer   # refresh snapshots on purpose only
```

```text
the bare-node, wp-plugin and python-service fixtures match their expected-gap-report.json snapshots
the compliant fixture (rendered from its incubator.json) is all-present with an empty delta, no PR
every adopt branch diff is `A` only; source file hashes are identical before and after
```

## Drift and hallucination guardrails

| Trap                                              | Why                                            | Mechanical check                                                                   |
| ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Adopt overwrites or edits an existing file        | Brief §9: no existing file is ever modified    | `wx` writer; commit verified with `git diff --name-status` = `A` only (else parks) |
| The user's checkout is changed                    | Adopt must be non-destructive                  | test hashes every source file before and after; work happens in a clone            |
| Repository content steers the spec or report      | Prompt injection from brownfield content       | deterministic detectors; strings are length-capped and control characters stripped |
| Security posture is guessed from the repo         | A wrong guess weakens the generated guardrails | `draftFromAnalysis` never sets security fields; test asserts they stay default     |
| Gap reports drift silently when packs change      | The report would lie about compliance          | fixture snapshots; the compliant fixture is rendered from the current packs        |
| A huge or hostile repo exhausts memory or escapes | Symlinks and large blobs                       | RepoView caps (5,000 files, 1 MiB), no symlink following, binary skip; tested      |

## Review rounds

| Round | Finding                                                                                       | Status |
| ----- | --------------------------------------------------------------------------------------------- | ------ |
| 1     | Handoff printed Windows paths through `JSON.stringify`, doubling backslashes (Windows CI red) | CLOSED |
| 2     | Syntax guard walked pack PHP/Python and analyzer fixtures on runners without those toolchains | CLOSED |
| 3     | Lint caught a misplaced `no-control-regex` suppression and an unneeded cast in the spec draft | CLOSED |
