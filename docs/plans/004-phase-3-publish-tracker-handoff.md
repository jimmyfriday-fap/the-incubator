# Plan 004: Phase 3 — publish, tracker, handoff

## Executor preamble

Take an approved spec through SCAFFOLD → VERIFY → PUBLISH → HANDOFF → DONE. Build `GitOps` (git
binary, argv only, token via `GIT_CONFIG_*` env), the `GitHubAdapter` (Octokit with retry and
throttling; an in-memory fake backed by real bare repositories), token resolution (keychain → `gh auth
token` → `GITHUB_TOKEN`), journaled check-then-act publish steps (TDD §7.1), the local / fake /
Leantime tracker adapters, and `incubator publish | handoff | auth | gc` plus the doctor token
section. Source of truth: `docs/TDD.md` §4.4, §7, §8 and ADRs 008, 009, 010, 017. The token is a
`SecretString` from the moment it is read and is never journaled, logged or written to disk.

## Touched files and markers

| File or directory                                    | Marker / note                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/git/src/{gitops,github,octokit,token}.ts`  | GitOps, GitHubAdapter + FakeGitHub, OctokitGitHub, token chain            |
| `packages/tracker/src/adapters.ts`                   | LocalTracker, FakeTracker, LeantimeTracker (table-driven RPC names)       |
| `packages/core/src/{publish,verify,handoff}.ts`      | Publisher steps, command verifier, handoff launcher and ceiling monitor   |
| `packages/core/src/engine.ts`                        | SCAFFOLD/VERIFY/PUBLISH/HANDOFF states; PolicyErrors park the run         |
| `packages/core/prompts/handoff.md`                   | versioned handoff prompt                                                  |
| `packages/templates/schema/pack.schema.json`, packs  | `settings` (Actions variables/secrets each workflow needs)                |
| `apps/cli/src/commands/{publish,handoff,auth,gc}.ts` | CLI commands; `apps/cli/src/io.ts` `liveIo()` (TTY + hidden secret input) |
| `scripts/guard/secret-scan.mjs`, `.gitleaks.toml`    | gitleaks over the working tree in `check full`; test-secret convention    |

## Acceptance commands

```sh
pnpm vitest run --project unit packages/git packages/tracker packages/core apps/cli
INCUBATOR_LIVE=1 INCUBATOR_LIVE_GH_OWNER=<sandbox> pnpm vitest run --project live packages/core
```

```text
full flow on the fake GitHub with a call-sequence snapshot; resume after a failure injected before
and after every GitHub/git/verify effect; token absent from the run directory, logs and CLI output
live publish / Leantime tests exist and skip unless INCUBATOR_LIVE=1 and sandbox settings are given
```

## Drift and hallucination guardrails

| Trap                                             | Why                                       | Mechanical check                                                                |
| ------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------- |
| A resumed publish repeats an effect              | Duplicate repos, commits or branches      | fault injection before/after each effect; asserts one repo, one commit          |
| The token lands in argv, a URL, a log or the run | Brief §2: never written or logged         | `tokenEnv` (GIT_CONFIG_* env); leak scan over the run dir, log sink, CLI output |
| Workflows read settings nobody creates or lists  | Deploys fail confusingly                  | golden test: every `secrets.*`/`vars.*` is declared in a pack `settings` block  |
| A headless agent gets unbounded power            | Runs must stop at ceilings and never push | narrow allowed-tools list (no push/promote); monitor kills the process tree     |
| Leantime method names drift across versions      | Silent failures                           | method names are configuration; errors map to exit codes; live test gated       |
| A look-alike secret in test data reaches CI      | The history scan blocks the gate          | `secret-scan` guard in `check full`; fake secrets are `test-secret-*`           |

## Review rounds

| Round | Finding                                                                                               | Status |
| ----- | ----------------------------------------------------------------------------------------------------- | ------ |
| 1     | Warnings from best-effort steps were missing from the summary (read from a stale step snapshot)       | CLOSED |
| 2     | The CLI bin never passed `isTTY`, so interactive users were always parked; `liveIo()` now does        | CLOSED |
| 3     | `gc` compared file mtimes with the engine clock; it now uses journal timestamps                       | CLOSED |
| 4     | A fake Leantime key in a test tripped the CI history scan; test secrets now use an allowlisted prefix | CLOSED |
