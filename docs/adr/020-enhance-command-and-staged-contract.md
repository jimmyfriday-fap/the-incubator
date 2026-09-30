# ADR-020: A separate `enhance` command, a delivery model, and a staged contract change

- **Status:** Accepted
- **Date:** 2026-09-30
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.4

## Context

The brief says the input may be "an idea and/or an existing repository". `adopt` compares a repo with
the canonical pattern and opens a PR of missing files, and never asks what the owner wants to change.
New-project discovery asks, but only works on an idea. The `enhancement/*` lanes and the runner's
`design` stage exist in `.incubator/` but nothing starts a run that uses them.

## Decision

1. **A new command, `incubator enhance <url|path>`, not `adopt --enhance`.** An enhance run needs a
   change request, different states (`REQUEST`), a different branch (`incubator/enhance-yyyymmdd`),
   a different delivery (plan, tickets, design notes) and a handoff. Hanging that off a flag would
   fork `adopt` at every step. `enhance` reuses `Adopter.acquire/inspect`, the discovery loop, the
   no-overwrite writer and the handoff, and takes the same flags as `adopt` plus the request flags.
2. **Delivery is additive only.** Every file is written with the `wx` writer; a conflicting file is
   written as `.incubator-proposed`. The commit is proven `A`-only, as for adopt. Canonical-pattern
   gaps are opt-in (`--with-gaps`) and arrive as a second, separately reviewable commit.
3. **Lanes are forced.** Every enhancement feature gets lane `enhancement/existing` (or
   `enhancement/new` for a new module). `extraCheck` rejects any other lane.
4. **Staged contract change.** Spec 1.1 (`mode: "enhancement"`, `existingRepo`, per-feature
   `targets`) and the analysis-summary schema edit pinned contracts, and `pnpm contracts:pin` is
   human-only. Stage A builds everything on spec 1.0 (mode `brownfield`, targets in a run artifact).
   Stage B is the last commits; after them only `contracts-pin` is red, and the pin is recorded as a
   request for the owner rather than run.

## Consequences

- The schema bump lands together with a pin request; until the owner re-pins, `check` is red on
  exactly that step.
- `targets.json` exists only between stages A and B.
- Two adopt crash windows (branch exists on replay, duplicate PR) are closed for both commands.

## Alternatives considered

- **`adopt --enhance`.** Rejected: see decision 1.
- **Schema change first.** Rejected by the owner: it blocks the session on a human step.
- **No schema change.** Rejected: targets and the source ref belong in the spec, not a side file.
