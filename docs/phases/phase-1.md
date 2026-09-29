# Phase 1 — Spec and discovery: acceptance evidence

Plan: [docs/plans/002-phase-1-spec-and-discovery.md](../plans/002-phase-1-spec-and-discovery.md).

| #   | Criterion (brief §9, Phase 1)                                        | Status                                                                                                         |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1   | 5 sample narratives produce schema-valid specs with the fake adapter | PASS                                                                                                           |
| 2   | ≤5 questions per round (and ≤2 rounds)                               | PASS                                                                                                           |
| 3   | Every decision attributed (`user` / `inferred` / `default`)          | PASS                                                                                                           |
| 4   | `--yes` finishes without prompting                                   | PASS                                                                                                           |
| 5   | A parked run resumes                                                 | PASS                                                                                                           |
| 6   | Live LLM adapters (claude-cli)                                       | PASS in this session for `claude-cli`; `copilot-cli`, `cursor-cli`, `anthropic-api` PENDING LOCAL VERIFICATION |

## 1–3. Five narratives

Fixtures: `packages/core/fixtures/discovery/{saas-web,wp-plugin,python-webhook,ts-library,ambiguous-one-liner}`
(narrative + hand-written `DiscoveryTurn` replies replayed by the `fake` adapter).

```sh
pnpm vitest run packages/core/src/discovery.test.ts --reporter=verbose
```

```text
✓ discovery prompt > ships the brief text, versioned and byte-pinned
✓ narrative saas-web > produces a schema-valid, semantically valid spec with every decision attributed
✓ narrative wp-plugin > produces a schema-valid, semantically valid spec with every decision attributed
✓ narrative python-webhook > produces a schema-valid, semantically valid spec with every decision attributed
✓ narrative ts-library > produces a schema-valid, semantically valid spec with every decision attributed
✓ narrative ambiguous-one-liner > produces a schema-valid, semantically valid spec with every decision attributed
✓ clarification rules > keeps at most five questions per round, ranked by impact
✓ clarification rules > drops pack-fixed questions and retries once on invalid questions or unattributed values
✓ clarification rules > records user answers as authoritative user decisions
✓ clarification rules > --yes accepts every recommended default without prompting a human
✓ parking and resume > parks at CLARIFY without a human, then resumes to a finished spec
✓ parking and resume > parks when the LLM fails the schema twice, and resumes with another adapter
✓ parking and resume > parks on review rejection and on an invalid edited spec; approve() accepts a valid edit
✓ parking and resume > repairs a torn journal line and resumes
✓ parking and resume > journals interruptions and refuses unknown or invalid answers
✓ recorded live fixture (claude-cli) > replays a keyed real-model exchange to the same approved spec, byte for byte
```

Each narrative test asserts: `validateSpec` and `validateSemantics` return no issues; every leaf of the
final spec (except pack-fixed fields and the narrative) is covered by a decision whose `source` is
`user`, `inferred` or `default`; at most 2 question rounds with at most 5 questions each; the fake
adapter's fixtures are fully consumed.

The `python-webhook` fixture proposes six questions in round 1. The engine keeps the top five by
impact and journals the sixth:

```json
{
  "type": "questions.dropped",
  "dropped": [{ "key": "testing.coverageThreshold", "why": "over the per-round limit" }]
}
```

## 4. `--yes` without a TTY

```sh
pnpm vitest run apps/cli/src/main.test.ts --reporter=verbose
```

```text
✓ cli main > prints the version and exits 0
✓ cli main > exits 2 on usage errors and shows help
✓ incubator new --spec-only > --yes finishes without prompting (no TTY) and writes the spec
✓ incubator new --spec-only > prints the spec to stdout when no --out is given
✓ incubator new --spec-only > parks without a TTY and without --yes (exit 2), then resumes with --yes
✓ incubator new --spec-only > rejects bad usage with exit 2
✓ incubator doctor > reports adapters and exits 0 when discovery is possible
```

## 5. Parked runs resume

Covered above (needs_input at CLARIFY, `llm_schema` at DRAFT_SPEC with a different adapter on resume,
`review_rejected` at REVIEW, torn journal line). At the CLI:

```text
$ incubator new --prompt "EventRSVP plugin" --spec-only        (no TTY, no --yes)
⏸ run 20260501-120000-… parked at CLARIFY: 1 question(s) need an answer; resume interactively or with --yes
  resume with: incubator resume 20260501-120000-… (interactively, or add --yes)
exit 2
$ incubator resume 20260501-120000-… --yes
▶ resuming run 20260501-120000-… (PARKED: needs_input)
✔ spec approved …
exit 0
```

## 6. Live adapters

`incubator doctor` in this cloud container (the real `claude` CLI is installed):

```text
node       v22.22.2 (linux-x64)
keychain   available
git        git version 2.43.0

LLM adapters:
  claude-cli     ✔ 2.1.284 (Claude Code)
                   usable for: discovery, analysis, handoff
                   flags: {"printMode":["-p"],"jsonOutput":["--output-format","json"],"streamJson":["--output-format","stream-json"],"disableTools":["--tools",""],"model":"--model","systemPrompt":"--system-prompt"}
  copilot-cli    ✖   - copilot not found on PATH
  cursor-cli     ✖   - cursor-agent not found on PATH
  anthropic-api  ✖ @anthropic-ai/sdk model=claude-opus-5-5   - no Anthropic API key
```

A real discovery run through `claude-cli`:

```sh
incubator new --prompt "Shelfie: a small web app where a book club logs what members are reading and votes on the next book." \
  --spec-only --yes --adapter claude-cli
```

```text
✔ spec approved (run 20260929-200505-2ysxta)
project    Shelfie (shelfie), private
platform   web · stack node-web/fastify-react · db postgres · auth session
deploy     vps-tailscale · tests in-repo (coverage 80 %, e2e playwright)
features   member-accounts, reading-log, book-nominations, next-book-vote
decisions  0 user · 13 inferred · 21 default
exit 0
```

Journal highlights: round 1 needed a gate retry (`attempts: 2`, the model set values without
decisions), cost $0.127; round 2 cost $0.090; the model re-asked `deploy.target` and
`project.visibility`, which the engine dropped as already decided. A second run was recorded with
`INCUBATOR_RECORD` into `packages/core/fixtures/discovery/live-claude-bookclub/` (three keyed turns) and
is replayed byte for byte in CI.

`INCUBATOR_LIVE=1 pnpm test:profile live`:

```text
✓ discovery/live-claude-cli 63079ms
✓ exit-codes/live-binary-version 353ms
Tests  3 passed (3)
```

Without `INCUBATOR_LIVE=1` the profile refuses to run: `profile "live" touches live systems; set
INCUBATOR_LIVE=1 to run it`, exit 2.

**PENDING LOCAL VERIFICATION:** `copilot-cli` and `cursor-cli` (not installed here; unit-tested with
recorded help text and a fake CLI subprocess), and `anthropic-api` against the real API (no key here;
unit-tested against an injected client, including structured outputs, `fallbacks: "default"` and the
refusal park).

## `pnpm check`

```text
── check full ──  (22 steps) … exit 0
coverage: lines 90.59 %, statements 89.03 %, functions 89.42 %, branches 81.03 %
```
