---
name: dream
description: Out-of-band curation of this system's memory. Reads recent session transcripts against the store and proposes evidence-backed changes as a PR. Run when asked to "dream" or "curate memory".
---

# Dream

You have dedicated budget for this. Your job is to make next week's sessions better, not to finish any task. Work from the store root.

## Inputs

- Transcripts: every `*.jsonl` under `transcripts/` newer than the date in `transcripts/.last-dream` (all of them if that file doesn't exist). In store mode they are grouped by repo.
- The store: everything listed in `INDEX.md`.
- Steering: `DREAM-STEERING.md`. Follow it over your own judgment.

## Procedure

1. `git checkout -b memory/dream-<TODAY>` from the default branch.
2. Batch the transcripts, about 5 per batch, never mixing repos within one batch. For each batch, use a subagent (a cheaper model is fine) with this brief: "Read these transcripts, including tool calls and errors. List concrete patterns: repeated failures, repeated human corrections, repeated multi-step sequences, facts sessions had to rediscover, and memory lines that proved wrong. For each, give the transcript ids, the repo, and a one-line quote of the evidence. Do not propose fixes."
3. Merge the findings across batches. Keep only patterns that meet the thresholds in DREAM-STEERING.md. A pattern seen in 2 or more repos targets `context/platform/`; otherwise it targets that repo's project files.
4. For each kept pattern, decide the change: add or correct a line, delete a stale or contradicted line, promote a line from project to platform, or create a skill stub for a repeated multi-step sequence. Apply WRITE-RULES.md. Actor is `dream`. Every line cites `(src: transcripts <id>, <id>, <id>)`.
5. Write `dreams/<TODAY>.md` with one section per proposed change: the pattern, its prevalence (occurrences / sessions / repos), up to three evidence quotes, and the reason for the change.
6. Run `bin/memory index`, then `bin/memory check`.
7. Write today's date to `transcripts/.last-dream`.
8. With `commit_policy=pr` (see `memory.conf`): commit (`mem(dream): <n> proposals`, `Actor: dream`) and open a PR whose body is the dream report. Never merge it yourself. With `commit_policy=direct`: do not change `context/` or skills. Commit only `dreams/<TODAY>.md` and `.last-dream`, and write each proposed change in the report as an exact before/after the human can apply. In that case skip step 1's branch.

If nothing meets the threshold, say so and make no commit.
