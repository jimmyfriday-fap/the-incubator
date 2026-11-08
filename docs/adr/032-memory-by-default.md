# ADR-032: Memory by default for every new build, and where memory goes for everything else

- **Status:** Accepted
- **Date:** 2026-11-06
- **Context doc:** [`docs/TDD.md`](../TDD.md) §7.7; [`docs/incubator-memory-feature.md`](../incubator-memory-feature.md);
  amends [ADR-031](031-add-memory-runs.md) points 1 and 6

## Context

ADR-031 made memory an action the owner starts on a finished solution, in repo mode only. Part 2 of the
memory work makes memory the default instead: a new build starts with it, because the first coding session is
the one that makes the early decisions worth remembering. It also builds the two follow-on actions ADR-031
deferred, store mode (several repositories, one store) and Add member (one more repository joins a system that
already has a store). Not every run has a place for a new store: an update run codes inside a repository that
already exists, and a Backshack tool is built inside the Backshack repository, whose memory belongs to that repository.

## Decision

1. **On by default for a new build with a folder.** The new-build form has a Memory toggle, on unless the
   owner turns it off. Before any code is generated the run records where the memory lives and why, as
   `memory.plan` in the journal and `memoryPlan` on the project. The modes are `repo`, `member`, `none`
   and `target`.
2. **Destination rules, in this order.**
   1. The toggle is off: `none`, with the reason.
   2. The owner picked a system the portfolio knows: `member`; the new repository joins that system's store.
   3. The code goes into an existing repository (an update run) or into a Backshack tool: `target`. No new
      store is made, and the report says where the memory stays.
   4. Otherwise: `repo`, a `.memory/` store in the new repository.
3. **Scaffold first, bootstrap last.** For `repo` and `member` the store is scaffolded before the coding
   session, so the session reads `.memory/INDEX.md` before it writes code and its choices land in
   `decisions.md` as stated, never as `(unconfirmed)`. The playbook's bootstrap and verification run after the
   code, and its report goes into the build report.
4. **Store mode and Add member are built (amends ADR-031 point 1).** Store mode puts one store beside
   several repositories after the owner confirms a manifest; Add member joins one more repository to a
   system that has a store. Both keep everything local: the Incubator makes the store's commits and pushes
   nothing. The owner decides what to push and where, as in ADR-031 point 4.
5. **Update runs offer, never install.** When an update run finishes on a project that has no `.memory/` and
   no `.memory-link`, the finish page, the run's guide and `WHAT-NOW.md` offer Add memory. Nothing is
   installed without the owner starting that run (amends ADR-031 point 6, which only covered projects that
   already had memory).
6. **The seed stays read-only.** None of this edits `assets/memory-seed` or `AGENTS.md`; the rules in
   ADR-031 points 2 to 4 apply to the new run kinds unchanged.

## Alternatives considered

- **Always install memory in an existing repository during an update run.** Rejected: it changes a repository
  the owner did not ask to change, and the install has its own review and push decisions.
- **Make memory opt-in on the new-build form.** Rejected: the early decisions are the ones that are lost,
  and an opt-in toggle is rarely turned on before the first session.
- **Push the store's commits as part of store mode.** Rejected: the store may be a repository the owner has
  not created yet; the push stays the owner's decision.

## Consequences

- Every new build records a `memoryPlan`, so the portfolio can answer "why does this project have (or not
  have) a store" without reading the journal.
- A new build's first commit on the build branch contains `.memory/` and the `CLAUDE.md` block, unless the
  toggle was off.
- `target` is a recorded decision, not an install: there is nothing to check or roll back.
- A new build's two memory sessions are headless too, so Claude Code refuses their writes under `.claude/` and `.git/`
  (acceptance build 1, 2026-11-07; allow rules do not lift it). As in ADR-031's amendment for Add memory, the Incubator
  installs the skills, the `SessionEnd` hook and the git hook after each session stops, with the same code, and the
  bootstrap writes its skill stubs outside the repository. The seed and its playbook are unchanged.
- The finish detail for an update run now carries a `memory` entry, so the UI shows the destination for those
  runs too.
