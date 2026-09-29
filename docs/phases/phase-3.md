# Phase 3 — Publish, tracker, handoff: acceptance evidence

Plan: [docs/plans/004-phase-3-publish-tracker-handoff.md](../plans/004-phase-3-publish-tracker-handoff.md).

| #   | Criterion (brief §9 and TDD §10, Phase 3)                                        | Status                                                           |
| --- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Full flow against the fake GitHub, call sequence snapshot-tested                 | PASS                                                             |
| 2   | Resume works after a failure injected at each step (before and after the effect) | PASS (27 fault points)                                           |
| 3   | The token never appears in any log, the run directory or captured output         | PASS                                                             |
| 4   | Live tests for a sandbox org and Leantime exist, gated behind `INCUBATOR_LIVE=1` | PASS (they exist and skip); **PENDING LOCAL VERIFICATION** (run) |
| 5   | `publish`, `handoff`, `auth set`, `gc`, doctor token section                     | PASS                                                             |

## 1. Full flow and call sequence

`packages/core/src/publish.test.ts` drives `startFromSpec` → `advance` on an engine wired to
`FakeGitHub` (an in-memory API whose repositories are real bare git repositories), real `git`, and a
scripted verifier:

```text
✓ publish > runs SCAFFOLD → VERIFY → PUBLISH → HANDOFF → DONE with the TDD call sequence
```

```text
tokenInfo → getRepo (name check) → getRepo (resume check) → createRepo → getBranchSha → createBranch
→ setBranchProtection (main) → setBranchProtection (production) → ensureLabels → ensureVariables
```

The same test asserts the commit on the remote `main` (message, trailers, author, date):

```text
chore: scaffold tallyho from incubator.json

Incubator-Spec: sha256:<64 hex>
Incubator-Packs: base@1.0.0, stack/node-lib@1.0.0, deploy/package-release@1.0.0, test-home/in-repo@1.0.0
Incubator-Run: <runId>
```

that `production` points at the same commit, that the repository description carries the
`incubator-run:<runId>` marker used by resume checks, and that the workspace is removed afterwards.
Paired specs publish the tests repository too (`publishes a paired tests repository next to the app`).

## 2. Fault injection and resume

```text
✓ resumes cleanly after a github failure {before,after} {tokenInfo, getRepo, createRepo, getBranchSha,
  createBranch, setBranchProtection, ensureLabels, ensureVariables}, without duplicate effects
✓ resumes cleanly after a git failure {before,after} {init, addAll, chmodX, commit, push}, …
✓ resumes cleanly after a verify failure before verify, …
✓ parks on a taken name and on a failed verify, then resumes
✓ warns instead of failing when branch protection is unavailable
✓ seeds Leantime tickets at HANDOFF once, even across a failure
```

Each case injects one failure, then resumes from the journal until DONE, and asserts: exactly one
repository; exactly one commit on `main`; `production` equals `main`; `createRepo` reached GitHub
once (twice only when the failure happened _before_ its effect); no duplicate labels; and only the
best-effort configure steps may end as `step.warn`. Policy findings (name taken, verify failed, token
scopes) park the run with a reason, and `incubator publish <runId>` resumes it.

## 3. Token hygiene

- `tokenEnv()` gives git the token only as `http.https://github.com/.extraheader` through
  `GIT_CONFIG_*` environment variables — never argv, never a remote URL.
- The token is a `SecretString` from resolution on (redactor-registered, `toString`/`toJSON` →
  `[REDACTED]`); the journal records only its source and the login.

```text
✓ publish > never leaks the token into the run directory or the log
✓ resolveGitHubToken > registers the token with the redactor and never stringifies it
✓ GitOps > puts the token in the environment, never in argv, and fails with a ToolError
✓ publish, handoff, auth, gc > publishes a spec and prints the summary…   (asserts the CLI's stdout+stderr lack the token)
```

The leak test scans every file under the engine home (journal, spec revisions, logs, workspace) and
the log sink for the token string. `scripts/guard/secret-scan.mjs` now runs the hash-pinned gitleaks
over the working tree in `check full` (repo and generated repos).

## 4. Live tests

`packages/core/src/publish.live.test.ts`:

```text
$ INCUBATOR_LIVE=1 pnpm vitest run --project live packages/core/src/publish.live.test.ts
↓ live publish (sandbox owner)   (skipped: INCUBATOR_LIVE_GH_OWNER not set)
↓ live Leantime                  (skipped: INCUBATOR_LIVE_LEANTIME_URL not set)
```

**PENDING LOCAL VERIFICATION:** run with `INCUBATOR_LIVE=1 INCUBATOR_LIVE_GH_OWNER=<sandbox user or
org>` (and `INCUBATOR_LIVE_GH_OWNER_TYPE=org` for an org) plus a token with `repo` and `workflow`;
for Leantime, `INCUBATOR_LIVE_LEANTIME_URL`, `INCUBATOR_LIVE_LEANTIME_PROJECT`,
`INCUBATOR_LEANTIME_TOKEN` and optionally `INCUBATOR_LIVE_LEANTIME_STATUS_MAP`. This container has no
sandbox credentials, and creating repositories in the user's account needs their explicit sandbox
choice. The Octokit adapter is unit-tested against a routed `fetch` (status mapping, idempotent branch
creation, protection 403 → warning, variable/label creation only when missing, existing-PR reuse).

## 5. Commands

```text
✓ publish, handoff, auth, gc > publishes a spec and prints the summary; handoff prints then launches
✓ publish, handoff, auth, gc > parks a publish on a taken name and resumes it by run id
✓ publish, handoff, auth, gc > stores credentials in the keychain only and reports their sources
✓ publish, handoff, auth, gc > gc removes old finished runs and leftover workspaces, keeping parked runs
✓ handoff > builds headless argv from probed capabilities
✓ handoff > counts turns, tool calls and cost from the stream and trips ceilings
✓ handoff > launches the agent on the cloned repository and ends at READY_FOR_TEST
✓ handoff > kills a runaway agent at the tool-call ceiling and refuses unfinished runs
```

`incubator publish` prints, for example:

```text
✔ published https://github.com/octo/tallyho (run 20260501-120000-…)
  commit     1f0c…
  secrets    set these before deploying (Settings → Secrets and variables → Actions):
             - NPM_TOKEN (https://github.com/octo/tallyho): npm automation token allowed to publish the package (production environment).
  next       incubator handoff 20260501-120000-… --launch
```

Handoff argv comes from the probed CLI help. For the real `claude` CLI in this container the probe
yields `-p --output-format stream-json --verbose --permission-mode acceptEdits --allowedTools
Read,Edit,Write,Glob,Grep,Bash(node scripts/check.mjs:*),…,Bash(git commit:*),Bash(git checkout -b:*)`
(no push, no promote). This `claude` build has no `--max-turns`, so turns are counted from the stream;
minutes are a wall-clock timeout with a process-tree kill; cost comes from `total_cost_usd`.
**PENDING LOCAL VERIFICATION:** a live `--launch` against a real published repository (it needs the
live publish above).

## Other fixes found on the way

- The CLI launcher never passed `isTTY`, so interactive users would always have been parked at
  CLARIFY; `liveIo()` now supplies it (and hidden secret input for `auth set`).
- A fresh clone was missing `packages/templates/packs/base/files/.env.example.eta` (ignored by the
  repo's `.env.*` rule), which broke CI's pack matrix; a dogfood test now fails on any ignored pack file.

## `pnpm check`

```text
── check full ──  (23 steps, including secret-scan) … exit 0
tests 312; coverage: lines 92.64 %, statements 91.35 %, functions 91.97 %, branches 82.45 %
```
