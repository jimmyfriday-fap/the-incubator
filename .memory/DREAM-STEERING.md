---
name: dream-steering
tier: platform
description: Tells the dream pass which patterns matter in this system and which to ignore. The most leveraged file in the store; the human edits it.
last_verified: 2026-11-04
---

## Care about

- Windows breakage: shell shims, CRLF line endings, the git index lock, slow git-heavy tests.
- Drift between the repository and the base template pack: stale pack copies, stale golden manifests, missing dogfood exceptions.
- Gate vetoes that recur: check:quick failures at the Stop hook, plan-lint findings, a scaffold marker alone on a line.
- Agent runs crossing their boundary: a push, gh, network access or an edit to AGENTS.md from an Add memory or folder run.
- Target-specific knowledge written into this store instead of the solution's own store.
- Executor plans that miss: a marker that never landed, a find/replace that matched nothing, a plan that outgrew its budget.

## Ignore

- One-off typos and formatting nits.
- Failures caused by the environment (network, auth expiry) unless they recur 3+ times.

## Thresholds

- Propose a change only for a pattern with at least 3 occurrences across at least 2 sessions.
- A pattern seen in 2 or more repos goes to `context/platform/`; otherwise to that repo's project files.
- Propose deleting a line when no transcript in 90 days touched its subject, or a newer line contradicts it.
