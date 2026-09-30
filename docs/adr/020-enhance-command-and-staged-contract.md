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
4. **Staged contract change, delivered as a patch.** Spec 1.1 (`mode: "enhancement"`, `existingRepo`,
   per-feature `targets`) edits a pinned contract, and `pnpm contracts:pin` is human-only. Everything
   that works on spec 1.0 ships normally (mode `brownfield`; targets resolved at delivery and kept in
   the journaled plan). The spec bump is built last, and because `lefthook` runs `check:quick` before
   every push, a commit that fails `contracts-pin` cannot be pushed without bypassing a gate. It is
   therefore delivered as `docs/phases/phase-7-spec-1.1.patch`, verified to apply to the pushed head
   and to leave `contracts-pin` as the only failing step, with the pin recorded as a request.

## Consequences

- Until the owner applies the patch and re-pins, enhance runs write spec 1.0; afterwards they write
  1.1, and greenfield and adopt runs still write 1.0.
- The LLM analysis summary needs no pinned file (its schema is a code constant).

## Alternatives considered

- **`adopt --enhance`.** Rejected: see decision 1.
- **Schema change first.** Rejected by the owner: it blocks the session on a human step.
- **Push the red commit with the hook bypassed.** Rejected: skipping a gate is a denied action.
- **No schema change.** Rejected: targets and the source ref belong in the spec, not a side file.
