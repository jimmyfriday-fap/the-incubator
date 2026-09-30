# Phase 7 — Enhance an existing repository: acceptance evidence

Plan: [docs/plans/008-phase-7-enhance-existing.md](../plans/008-phase-7-enhance-existing.md).
Decisions: [ADR-020](../adr/020-enhance-command-and-staged-contract.md),
[ADR-021](../adr/021-deep-scan-caps-and-skip-accounting.md). Design: [TDD §7.4](../TDD.md).

The work is in two stages (ADR-020). **Stage A** works entirely on spec 1.0 and leaves `pnpm check`
green. **Stage B** edits pinned contracts, which only the owner may re-pin.

| #   | Criterion (owner's Phase 7 brief)                                                                                   | Status                                      |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Deep scan: stack, entry points, modules, routes/commands, data model, tests, CI, deploy, conventions, bounded files | PASS                                        |
| 2   | `RepoView` stays read-only and capped; anything skipped is reported ("scanned N of M files, skipped X because Y")   | PASS                                        |
| 3   | LLM `ANALYZE` summary (`analysis-summary.md`): tools off, empty cwd, stdin, repo text untrusted                     | PENDING (Stage B)                           |
| 4   | Enhancement discovery reuses `DRAFT_SPEC`/`CLARIFY`, grounded in the scan, at most 5 questions per round            | PASS                                        |
| 5   | Spec 1.1 (`mode: "enhancement"`, `existingRepo`, per-feature targets); greenfield specs stay valid                  | PENDING (Stage B; needs the owner's re-pin) |
| 6   | Each request becomes an `enhancement/*` ticket and a handoff plan using the lane templates and the `design` stage   | PASS                                        |
| 7   | Canonical-pattern gaps are optional and a separately reviewable commit                                              | PASS                                        |
| 8   | No existing file is ever modified (added files or `.incubator-proposed` only)                                       | PASS                                        |
| 9   | CLI `incubator enhance <url\|path>` with adopt's flags (`--no-publish` etc.)                                        | PASS                                        |
| 10  | Web: "What do you want to change?" step, and "Enhance" on Recent runs                                               | PASS (fakes, real Chromium)                 |
| 11  | Desktop (Electron build): the same flow                                                                             | PASS on Linux under xvfb; Windows PENDING   |
| 12  | New states go through the journal; crash-resume works; fault-injection scenarios cover them                         | PASS                                        |
| 13  | A run that would change nothing says so                                                                             | PASS                                        |
| 14  | Windows rules: no path-shape assumptions, no symlinks, no shell                                                     | PASS by construction; Windows run PENDING   |
| 15  | `pnpm check` green                                                                                                  | PASS for Stage A (below)                    |

## 1. Deep scan and skip accounting

```sh
pnpm vitest run --project unit packages/analyzer/src/scan.test.ts --reporter verbose
```

```text
✓ deepScan on a realistic service > finds the stack, entry points, routes, commands, data model, tests, CI and conventions
✓ deepScan on a realistic service > states what it skipped, and why, on the first line
✓ deepScan on a realistic service > matches the golden scan and report, and is byte-identical across runs
✓ deepScan on a realistic service > never writes to the repository
✓ skip accounting (ADR-021) > counts files over the file cap and says so
✓ skip accounting (ADR-021) > reports a lower bound when the walk cap is reached
✓ skip accounting (ADR-021) > names ignored directories without listing their contents
✓ skip accounting (ADR-021) > truncates reads over the byte cap and counts binaries
✓ skip accounting (ADR-021) > counts symbolic links as listed but never read (modelled, none created)
✓ skip accounting (ADR-021) > applies the same rules to in-memory views
✓ repository text is data > cleans control and bidi characters and caps length
✓ repository text is data > keeps hostile route text inert in the scan and fences it in the digest
✓ repository text is data > says when a list was cut short
```

The first line of the golden report (`packages/analyzer/fixtures/golden/node-service-rich.scan-report.md`):
`Scanned 15 of 16 files; skipped 1 file because 1 binary.`

## 2. The enhance run

```sh
pnpm vitest run --project unit packages/core/src/enhance.test.ts tests/scenarios.test.ts --reporter verbose
```

```text
✓ enhance > delivers the plan, ticket, design brief, request and scan without touching a file
✓ enhance > opens one pull request whose body says what it is and how much was scanned
✓ enhance > keeps canonical gaps out unless asked, and puts them in a second commit when asked
✓ enhance > parks for the change request, then continues once it is submitted
✓ enhance > previews the delivery at REVIEW with delta statuses, before anything is written
✓ enhance > says so when there is nothing to change
✓ enhance > is a no-op when this plan was already delivered on the same day
✓ enhance > delivers only the new request on a repository that already has features
✓ enhance > parks when the model strays outside the enhancement lanes or outside intent
✓ enhance > parks on a repository with no supported stack
✓ enhance > hands the delivered plan and its own tickets to the agent
✓ enhance helpers > ships the enhance prompt versioned and byte-pinned
✓ scenario contract layer > enhance-existing/happy-local-no-publish
✓ scenario contract layer > enhance-existing/happy-with-gaps-pr
✓ scenario contract layer > enhance-existing/validation-empty-request
✓ scenario contract layer > enhance-existing/validation-noop-nothing-to-change
✓ scenario contract layer > enhance-existing/validation-llm-schema-twice
✓ scenario contract layer > enhance-existing/fault-crash-after-commit
✓ scenario contract layer > enhance-existing/fault-crash-after-pr
✓ scenario contract layer > enhance-existing/fault-llm-unavailable
```

`enhance-existing/happy-local-no-publish` also runs the repository's own `scripts/guard/plan-lint.mjs`
inside the delivered workspace (as a subprocess, no shell) and asserts no findings. That guard was
checked to fail on a bad plan with the same invocation: five missing-section findings, exit 2.

## 3. Crash-resume matrix (journal, ADR-010)

For every git step (`checkoutNewBranch`, `addAll`, `commit`, `diffNameStatus`, `push`) and GitHub step
(`getRepo`, `openPr`), a failure is injected before and after it (14 points), the run is resumed, and
the test asserts: the run ends `DONE`, exactly one PR exists, the branch has exactly two commits
(`--with-gaps` exercises both parts), the diff is `A` only, and the source checkout is byte-identical.
The same matrix (16 points, including `currentBranch`) now covers `adopt`.

```text
✓ enhance resumes after a crash at any step (ADR-010, ADR-020) (14)
✓ adopt resumes after a crash at any step (ADR-010, ADR-020) (16)
```

## 4. Surfaces

```text
✓ incubator enhance > writes the enhance branch locally, or opens a pull request with the gaps separate
✓ incubator enhance > parks for the request off a terminal, and resume --prompt answers it
✓ incubator enhance > asks for the request on a terminal
✓ incubator enhance > says when there is nothing to change, and rejects bad usage
✓ enhance over the API > scans, asks what to change, previews the delivery and opens the pull request
✓ enhance over the API > takes the request with the start call, and lists the repository for "Enhance"
```

```sh
pnpm --filter @incubator/web build:ui && pnpm vitest run --project e2e
xvfb-run -a pnpm test:desktop-smoke   # after: pnpm --filter @incubator/desktop bundle, and with INCUBATOR_TEST_BUILD=1
```

```text
✓ web UI (Playwright, fakes) > greenfield: narrative → questions → review with diff and owner → published DONE
✓ web UI (Playwright, fakes) > brownfield: repository → review with delta statuses → pull request DONE
✓ web UI (Playwright, fakes) > enhance: repository → scan → what to change → review the delivery → pull request DONE
✓ web UI (Playwright, fakes) > a page on another origin cannot drive the API, and a reused launch link is refused
✓ desktop smoke > release build: launches, locks the renderer down and shows the app
✓ desktop smoke > release build: refuses the test-fakes flag
✓ desktop smoke > test build: completes a fake greenfield run to DONE
✓ desktop smoke > test build: enhances a local repository whose path has a space, to a local branch
```

Screenshots of the flow: `.reports/e2e/enhance-{1-request,2-review,3-done}.png` and
`.reports/desktop-smoke-enhance.png` (ignored by git).

## 5. `pnpm check` (Stage A)

```sh
xvfb-run -a pnpm check
```

```text
 Test Files  41 passed (41)
      Tests  425 passed | 2 skipped (427)
Statements   : 91.43% ( 4313/4717 )
Branches     : 82.98% ( 2838/3420 )
Functions    : 92.46% ( 933/1009 )
Lines        : 93.33% ( 3865/4141 )
✔ completeness: 94/100 (threshold 70)

── check full ──
✔ tools-fetch … ✔ secret-scan … ✔ bom … ✔ abs-path … ✔ isolation … ✔ deps-boundary
✔ contracts-pin … ✔ plan-lint … ✔ lane-contract … ✔ scenarios … ✔ quarantine … ✔ drift … ✔ syntax
✔ workflow-lint-strict … ✔ format … ✔ lint … ✔ typecheck … ✔ typecheck-ui … ✔ build … ✔ ui-build
✔ unit-coverage … ✔ tests-collected … ✔ e2e … ✔ completeness … ✔ rule-fixtures … ✔ audit
exit 0
```

The 2 skipped tests are the existing `live` scenarios (they need `INCUBATOR_LIVE=1` and were not run).

## Defects found and fixed along the way

Found by the new tests, not by review; each has a test that fails without its fix.

1. **Adopt resume re-ran `git checkout -b`** on a branch that already existed after a crash following
   the commit. The commit now recognises its own trailer and adopts it.
2. **Adopt resume reported "already compliant" with no PR** after a crash following the first write:
   re-planning saw the run's own files as identical. The plan is now journaled before the first write.
3. **`effect()` overwrote every `ParkError`'s reason with `parked`** (a `ParkError` is a `PolicyError`),
   so adopt's `spec_invalid` park lost its reason and evidence. `ParkError` now passes through.
4. **`FakeGitHub.openPr` could open a second PR for the same head**, unlike the real adapter (which
   returns the open one on HTTP 422), so a duplicate could not be seen in tests. The fake now matches.
5. In the new scan: the golden files lived inside the scanned fixture (the scan counted its own
   output), CI triggers were mis-parsed, and `localeCompare` made ordering depend on ICU. Fixed;
   ordering is by code unit on every platform.

## Known limits

- The scan is regex and manifest based. It recognises Express/Fastify-style Node, Flask/FastAPI/Django,
  WordPress and the common ORMs; other frameworks give an empty list ("none detected"), never a guess.
- Target resolution is a word match against the scan (plus the design stage); a request that shares no
  words with the code gets `(none resolved …)` and the design stage decides.
- Re-running the same request on a later day produces a second numbered plan; only the same day is
  recognised as already delivered.

## PENDING LOCAL VERIFICATION

- Windows 11 desktop build and the enhance flow on a path containing a space (the Linux smoke test uses
  one, and no test creates symlinks or assumes path shape, but it has not been run on Windows).
- The OS keychain, a real browser launch (`incubator ui`), and a real claude/copilot/cursor CLI
  producing discovery turns. Every test here uses recorded turns.
- Live GitHub and Leantime (`INCUBATOR_LIVE=1`); not run.
- `pnpm contracts:pin`, after Stage B (owner-only action).

## Stage B

Not started at the time of writing this section; it is updated when the contract commits land.
