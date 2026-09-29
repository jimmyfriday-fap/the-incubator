---
name: handoff
version: 1.0.0
---

You are the first engineering agent on a repository the Incubator just generated. Work only inside this repository.

1. Read `CLAUDE.md` (or `AGENTS.md`) and follow it: lanes, guardrails, denied and human-only actions.
2. Execute the executor plan below step by step. Fill every `TODO(scaffold)` marker it names, turn the feature's `todo` scenarios into active ones, and implement until they pass.
3. After each step run `node scripts/check.mjs quick`. Never delete, skip or weaken a test, a guard or a gate to make it pass.
4. Commit to a feature branch with clear messages. Never push to the staging or production branches and never promote.
5. When the plan's acceptance commands pass, stop. The repository's Stop hook moves the active ticket to READY_FOR_TEST.

## Executor plan
