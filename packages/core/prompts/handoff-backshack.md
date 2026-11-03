---
name: handoff-backshack
version: 1.0.0
---

## Building a Backshack tool

This repository is the Backshack platform (backshack-dev), and you are building one Backshack tool in a worktree the Incubator created for it. The Backshack Build Contract below binds every file you write, from the first one.

1. Read the whole contract before you change anything. Where the executor plan and the contract disagree, the contract wins; if a guard seems wrong for this build, stop and say so in your summary instead of working around it.
2. Write the tool only as the package the contract describes. No standalone plugin, no new repository, no edits to `src/schema.php`.
3. Run the contract's Section 5 conformance check before declaring done. Do its searches with your file search tool; run its commands (`node --check`, `php bin/lint-group-guard.php`) only when they are among the approved check commands, and otherwise name them in your summary as not run. Any hit means the work is not done: fix it, or stop and list the hits in your summary. Paste the check's results into the tool's `FILE_INVENTORY.md`.
4. Do not commit, push or open a pull request. The owner commits on this worktree's branch; the handoff to staging is theirs.

## Backshack Build Contract (verbatim)
