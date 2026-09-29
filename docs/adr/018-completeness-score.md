# ADR-018: Completeness score formula and default threshold

- **Status:** Proposed (needs approval: TDD Q3)
- **Date:** 2026-09-29
- **Context doc:** [`docs/TDD.md`](../TDD.md)

## Context
The brief requires a 0–100 scaffolding completeness score that must be at or above a threshold, and
that counts `TODO(scaffold)` markers. A fresh scaffold legitimately contains TODOs, one per feature
scenario stub, yet it must pass.

## Decision
`score = max(0, 100 − 10·missingRequired − min(40, todoCount) − 5·emptyProfiles − 5·driftIssues)`
- `missingRequired`: canonical items marked `required` in the packs' `canonical.json` that aren't
  present;
- `todoCount`: occurrences of `TODO(scaffold)` in tracked files, excluding `docs/plans/`, which
  describe TODOs rather than contain them;
- `emptyProfiles`: run profiles resolving to zero scenarios;
- `driftIssues`: from the drift checker.
- Weights live in `config/completeness.json`, which is pinned in `contracts.lock.json` so agents can't
  lower them.
- The threshold is `testing.completenessThreshold`, default **70**.
- `guard/completeness.mjs --explain` prints the breakdown.

## Consequences
- A fresh scaffold with up to 30 TODOs passes at 70. A repo missing three required items fails no
  matter what.

## Alternatives considered
- **Ratio of present items only.** Rejected: ignores TODO debt, which the brief asks us to count.
