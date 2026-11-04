---
name: permissions
tier: platform
description: Which memory tier each actor may write, and how. Enforced in part by the pre-commit hook.
last_verified: <TODAY>
---

Commit policy for this store: **<pr|direct>** (set in `memory.conf`).

## When commit_policy=pr

| Tier | Paths | human | claude-code (attended) | claude-code (unattended) | dream |
| --- | --- | --- | --- | --- | --- |
| platform | context/platform/**, skills, root rule files, system.yaml | direct | branch + PR | branch + PR | branch + PR |
| project | context/projects/<repo>/** | direct | direct, own repo only | branch + PR | branch + PR |
| scratch | scratch/** | direct | direct | direct | read-only |

The pre-commit hook blocks platform-tier commits on `main`/`master` unless `MEMORY_ALLOW_SYSTEM=1` is set. Only the human owner sets it.

## When commit_policy=direct

The repo commits straight to the default branch, so there are no PRs to review. The rule changes from "PR" to "ask":

| Tier | human | claude-code (attended) | claude-code (unattended) | dream |
| --- | --- | --- | --- | --- |
| platform | direct | only when the human asked for that change in this session; otherwise propose it in the reply | never; write the proposal to scratch | writes `dreams/<date>.md` only; the human applies changes |
| project | direct | direct, own repo only | append to failures.md only | writes `dreams/<date>.md` only |
| scratch | direct | direct | direct | read-only |

## Always

- "Unattended" means any session without a human watching: scheduled runs, `--dangerously-skip-permissions`, CI.
- A session working in repo X writes project memory only under `context/projects/X/`.
- Tenant or customer data never enters this store, in any tier.
