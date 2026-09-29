# Build Brief: The Incubator — Local Project Genesis Engine

You are a principal engineer building **The Incubator**. It is a locally run tool that turns a plain-English idea and/or an existing repository into a fully scaffolded GitHub repository. Every repository it produces follows one canonical dev and test framework (the "Backshack Canonical Pattern", §3) and is ready for AI coding agents to develop and test autonomously.

You are working in a **Claude Code cloud session** in the `the-incubator` repo. The product you build **runs on the user's own machine** (Windows, macOS and Linux; Windows is first-class). There is no hosted server.

## 0. How to work
1. **Design doc first, then STOP.** Before writing code, write `docs/TDD.md`, the technical design document. It covers every section of this brief. Record each non-obvious choice as an ADR in `docs/adr/NNN-*.md`. Commit and push, give me a short summary, and **wait for my approval**. This is the only planned checkpoint.
2. **Then build phase by phase (§9).** A phase is done only when all of these hold:
   - `pnpm check` is green;
   - every acceptance criterion for the phase passes and is recorded in `docs/phases/phase-N.md` with the exact commands and their output;
   - the work is committed and pushed.
   Move on to the next phase without waiting, unless you are truly blocked.
3. **Dogfood.** This repo must follow the same canonical framework it generates: lanes, CI, guardrails, agent config and executor-plan format. If the Incubator can't meet its own standard, the standard is wrong. Fix the standard.
4. **Know what the cloud session can't do.** It has no OS keychain, no logged-in claude/copilot/cursor CLIs, no GUI and no real GitHub target. Put everything that needs those behind interfaces with fakes. Put live tests behind `INCUBATOR_LIVE=1`. Never mark a live-only criterion as passed without running it; list it in the phase doc as "pending local verification".
5. **Never import, vendor, clone or copy code from any Backshack repository.** §3 describes the patterns to implement fresh.

## 1. Product summary
- **Inputs:**
  - a narrative prompt (text or a file);
  - an existing repo, as a GitHub URL or a local path;
  - or both together ("here's my repo, now turn it into X").
- **Surfaces**, all backed by one engine package:
  - **CLI** `incubator`: `new`, `adopt`, `scaffold`, `publish`, `handoff`, `sync`, `doctor`, `gc`, `ui`.
  - **Localhost web UI** (`incubator ui`): the discovery wizard, a live file-tree preview, a spec diff and a run log.
  - **Electron desktop app:** the same web UI with the engine running in-process.
- **Outputs:**
  - **Greenfield:** a new GitHub repo with `main` and `production` branches.
  - **Brownfield:** a branch plus a PR that adds only what's missing against the canonical framework, with a gap report.
  - **Both:** the `incubator.json` spec and a handoff to a local AI CLI to start building features.

## 2. Hard constraints
- **Monorepo:** TypeScript, pnpm workspaces, Node 22 LTS, strict `tsc`, ESM.
- **Deterministic scaffolding.** The same `incubator.json` and the same template-pack versions must produce byte-identical output. LLMs are used only for:
  - discovery and spec drafting;
  - brownfield analysis summaries;
  - the post-scaffold handoff.
  LLMs never write the template output.
- **Subprocesses:** always spawn without a shell (`shell:false`, argument arrays), and resolve binaries across OSes. Normalize to LF (`.gitattributes eol=lf`). Use no absolute machine paths anywhere, in generated repos or this one.
- **Secrets:**
  - **GitHub token:** taken from the OS keychain (e.g. `@napi-rs/keyring`), then `gh auth token`, then `GITHUB_TOKEN`. Never written to disk in plain text and never logged; redact it in all logs.
  - **Localhost UI:** binds to 127.0.0.1 on a random port and uses a per-launch token passed in the URL. It checks the Origin header and CSRF.
- **Local state** lives in `~/.incubator/`:
  - `config.json`;
  - `runs/<runId>/` holding the workspace, `journal.jsonl` and logs;
  - `cache/` for template packs.
