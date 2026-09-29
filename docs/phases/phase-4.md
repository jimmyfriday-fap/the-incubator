# Phase 4 — Brownfield analyzer and delta PR: acceptance evidence

Plan: [docs/plans/005-phase-4-brownfield.md](../plans/005-phase-4-brownfield.md).

| #   | Criterion (brief §9, Phase 4)                                                                      | Status |
| --- | -------------------------------------------------------------------------------------------------- | ------ |
| 1   | Four fixture repos (bare Node, WordPress plugin, Python service, compliant) → expected gap reports | PASS   |
| 2   | The compliant repo produces an empty delta                                                         | PASS   |
| 3   | No existing file is ever modified                                                                  | PASS   |
| 4   | Detectors, gap report, no-overwrite renderer and `incubator adopt <url\|path>` exist               | PASS   |

## 1. Gap reports

```sh
pnpm vitest run --project unit packages/analyzer packages/core/src/adopt.test.ts apps/cli/src/main.test.ts --reporter verbose
```

```text
✓ detectors > bare-node | wp-plugin | python-service
✓ detectors > detects libraries, CLIs, themes and deploy classes from manifests
✓ detectors > never follows symlinks or reads binaries
✓ canonical checks and gap reports > rates items present, partial or missing
✓ canonical checks and gap reports > bare-node matches its expected gap report
✓ canonical checks and gap reports > wp-plugin matches its expected gap report
✓ canonical checks and gap reports > python-service matches its expected gap report
✓ canonical checks and gap reports > a repository the Incubator generated is fully compliant with an empty delta
✓ draft from analysis > infers stack, platform and deploy with evidence, never security fields
✓ draft from analysis > proposes conflicting files instead of overwriting them
Test Files  3 passed (3)
     Tests  37 passed (37)
```

The snapshots are `packages/analyzer/fixtures/<name>/expected-gap-report.json`. They are rewritten
only with `INCUBATOR_GOLDEN_UPDATE=1`:

| Fixture          | Detected stack (platform, confidence)        | Present / partial / missing | Non-missing items                                  |
| ---------------- | -------------------------------------------- | --------------------------- | -------------------------------------------------- |
| `bare-node`      | `node-web` (web, medium: depends on express) | 1 / 0 / 36                  | `test.suites`                                      |
| `wp-plugin`      | `wordpress` (wordpress-plugin, high)         | 1 / 0 / 36                  | `test.suites`                                      |
| `python-service` | `python-service` (service, high: fastapi)    | 2 / 1 / 34                  | `test.suites`, `env.compose`, partial `guard.lint` |
| `compliant`      | from its `incubator.json`                    | all present                 | —                                                  |

The compliant fixture is only an `incubator.json`. The test renders it with the current packs, so it
cannot drift from them.

## 2. Empty delta for a compliant repository

- `a repository the Incubator generated is fully compliant with an empty delta` checks that:
  - no item is partial or missing;
  - `isEmptyDelta` holds;
  - the report says `0 file(s) are added, 0 conflicting`.
- `adopt > an already compliant repository gives an empty delta and no pull request` runs the same
  case end to end through the engine against the fake GitHub. The run reaches DONE and no branch or
  PR is created.
- On the CLI, `incubator adopt` prints "already compliant" and exits 0 (tested in `main.test.ts`,
  `adopts a repository through a pull request, or reports it compliant`).

## 3. No existing file is modified

```text
✓ adopt > bare-node: opens a PR that only adds files
✓ adopt > wp-plugin: opens a PR that only adds files
✓ adopt > python-service: opens a PR that only adds files
✓ adopt > proposes conflicting files next to the originals
✓ adopt > adopts a local path without touching it, and can stop before publishing
✓ adopt > parks when there is no GitHub origin, and on a non-git path
```

For each fixture, the test:

1. Seeds a real bare repository behind `FakeGitHub`.
2. Hashes every file of the source checkout.
3. Runs the adopt flow to DONE.
4. Asserts that `git diff --name-status main..incubator/adopt-20260501` on the remote has status `A`
   only.
5. Asserts that `main` is unchanged, and that the source hashes are identical afterwards.

The PR is `head: incubator/adopt-20260501`, `base: main`. Its body is the Markdown gap report.

The guarantee has three layers:

- **Planning.** The delta planner never plans writes to existing paths.
- **Writing.** The writer opens files with the `wx` flag, so it fails rather than overwriting.
- **Commit check.** `Adopter.commit` re-checks the committed diff and parks the run with
  `adopt_modified` if anything other than an addition appears.

A rendered file that conflicts with an existing one becomes `<file>.incubator-proposed`, and the
original is untouched.

## 4. Command

```text
incubator adopt <url|path> [--repo owner/name] [--org] [--no-publish] [--yes]
✔ opened https://github.com/octo/order-desk/pull/1 (… file(s) added, … proposed)
  gap report ~/.incubator/runs/<runId>/adopt/gap-report.md
```

- `--no-publish` stops after the local commit and prints where the branch is.
- A path that is not a git repository is rejected, and so is an `origin` that is not on GitHub
  without `--repo`. Both park the run with a reason; a bad `--repo` exits 2.
- The analysis is deterministic: no LLM reads repository content in this phase.
- Strings taken from the repository (name, description) are length-capped and have control
  characters stripped before they reach the spec draft.
- The draft never infers security fields.

## Also fixed

- Windows CI failed on the Phase 3 handoff test. The printed command quoted paths with
  `JSON.stringify`, which doubled every backslash. Plain tokens, including Windows paths, are now
  printed as they are, and only tokens with other characters are double-quoted.
- The syntax guard excludes `packages/templates/packs/**` and `packages/analyzer/fixtures/**`.
  These are template sources and fixture repositories, and they are checked in the packs matrix,
  which has their toolchains. macOS runners have no PHP.

## `pnpm check`

```text
── check full ──  (23 steps) … exit 0
Tests 331 passed | 2 skipped (333); coverage: lines 93.41 %, statements 91.92 %, functions 92.62 %, branches 82.48 %
completeness: 94/100 (threshold 70)
```
