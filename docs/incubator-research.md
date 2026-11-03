# Incubator research: where a Backshack target is decided

Phase 0 findings for the Backshack Build Contract wiring, read from `origin/main` at 5d12e8a on 2026-11-02.
The decision they led to is [ADR-030](adr/030-backshack-tool-stack.md).

## Questions and answers

### Where is the stack decided?

At one explicit, advisory step before any code: `Engine.stackRecommend()` in `packages/core/src/engine.ts`,
with `packages/core/src/stack-recommendation.ts` and the prompt `packages/core/prompts/stack-recommendation.md`.
The model chooses from a fixed catalog in `packages/spec/src/stacks.ts` (`node-web`, `node-lib`,
`python-service`, `wordpress`, `flutter`), a gate rejects any id outside it, and the owner confirms or picks
another. Backshack was not in the catalog; it surfaced only when a narrative happened to mention it, and the
nearest entry was `wordpress`. Under ADR-026 the recommendation itself is not saved: only the turn, the journal
and `stack` in `incubator.json` last.

### Is there a re-plan after coding starts?

No. Once CODE starts the plan is fixed; `requestChanges()` re-drafts the spec only at REVIEW. One gate before
the build is therefore enough, as long as it is re-evaluated whenever the spec is re-drafted at REVIEW.

### Where does a run work?

A new run always creates a fresh repository (an empty `--dir`, or a new GitHub repository). An update
(`enhance`) run works on a new branch in an existing folder. There was no worktree support.

### How does a run get stack-specific context?

Through stack packs (applied by `packages/templates/src/when.ts`), per-stack markers, per-lane prompt templates,
and the coding agent's prompt (`packages/core/prompts/handoff.md`, or `handoff-external.md` for a repository the
Incubator did not build). There are no skills or includes. A pack only reaches repositories the Incubator
renders, so the handoff prompt is the one place that reaches the agent working in backshack-dev.

### What happened to the earlier Backshack-like run?

The COI Tracker (the `cert-guage` folder next to the other Local Sites repositories, PR #1 on
`jimmyfriday-fap/coi-tracker`) was built as a standalone WordPress plugin. It diverged at the first file: its
own plugin, its own namespace, its own tables, nothing of the Backshack tool package. It was rebuilt by hand as
The Gauge, which is live on production. Its fate: archive the repository as a spike; nothing in it is carried
forward.

## Conclusion

The gate goes at the stack catalog and `stackRecommend`: a `backshack-tool` entry, chosen once before code and
recorded durably in `incubator-recommendation.yaml`. The contract is loaded through the coding agent's prompt
when, and only when, the run's stack is `backshack-tool`, and the run works in a fresh backshack-dev worktree
instead of a new repository.