- **Workspaces:** delete a run's workspace after a successful publish. Keep it on failure, or with `--keep`. `incubator gc` removes runs older than N days.
- **Exit-code contract** for every CLI command and generated script: `0` pass, `1` the tool itself broke, `2` a policy or gate finding, `130` interrupted.

## 3. The Backshack Canonical Pattern (distilled — implement fresh)
These patterns come from the user's existing platform. Codify them as versioned template packs (§6). Improve on the listed weaknesses; don't copy them.

### 3.1 Environment lanes: local → staging → prod
- **local:** docker compose (app plus DB). A bootstrap script builds the DB from scratch with a base schema, all numbered migrations and a seed.
- **staging:** every push to `main` auto-deploys via `deploy-staging.yml`, then runs `validate-staging` smoke checks. Staging uses `APP_ENV=staging`, and downstream secrets are set to dummy values so staging can never change prod. On the VPS target, staging is reachable only over the tailnet.
- **prod:** only the `production` branch deploys. The pipeline runs in this order:
  1. `promote-to-production.yml` is triggered manually. Its `execute_tasks` input defaults to false, which means a dry run.
  2. It merges `main` into `production`.
  3. It explicitly dispatches `deploy-production.yml`. That workflow has no push trigger.
  4. `rollback-production.yml` checks that the target is the latest promote merge, then reverts or repoints and smoke-tests.
- **Post-deploy tasks:** declared in `.deploy-tasks.json` (`name`, `env[]`, `idempotent`, `runOnce`, `timeout`) and run by `scripts/run-deploy-tasks` (`--env --sha --log --yes`, dry-run by default). Results are appended to a JSONL log keyed by (name, env, sha), so gaps between staging and prod are visible.
- **VPS target:** timestamped release directories, an atomic symlink swap, keep the last 5, a PM2 or compose process manager, and a self-hosted runner.
- **Docker target:** build, push to a registry, then SSH and `compose pull && up`, with health-check gating.
- **Workflow hygiene:**
  - every `uses:` pinned to a full commit SHA;
  - a comment explaining *why* on every non-obvious step;
  - `permissions: contents: read` unless more is needed;
  - `DEPLOY.md` states the repo's deploy class and the promotion rules.

### 3.2 Work-type lanes and the autonomous dev loop
- **Work lanes:** `workspace`, `security`, `support/existing`, `testing`, `infra`, `enhancement/existing`, `enhancement/new`, `ui/fix`, `ui/feature`.
- **Lane templates:** each lane ships three prompt templates as files at `.incubator/lanes/<lane>/{enrich,codegen,preflight}.md`. Enrich and codegen are required; preflight is optional.
- **Enrich output contract:** the output must contain `VERDICT: REAL_FIX` (or a rejection verdict), numbered `**Step N:**` blocks and `- Target:` lines. A test enforces this contract on every template.
- **Ticket state machine:** `NEW → TAGGED_TO_RELEASE → ENRICHMENT_IN_PROGRESS → DEV_IN_PROGRESS → READY_FOR_TEST → TEST_PASSED | TEST_FAILED → DEPLOYED`.
- **Runner stages:** `selected → repo_resolved → design (enhancement lanes) → preflight → enrich → verify_baseline → codegen → verify → qa_gate → ready_for_test`.
  - If any gate fails, the runner **parks** the ticket. Never retry and never improvise.
  - Any human nudge must be recorded as a remediation item.
- **Agent profile** (`.incubator/agent-profile.json`, validated by a JSON Schema):
  - an `actions` allowlist (kinds: read, generate, save, gate);
  - `denied_actions` and `human_only_actions`;
  - `run_ceilings`: turns, tool calls, minutes and USD.
