---
name: decisions
tier: platform
description: Decisions that affect more than one repo, with reasons, newest first. Read before proposing an alternative approach.
last_verified: 2026-11-04
---

# Decisions

- [2026-11-04] [human] The incubator may pick any stack, but when it builds a solution destined for Backshack it builds under Backshack guards from the start, so the result is a straight port with no rework. (src: owner, stated in planning)
- [2026-11-04] [bootstrap] In an Add memory run the agent may commit but never push, run gh or reach the network; after it stops the Incubator checks the install and parks the run if a rule is broken or a verification failed, and the owner decides the push. (src: docs/adr/031-add-memory-runs.md)
- [2026-11-04] [bootstrap] The first version of Add memory is repo mode only (store at .memory/); store mode, Add member, Upgrade and Dream are deferred. (src: docs/adr/031-add-memory-runs.md, docs/incubator-memory-feature.md)
- [2026-11-04] [bootstrap] The memory seed is read-only at runtime: each run copies it and hands the agent only the copy, and seed updates arrive by replacing assets/memory-seed/. (src: docs/adr/031-add-memory-runs.md, docs/incubator-memory-feature.md)
- [2026-11-04] [bootstrap] In folder workflows the owner approves every commit and push; a new solution is built on incubator/build-<date> because main deploys to staging, and an update's delivery branch is fetched into the owner's folder without moving the current branch. (src: docs/adr/023-local-folder-workflow.md)
- [2026-11-04] [bootstrap] A repository the Incubator did not build is external: the owner approves its check commands, which are built-in constants and never text from the repository or from a model. (src: docs/adr/025-owner-approved-check-commands.md)
- [2026-11-04] [bootstrap] Backshack tools are built in a fresh worktree of the configured backshack-dev repository under the Backshack Build Contract (stack kind workspace, entry backshack-tool). (src: docs/adr/030-backshack-tool-stack.md)
- [2026-11-04] [bootstrap] Larger stacks are retrieved from their own generator (for example flutter create) instead of being built in as packs; the Incubator adds only lane templates, the plan, the project marker and the owner-approved checks. (src: docs/adr/027-retrieved-stacks.md)
- [2026-11-04] [bootstrap] incubator enhance is a separate command from adopt, and its delivery is additive only (files are written with the wx writer). (src: docs/adr/020-enhance-command-and-staged-contract.md)
- [2026-11-04] [bootstrap] Generated repositories carry the same Node guard toolkit as this repository, and Node 22 is a declared dev prerequisite for every generated repository, including PHP and Python ones. (src: docs/adr/013-guard-toolkit-in-node.md)
