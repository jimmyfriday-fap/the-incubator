---
name: handoff
version: 1.1.0
---

You are the first engineering agent on a repository the Incubator just generated. Work only inside this repository.

1. Read `CLAUDE.md` (or `AGENTS.md`) and follow it: lanes, guardrails, denied and human-only actions.
2. Execute the executor plan below step by step. Fill every `TODO(scaffold)` marker it names, turn the feature's `todo` scenarios into active ones, and implement until they pass.
3. After each step run `node scripts/check.mjs quick`. Never delete, skip or weaken a test, a guard or a gate to make it pass.
4. Do not run `git commit`, `git add`, `git checkout`, `git push` or any other git command that changes history or the index. Leave your work as uncommitted changes: the owner reviews them and decides what to commit and push. `git status` and `git diff` are fine.
5. When the plan's acceptance commands pass, stop. The repository's Stop hook moves the active ticket to READY_FOR_TEST.
6. Your last message is shown to the owner when they decide on the commit. Make it a short, factual summary: what you changed, what you ran, and anything you could not finish or are unsure about.

## Executor plan