- **Executor-plan format:** plans live in `docs/plans/NNN-*.md`, not the repo root. Each plan has:
  - an executor preamble;
  - a "touched files and markers" table;
  - acceptance commands with the exact expected output;
  - a drift/hallucination guardrail table (trap, why, mechanical check);
  - a review-round log (FIX-FIRST / CLOSED).
- **Tracker adapter** (Leantime-compatible). A `TrackerAdapter` interface with two implementations:
  - `leantime` (Leantime JSON-RPC API; base URL and project ID from the spec; token from the keychain);
  - `local` (tickets as files in `.incubator/tickets/`).
  CI failure triage files an issue through the adapter and **never changes the test verdict**.

### 3.3 Test pipeline
- **Test home**, chosen in the spec:
  - `in-repo`: a `tests/` directory;
  - `paired-repo`: a `<name>-tests` repo. The app's `test` script prints a pointer and exits 1, and the test repo checks out the app.
- **Scenario contract layer:**
  - Scenario JSON (with a schema) has `seed`, `context`, `mocks.ai`, and `stages[].assertions[{path, op, value}]`.
  - A per-feature adapter implements `name`, `seedContext`, `runStage`, `captureOutput` and `validate`.
- **Run profiles** in `config/run-profiles.json`: `quick`, `full`, `chaos`, `hardening`, `release`, `live`. They run as `test:profile <name>`.
- **Onboarding minimum for each feature:** 1 happy path, 2 validation failures and 1 fault injection.
- **Suites:**
  - `unit`: no network, DB or sibling repos;
  - `integration/db`: runs in CI against a compose service;
  - `e2e` (Playwright): one project per lane (`local`, `staging`, `production-smoke`).
  Stack packs choose the runner: Vitest or node:test, PHPUnit 11, or pytest.
- **Guardrails, all failing closed:**
  - fail if zero tests were collected;
  - happy-path coverage and catalog-parity check;
  - a scaffolding completeness score from 0 to 100 that must be ≥ the threshold;
  - a drift checker between registries and code;
  - `config/flake-quarantine.json`, where every entry needs an owner and an expiry and nothing is skipped silently;
  - fail on warnings and on risky tests;
  - a numeric coverage threshold, set in the spec.
- **CI:** jobs run with `if: always()` so every suite reports, then a final explicit gate step fails the job.

### 3.4 Security and guardrails
- **In-repo scanning:** a `security-scan.yml` workflow runs Semgrep (auto rules plus local rules), Trivy (HIGH/CRITICAL) and gitleaks.
  - `validate-scan-results` checks the output shape.
  - A `policy-gate` exits 2 on findings at or above the threshold. Findings have stable fingerprint IDs.
  - An accepted-risk register is required for every suppression.
  - Local rules ship with fixtures whose findings **must** fire.
- **Optional central rig:** if `security.centralRig.enabled`, add `security-scan-trigger.yml`, which dispatches to the configured rig repo.
- **Always on:**
  - a UTF-8 BOM guard;
  - syntax lint (`node --check`, `php -l`, `python -m py_compile`);
  - a real linter and formatter (ESLint/Prettier, PHP-CS-Fixer/PHPStan, Ruff);
  - pre-commit hooks (lefthook);
  - dependency audit (`npm audit`, `composer audit`, `pip-audit`).
- **Isolation lint:** no imports from outside the repo and no symlinks escaping it.
- **Contract files** (schemas, agent profile) are SHA-256-pinned, and a test checks the pin.
- **Secrets:** commit only `.env.example`. Real env files are loaded in order `.env`, then `private/.env`; later files only fill keys still missing. CI tokens are masked, and per-run fixture tokens are revoked in an `always()` step. Remote installers are hash-pinned and never piped into a shell.

### 3.5 Scaffolder mechanics (applies to generated projects too)
- A spec drives the output:
  - blueprints with `{{PLACEHOLDERS}}`;
  - idempotent registry patches between `// <scaffold:name>` markers;
  - then a drift check.
