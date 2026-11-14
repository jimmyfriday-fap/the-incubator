---
name: the-incubator-failures
tier: project
description: Recurring mistakes in the-incubator and their fixes. Read before debugging the-incubator; append when you fix something likely to recur.
last_verified: 2026-11-04
---

# the-incubator failures

- [2026-11-14] [claude-code] A headless `claude -p` session is offered every claude.ai account connector unless it is also given `--strict-mcp-config` with no `--mcp-config` (`--tools` limits only built-in tools), and a Backshack build part then cost about $10 instead of about $1 because 14 connectors added about 450k tokens to each request and a late connection rewrote the whole prompt cache. (src: commit 598f50d, packages/core/src/handoff.ts)
- [2026-11-04] [bootstrap] Reading git status must not take the index lock; a status read that did made a commit running beside it fail. (src: commit 66da936)
- [2026-11-04] [bootstrap] On Windows a command shim that wraps a PHP archive must be run with php, not with node. (src: commit 1e8e04f)
- [2026-11-04] [bootstrap] A built repository's dependencies must be installed before the coding agent starts, including a repository with no lockfile. (src: commits 644881a, f161bcd)
- [2026-11-04] [bootstrap] On Windows the git-heavy unit tests run six workers at a time; one worker per core made the slowest test time out at 120 seconds in a full run. (src: vitest.config.ts)
- [2026-11-04] [bootstrap] Editing a script that is copied into the base pack without running node scripts/packs-sync.mjs fails the dogfood test, and the golden manifests in packages/templates/__golden__ must be refreshed with INCUBATOR_GOLDEN_UPDATE=1 after a reviewed pack change. (src: scripts/dogfood.test.mjs, packages/templates/src/packs.test.ts)
- [2026-11-04] [bootstrap] A base-pack file that differs in the repository fails the dogfood test unless .incubator/dogfood-exceptions.json lists it with a reason, and a listed exception that no longer differs fails too. (src: scripts/dogfood.test.mjs)
- [2026-11-04] [bootstrap] A line that holds only a scaffold marker is parsed by the drift guard in any file, so showing a marker alone on a line in a plan or a doc fails check:quick. (src: scripts/guard/drift.mjs, scripts/guard/lib/markers.mjs)
