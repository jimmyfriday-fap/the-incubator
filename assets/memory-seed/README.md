# memory-seed

A versioned, system-agnostic seed for file-based agent memory: context files, skills loaded on demand, in-band writes under fixed rules, transcript capture, and an out-of-band "dream" curation pass. It contains no facts about any system. A deploy produces those.

## Two layouts, one seed

| | Repo mode | Store mode |
| --- | --- | --- |
| Use for | a self-contained repo | a system of several repos |
| Store lives in | `<repo>/.memory/` | a dedicated `<system>-memory` repo |
| Skills live in | `<repo>/.claude/skills/` | `<system>-memory/skills/` |
| Members point at it via | (it's in the repo) | CLAUDE.md block + `.memory-link` + transcript hook |
| Playbook | `playbooks/deploy-repo.md` | `playbooks/deploy-system.md` |

The scripts (`bin/memory`, `hooks/*`) detect the layout themselves; the same files ship in both.

A single repo is a system with one member. Both layouts use the same tiers:

- **platform** (`context/platform/`): applies everywhere; agents change it only through a PR.
- **project** (`context/projects/<repo>/`): per repo; attended agents write their own repo's files directly.
- **scratch**: per-session; not committed.

## Contents

```
VERSION
bin/memory                 index | check | stale
bin/redact-transcript.mjs  redacts secrets, IPs and emails from a transcript copy (run by session-end)
hooks/pre-commit           format, isolation, secrets, platform-on-main guard
hooks/session-end          Claude Code hook: copies a redacted session transcript into the store
skills/write-memory/       how any session records a learning
skills/dream/              out-of-band curation → PR with evidence
skills/memory-bootstrap/   populate the store from code; reconcile shared knowledge to platform
templates/                 rule files, memory.conf, context file shapes, CLAUDE.md blocks, system.yaml, .memory-link
playbooks/deploy-repo.md   install into one repo
playbooks/deploy-system.md install across a multi-repo system (with a manifest the human confirms)
```

## Behaviours that adapt to the target

- **Commit policy:** follows the repo's own convention (`pr` or `direct`), recorded in `memory.conf`.
- **AGENTS.md:** never edited. Its rules aren't duplicated into memory.
- **Isolation terms:** other systems' code identifiers only; any term the target itself uses is dropped at preflight.

## Recommended model settings

- Deploy and bootstrap: Opus-class model, high effort (runs once, and its errors spread to every later session).
- Dream orchestrator: Opus-class, high. Dream subagents reading transcripts: Sonnet-class, medium.