- Anything left for an agent to fill in is marked `TODO(scaffold)`, and the completeness score counts these markers.
- Flags: `--dry-run`, `--validate-only`, `--out`.

### 3.6 Agent config shipped in every generated repo
- **Instructions for each agent:**
  - `CLAUDE.md` and `AGENTS.md`;
  - `.github/copilot-instructions.md`;
  - `.cursor/rules/*.mdc`.
  All of them come from one source template and share one message.
- **`.claude/settings.json` hooks:**
  - SessionStart installs dependencies and runs `check:quick`;
  - Stop signals READY_FOR_TEST to the tracker adapter.
- **Verification-loop rule:** after every change, run the check; veto the change if it fails; log the failure through the tracker.
- **Relative paths only.**

### 3.7 Known Backshack weaknesses — do NOT replicate
- absolute Windows paths in `.devcontainer`/`.vscode`/`.cursor`;
- a `.gitignore` that excludes root `*.md` (which drops CLAUDE.md);
- no pre-commit hooks, linter or coverage gate;
- `plan-*.md` clutter at the repo root;
- test profiles with zero scenarios;
- CLAUDE.md files pointing at a workspace-level file that isn't in the repo.

## 4. Incubator architecture
```
packages/spec       incubator.json JSON Schema (draft 2020-12) + generated TS types + validator
packages/core       run orchestrator, discovery state machine, run journal (resume), exit codes
packages/templates  template packs (base, stack/*, deploy/*, test-home/*), renderer, lockfile
packages/llm        LlmAdapter: claude-cli | copilot-cli | cursor-cli | anthropic-api | fake
packages/git        GitHub adapter (Octokit) + local git ops; fake for tests
packages/analyzer   brownfield detector + gap report
packages/tracker    TrackerAdapter: leantime | local | fake
apps/cli            `incubator` binary
apps/web            Fastify localhost server + React/Vite UI (SSE for run logs)
apps/desktop        Electron shell embedding core + web UI
```
**LLM adapters:**
- At startup, detect which CLIs are installed and which headless flags they support by running `--version` and `--help`. Don't hard-code flags; the formats change.
- Use JSON output modes and validate every response against a schema. On a schema failure, retry once with the validation error included, then park the run.
- The `anthropic-api` fallback uses the official SDK with structured output. The model is set in config and defaults to the latest Claude model.
- `doctor` reports which adapters are available.

## 5. Discovery engine and `incubator.json`
**States:** `INTAKE → ANALYZE (if repo given) → DRAFT_SPEC → CLARIFY → REVIEW → APPROVED → SCAFFOLD → VERIFY → PUBLISH → HANDOFF → DONE`. Any state can go to `PARKED`, with a reason, and a parked run is resumable from the journal.

**Clarification rules:**
- Ask at most 5 questions per round and at most 2 rounds.
- Only ask about things you can't infer and that change the generated output.
- Every question carries options and a recommended default.
- `--yes` accepts all the defaults.
- Every answer is recorded in `decisions[]` with a `source` of `user`, `inferred` or `default`.

**Spec shape.** Formalize it in `packages/spec`; this is the minimum:
```json
{
  "incubatorVersion": "1.0",
  "mode": "greenfield | brownfield",
  "project": { "name": "", "slug": "", "description": "", "owner": { "type": "user|org", "login": "" }, "visibility": "private" },
  "intent": { "narrative": "", "personas": [], "coreFeatures": [{ "id": "", "summary": "", "lane": "enhancement/new" }] },
  "platform": "web | service | cli | library | wordpress-plugin | wordpress-theme",
  "stack": { "pack": "node-web | wordpress | python-service | node-lib", "framework": "", "database": "", "auth": "", "packageManager": "" },
  "lanes": { "environments": ["local", "staging", "prod"], "branches": { "staging": "main", "prod": "production" }, "workLanes": [] },
  "deploy": { "target": "vps-tailscale | docker-host", "staging": { "host": "", "tailnetOnly": true }, "prod": { "host": "" } },
  "testing": { "home": "in-repo | paired-repo", "profiles": ["quick", "full", "chaos", "hardening", "release", "live"], "coverageThreshold": 80, "e2e": "playwright" },
  "security": { "scanners": ["semgrep", "trivy", "gitleaks"], "policyGate": "HIGH", "centralRig": { "enabled": false, "repo": "" } },
  "agents": { "primary": "claude", "also": ["copilot", "cursor"], "runCeilings": { "turns": 0, "toolCalls": 0, "minutes": 0, "usd": 0 }, "deniedActions": [], "humanOnlyActions": [] },
  "tracker": { "type": "leantime | local", "leantime": { "baseUrl": "", "projectId": null } },
  "templates": { "packs": [{ "id": "base", "version": "1.0.0" }] },
  "source": { "type": "none | github | local", "ref": "" },
  "gapReport": [],
  "decisions": [{ "key": "", "question": "", "answer": "", "source": "user | inferred | default" }]
}
```

**Discovery system prompt.** Ship this as `packages/core/prompts/discovery.md`, versioned and snapshot-tested:
> You are the Incubator's discovery engine. Input: a narrative and/or a repository analysis, plus the current draft `incubator.json`. Goal: a complete, valid spec with the fewest possible questions.
> 1. Infer everything you can. Record each inference in `decisions` with `source: "inferred"`.
> 2. Pick the questions that are still open and that change the generated files. Rank them by impact and ask **at most 5**. Each question needs 2–4 options, one of them marked recommended.
> 3. Never ask about anything the template packs already fix (lanes, guardrails, CI shape).
> 4. Reply **only** with JSON matching `DiscoveryTurn` (`{ draftSpec, questions[], done }`). Set `done: true` when no open question would change the output.

## 6. Template engine
- **Packs** are directories with a `pack.json` (id, semver, `appliesWhen`, inputs, and a files manifest) plus templates rendered by one deterministic engine (Eta or Handlebars; pick one, record it in an ADR).
- **Composition order:** `base` (lanes, agent config, guardrails, security) → `stack/<pack>` → `deploy/<target>` → `test-home/<mode>`. A later pack may patch an earlier pack's files only through scaffold markers.
- **Lockfile:** each generated repo gets `.incubator/lock.json` recording the spec hash, pack versions and per-file content hashes. `incubator sync` uses it to apply pack upgrades as PRs without overwriting files the user has changed.
- **Pack tests:**
  - golden snapshot tests for every pack combination;
  - a CI matrix that renders each combination and runs **the generated project's own** `check:quick`;
  - the unit tests must pass and the completeness score must be ≥ the threshold.

## 7. GitHub and publish flow
1. Resolve and verify the token and its scopes (`doctor` reports them).
2. Check that the target repo name is free. If it exists, abort, unless `--adopt` is given, which switches to brownfield.
3. Render into `runs/<id>/workspace`, then run VERIFY: the generated `check:quick` plus the scan dry-run.
4. Create the repo through the API, private by default.
5. Run `git init -b main` and commit. The message names the spec hash and includes an `Incubator-Run:` trailer.
6. Push `main`, then create `production` from `main`.
7. Configure the repo. Each step is best-effort and reported, never fatal:
   - branch protection;
   - lane labels;
   - required Actions secrets and variables, listed by name with placeholders only and never with values;
   - the paired tests repo, if chosen.
8. Write every step to `journal.jsonl` so `incubator publish --resume <runId>` continues after a failure.
9. Clean up the workspace on success.

**Brownfield (`adopt`):**
- Clone the repo into the workspace or read the local path.
- Detect the stack, workflows, tests, agent config and deploy setup.
- Produce a gap report with each canonical item marked present, partial or missing.
- Render **only missing files**. Never overwrite an existing file; a conflicting file is written as `<file>.incubator-proposed` and listed in the PR.
- Push branch `incubator/adopt-<yyyymmdd>` and open a PR whose body contains the gap report.

## 8. Handoff
- Generate `docs/plans/000-bootstrap.md`, an executor plan (§3.2 format) built from `intent.coreFeatures`.
- Seed tracker tickets, one per feature, through the adapter.
- `incubator handoff` then either prints the command or, with `--launch`, starts the chosen local CLI headless in the new repo. The run is bounded by `runCeilings`, streams to the run log, and ends at the READY_FOR_TEST gate.

## 9. Phased roadmap (each phase ends green, committed, pushed)
- **Phase 0: Bootstrap and dogfood.**
  - Build the monorepo skeleton.
  - `pnpm check` must run lint, format, typecheck, unit tests, isolation lint, the BOM guard and the schema pin test.
  - Add CI workflows, lefthook, CLAUDE.md/AGENTS.md and `.claude/settings.json`. The SessionStart hook runs `pnpm install && pnpm check:quick`.
  - Write `docs/TDD.md` and the ADRs.
  - *Accept:* CI is green on push. A fresh cloud session can run `pnpm check` with no manual setup.
- **Phase 1: Spec and discovery (CLI).**
  - Build `packages/spec`, the `LlmAdapter`s with a recorded-fixture `fake`, the discovery state machine, the journal, and `incubator new --prompt "…" --spec-only`.
  - *Accept:*
    - 5 sample narratives produce schema-valid specs with the fake adapter, with ≤5 questions per round and every decision attributed;
    - `--yes` finishes without prompting;
    - a parked run resumes.
- **Phase 2: Template engine and scaffold to disk.**
  - Build the renderer, the lockfile, the `base` pack, the 4 stack packs, the 2 deploy packs and the 2 test-home packs.
  - Add `incubator scaffold <spec> --out <dir> [--dry-run]`.
  - *Accept:*
    - the output is byte-identical across two runs;
    - every stack × test-home combination renders, passes its own `check:quick`, and scores at or above the completeness threshold (this runs in the CI matrix);
    - the security fixtures fire;
    - the generated YAML passes actionlint.
- **Phase 3: GitHub publish, tracker and handoff.**
  - Build the GitHub adapter, the publish flow with resume, the Leantime and local tracker adapters, and the `handoff` command.
  - *Accept:*
    - the full flow runs against the fake GitHub, with its call sequence snapshot-tested;
    - the journal's resume works after a failure injected at each step;
    - the token never appears in any log;
    - a live test against a sandbox org exists and is gated behind `INCUBATOR_LIVE=1`.
- **Phase 4: Brownfield analyzer and delta PR.**
  - Build the detectors, the gap report, the no-overwrite renderer and `incubator adopt <url|path>`.
  - *Accept:*
    - 4 fixture repos (bare Node app, WordPress plugin, Python service, an already-compliant repo) produce the expected gap reports;
    - the compliant repo produces an empty delta;
    - no existing file is ever modified.
- **Phase 5: Localhost web UI.**
  - Build `incubator ui` with the wizard, tree preview, spec diff and live run log over SSE, reusing the core.
  - *Accept:*
    - Playwright e2e covers greenfield and brownfield runs against the fakes;
    - requests without the token, or with the wrong Origin, are rejected.
- **Phase 6: Electron desktop.**
  - Package the web UI with the engine running in-process, using electron-builder targets for Windows, macOS and Linux.
  - *Accept:*
    - the app builds in CI for all three OSes;
    - a smoke test launches it headless and completes a fake greenfield run.

## 10. Deliverable format for docs/TDD.md
Open with a one-page summary of the architectural strategy. Then give one section each for §§2–9, plus a threat model (the local UI, tokens, subprocesses, LLM prompt injection from brownfield repo content), then risks and open questions. Keep the design doc under 1,500 lines, with diagrams in Mermaid.
