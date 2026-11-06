# Plan 073: Install memory in the Incubator itself, part 2 of 2 (bootstrap, verify, commit)

## Executor preamble

Plan 072 already scaffolded `.memory/`, wired the hooks and made the commit `mem(platform): scaffold memory infrastructure`. This plan does playbook phases C (bootstrap), E (verify) and the second commit of F. The facts to record were researched and drafted by the plan author: the executor copies them in, it does not survey the code and does not decide what counts as a convention or a decision.

Rules for the executor (Haiku-class model):

- Output only the edits and commands this plan lists. Do not add lines, files or explanations of your own.
- Run every command from the repository root. Every path is relative to it, because the `abs-path` guard forbids absolute machine paths in committed files.
- Stop at the first mismatch: an edit whose old text does not match exactly once, a command that exits non-zero when this plan expects 0, or output that differs from what is written. Report the command and its output. Never improvise a fix.
- Run the memory scripts only through Git Bash: `$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'`. A bare `bash` here is the WSL launcher and is wrong.
- Never edit `AGENTS.md`, `CLAUDE.md` or anything under `assets/memory-seed/`. Do not use the seed's skills, templates or playbooks as a source for the lines below.
- Write files as UTF-8 without a BOM and with LF line endings. Never use `Add-Content` or `Set-Content` on repository files.
- Commit only in WI-8, with the exact message given. Never push, never run `gh`, never use `--no-verify`.
- A line that holds only a scaffold marker is parsed by the drift guard. None of the lines below is one: keep each memory line on a single line that starts with `- [`.

## Lane conformance

Not applicable. This plan only fills memory files for the Incubator's own repository; no Backshack tool or plugin lane applies.

## Touched files and markers

| File                                                | Marker                         |
| --------------------------------------------------- | ------------------------------ |
| .memory/context/platform/architecture.md            | `packages/core/src/engine.ts`  |
| .memory/context/platform/conventions.md             | `@incubator/source`            |
| .memory/context/platform/decisions.md               | `stated in planning`           |
| .memory/context/projects/the-incubator/overview.md  | `Local project genesis engine` |
| .memory/context/projects/the-incubator/decisions.md | `typescript-eslint`            |
| .memory/context/projects/the-incubator/failures.md  | `commit 66da936`               |
| .memory/context/projects/the-incubator/status.md    | `Add memory repo mode`         |
| .memory/DREAM-STEERING.md                           | `Windows breakage`             |
| .claude/skills/write-executor-plan/SKILL.md         | `name: write-executor-plan`    |
| .claude/skills/sync-pack-copies/SKILL.md            | `name: sync-pack-copies`       |
| .claude/skills/add-an-adr/SKILL.md                  | `name: add-an-adr`             |
| .memory/INDEX.md                                    | `write-executor-plan`          |

## Work items

### WI-1 Preflight (no changes)

```powershell
git log -3 --format=%s
git status --porcelain
git branch --show-current
Test-Path .memory/context/platform/architecture.md
```

Expected: three subjects, newest first, where one of them is `mem(platform): scaffold memory infrastructure` (later commits may only edit docs/plans), then nothing, then a non-empty branch name, then `True`. Anything else: stop.

### WI-2 Fill the platform context files

For each file below: open it, its last line is the title heading. Add one blank line, then the lines shown, each on its own line, in the order shown, and end the file with a single newline. Change nothing else.

File `.memory/context/platform/architecture.md`:

```text
- [2026-11-04] [bootstrap] The repository is a pnpm monorepo of eight engine packages (analyzer, core, git, llm, runtime, spec, templates, tracker) and three apps (cli, desktop, web). (src: config/deps-boundary.json)
- [2026-11-04] [bootstrap] Dependencies point one way: runtime depends on nothing; spec and git on runtime; llm, tracker and templates on runtime and spec; analyzer on those plus templates and git; core on all seven other packages; the apps sit on top, and apps/cli also depends on apps/web. (src: config/deps-boundary.json)
- [2026-11-04] [bootstrap] packages/runtime is the shared kernel: error and exit-code types, exec.ts (the only module allowed to import node:child_process), a logger with the redactor at its sink, SecretString, and path helpers. (src: docs/adr/002-runtime-kernel-package.md, docs/adr/008-subprocess-spawning.md)
- [2026-11-04] [bootstrap] packages/core/src/engine.ts holds the Engine class that drives a run; packages/spec holds the JSON Schema for incubator.json and the stack catalog in src/stacks.ts. (src: packages/core/src/engine.ts, docs/adr/006-spec-schema-source-of-truth.md, docs/adr/030-backshack-tool-stack.md)
- [2026-11-04] [bootstrap] Each run writes an append-only journal at runs/<runId>/journal.jsonl and resumes by replaying it through a pure reducer; the project portfolio is a separate file, portfolio.json in the Incubator home folder, that incubator gc never removes. (src: docs/adr/010-run-journal-and-resume.md, docs/adr/028-project-portfolio-and-repo-marker.md)
- [2026-11-04] [bootstrap] packages/templates/packs holds the base pack and the stack packs that render a new repository with Eta; the guard toolkit under scripts/ is copied byte for byte into the base pack by scripts/packs-sync.mjs. (src: scripts/packs-sync.mjs, docs/adr/013-guard-toolkit-in-node.md)
- [2026-11-04] [bootstrap] The command line is apps/cli/bin/incubator.mjs, the localhost web UI is apps/web, and the Electron desktop app runs the same Fastify server in-process. (src: apps/cli/package.json, docs/adr/012-electron-in-process-server.md)
- [2026-11-04] [bootstrap] assets/memory-seed/ is the memory seed (version 1.0.1) that the Incubator ships and copies, read-only, into each Add memory run; it is an asset the Incubator ships, not this repository's own memory. (src: docs/adr/031-add-memory-runs.md, docs/incubator-memory-feature.md)
- [2026-11-04] [bootstrap] An Add memory run copies the seed into its run folder, lets a coding-agent session follow the deploy-repo playbook (prompt in packages/core/prompts/memory-repo.md, allowed commands in MEMORY_ALLOWED_TOOLS in packages/core/src/memory.ts), then checks the result and parks memory_rules_broken or memory_verify_failed on a failure. (src: docs/adr/031-add-memory-runs.md, docs/plans/071-add-memory-repo-mode.md)
```

File `.memory/context/platform/conventions.md`:

```text
- [2026-11-04] [bootstrap] Every package is "type": "module" with nodenext resolution, verbatimModuleSyntax, strict, exactOptionalPropertyTypes and noUncheckedIndexedAccess; builds use tsc -b with project references. (src: docs/adr/001-monorepo-toolchain.md)
- [2026-11-04] [bootstrap] Each package's exports lists the custom condition @incubator/source (pointing at src/index.ts) ahead of default, so Vitest runs on sources without a build, while Node at runtime uses dist. (src: docs/adr/001-monorepo-toolchain.md, vitest.config.ts)
- [2026-11-04] [bootstrap] packages/spec/schema/incubator.schema.json is hand-authored and is the source of truth; src/types.gen.ts is generated and committed, and the spec:types test fails on any diff. (src: docs/adr/006-spec-schema-source-of-truth.md)
- [2026-11-04] [bootstrap] Templates are Eta files read as it.x (no useWith), with autoEscape false and autoTrim false, and they pass the restricted-template lint in packages/templates/src/template-lint.ts. (src: docs/adr/003-template-engine-eta.md, packages/templates/src/template-lint.ts)
- [2026-11-04] [bootstrap] Generated text files carry scaffold: regions delimited by comment markers; JSON files are changed by declarative patches, not by markers. (src: docs/adr/005-scaffold-markers-and-json-patches.md)
- [2026-11-04] [bootstrap] Fakes live in each package's testing entry (@incubator/<pkg>/testing), the standard harness is createEngine(fakeDeps()), and the unit project stubs the network. (src: docs/adr/015-test-strategy-fakes-and-live-gating.md, vitest.config.ts)
- [2026-11-04] [bootstrap] A secret value is held in a SecretString, which prints [REDACTED] from toString, toJSON and util.inspect, and the logger's redactor masks registered values. (src: docs/adr/009-secrets-and-redaction.md)
- [2026-11-04] [bootstrap] Files are LF: .gitattributes sets text=auto eol=lf and Prettier sets endOfLine lf, so write LF even on Windows. (src: .gitattributes, .prettierrc.json)
- [2026-11-04] [bootstrap] A script that is copied into the base pack (the guard toolkit, scripts/agent/*.mjs and .claude/settings.json) is edited in the repository and then copied with node scripts/packs-sync.mjs; the pack copy is never edited by hand. (src: scripts/packs-sync.mjs, scripts/dogfood.test.mjs)
- [2026-11-04] [bootstrap] A scaffold:memory region at the very top of CLAUDE.md holds the memory block and is preserved by pnpm agent:sync; the other generated agent files do not carry it. (src: scripts/agent/sync-instructions.mjs)
```

File `.memory/context/platform/decisions.md`:

```text
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
```

`.memory/context/platform/failures.md` stays with its title only (a store with one repository has no cross-repository failures).

### WI-3 Fill the project context files

File `.memory/context/projects/the-incubator/overview.md`:

```text
- [2026-11-04] [bootstrap] Local project genesis engine: a plain-English narrative and/or an existing repository in, a canonical GitHub repository out. (src: package.json)
- [2026-11-04] [bootstrap] TypeScript ESM monorepo on pnpm 10 workspaces and Node >=22.12 <23, with Vitest 5, ESLint 10, Prettier 3.9.9 and lefthook. (src: package.json, .nvmrc)
- [2026-11-04] [bootstrap] Entry points: the CLI incubator (apps/cli/bin/incubator.mjs), the localhost web UI (apps/web) and the Electron desktop app (apps/desktop). (src: apps/cli/package.json, config/deps-boundary.json)
- [2026-11-04] [bootstrap] Install dependencies with pnpm; the session-start hook installs with the frozen lockfile. (src: package.json, docs/adr/017-agent-hooks-and-tracker-loop.md)
- [2026-11-04] [bootstrap] Build with pnpm build (tsc -b tsconfig.build.json); typecheck with pnpm typecheck. (src: package.json)
- [2026-11-04] [bootstrap] Unit tests: pnpm test (Vitest project unit); browser tests: pnpm test:e2e; desktop smoke tests: pnpm test:desktop-smoke; named run profiles: pnpm test:profile <name>. (src: package.json, vitest.config.ts)
- [2026-11-04] [bootstrap] CI is GitHub Actions: ci.yml runs check on three operating systems; desktop.yml, security-scan.yml, deploy-production.yml and promote-to-production.yml cover the rest. (src: .github/workflows, .incubator/dogfood-exceptions.json)
- [2026-11-04] [bootstrap] External services: GitHub (token from the keychain, then gh auth token, then GITHUB_TOKEN) and coding-agent or model CLIs whose flags are probed at run time. (src: docs/adr/009-secrets-and-redaction.md, docs/adr/007-llm-adapters-probing-and-sandboxing.md)
- [2026-11-04] [bootstrap] Docs: design in docs/TDD.md, decisions in docs/adr/, executor plans in docs/plans/, and the Add memory spec in docs/incubator-memory-feature.md. (src: docs/adr/README.md, docs/plans/README.md)
```

File `.memory/context/projects/the-incubator/decisions.md`:

```text
- [2026-11-04] [bootstrap] TypeScript is pinned to ~6.0.3, pnpm 10 through packageManager, and Node to >=22.12 <23 through engines and .nvmrc; upgrade TypeScript to 7.x when typescript-eslint supports it. (src: docs/adr/001-monorepo-toolchain.md, .nvmrc)
- [2026-11-04] [bootstrap] which(name) resolves a Windows cmd shim by parsing the shim and spawning process.execPath with the script, because subprocesses are shell-less. (src: docs/adr/008-subprocess-spawning.md)
- [2026-11-04] [bootstrap] The local UI binds 127.0.0.1 on an OS-picked port; its launch token travels in ?t= and is exchanged once for an HttpOnly SameSite=Strict cookie. (src: docs/adr/011-localhost-ui-security.md)
- [2026-11-04] [bootstrap] On a passing Stop the active ticket moves forward one legal state at a time (TAGGED_TO_RELEASE, ENRICHMENT_IN_PROGRESS, DEV_IN_PROGRESS, then READY_FOR_TEST); a parked or finished ticket is left alone. (src: docs/adr/017-agent-hooks-and-tracker-loop.md)
- [2026-11-04] [bootstrap] The portfolio is one small JSON file written atomically with mode 0600; a damaged file is renamed portfolio.json.damaged-<time> and a new one starts, so it never stops a run. (src: docs/adr/028-project-portfolio-and-repo-marker.md)
- [2026-11-04] [bootstrap] Add memory runs default to claude-opus-5-5 at effort high, because a deploy runs once and its mistakes reach every later session; effort is applied only where the CLI has a flag for it. (src: docs/adr/031-add-memory-runs.md)
- [2026-11-04] [bootstrap] After an Add memory install, memory.installed records the store, policy and seed version on the portfolio project, and later update runs start with a line that points the agent at .memory/INDEX.md. (src: docs/adr/031-add-memory-runs.md)
```

File `.memory/context/projects/the-incubator/failures.md`:

```text
- [2026-11-04] [bootstrap] Reading git status must not take the index lock; a status read that did made a commit running beside it fail. (src: commit 66da936)
- [2026-11-04] [bootstrap] On Windows a command shim that wraps a PHP archive must be run with php, not with node. (src: commit 1e8e04f)
- [2026-11-04] [bootstrap] A built repository's dependencies must be installed before the coding agent starts, including a repository with no lockfile. (src: commits 644881a, f161bcd)
- [2026-11-04] [bootstrap] On Windows the git-heavy unit tests run six workers at a time; one worker per core made the slowest test time out at 120 seconds in a full run. (src: vitest.config.ts)
- [2026-11-04] [bootstrap] Editing a script that is copied into the base pack without running node scripts/packs-sync.mjs fails the dogfood test, and the golden manifests in packages/templates/__golden__ must be refreshed with INCUBATOR_GOLDEN_UPDATE=1 after a reviewed pack change. (src: scripts/dogfood.test.mjs, packages/templates/src/packs.test.ts)
- [2026-11-04] [bootstrap] A base-pack file that differs in the repository fails the dogfood test unless .incubator/dogfood-exceptions.json lists it with a reason, and a listed exception that no longer differs fails too. (src: scripts/dogfood.test.mjs)
- [2026-11-04] [bootstrap] A line that holds only a scaffold marker is parsed by the drift guard in any file, so showing a marker alone on a line in a plan or a doc fails check:quick. (src: scripts/guard/drift.mjs, scripts/guard/lib/markers.mjs)
```

File `.memory/context/projects/the-incubator/status.md`:

```text
- [2026-11-04] [bootstrap] Add memory repo mode (plan 071) is implemented: CLI command in apps/cli/src/commands/memory.ts, web form in apps/web/src/ui/views/AddMemory.tsx, engine step in packages/core/src/engine.ts; store mode, Add member, Upgrade and Dream are not built. (src: docs/plans/071-add-memory-repo-mode.md, docs/adr/031-add-memory-runs.md)
- [2026-11-04] [bootstrap] This store was installed on 2026-11-04 from seed 1.0.1 with commit policy direct. (src: .memory/.seed-version, .memory/memory.conf)
- [2026-11-04] [bootstrap] Memory by default for every new build (scaffold at the start, bootstrap at the end, an opt-out toggle) is planned but not built. (src: owner, session prompt of 2026-11-04)
```

### WI-4 Fill the dream steering

File `.memory/DREAM-STEERING.md` (edit tool, old text exactly once):

- old: `- (drafted by bootstrap; replace with this system's real failure types)`
- new:

```text
- Windows breakage: shell shims, CRLF line endings, the git index lock, slow git-heavy tests.
- Drift between the repository and the base template pack: stale pack copies, stale golden manifests, missing dogfood exceptions.
- Gate vetoes that recur: check:quick failures at the Stop hook, plan-lint findings, a scaffold marker alone on a line.
- Agent runs crossing their boundary: a push, gh, network access or an edit to AGENTS.md from an Add memory or folder run.
- Target-specific knowledge written into this store instead of the solution's own store.
- Executor plans that miss: a marker that never landed, a find/replace that matched nothing, a plan that outgrew its budget.
```

### WI-5 Create the three procedure stubs

Create each file with exactly the content shown, ending with a single newline.

File `.claude/skills/write-executor-plan/SKILL.md`:

```text
---
name: write-executor-plan
description: Writes a new executor plan under docs/plans that passes the plan-lint guard. Use when a change is handed to a smaller model or another session to carry out.
---

# Write an executor plan

1. Pick the next number: list `docs/plans/` and take the highest `NNN` plus one. The file is `docs/plans/NNN-kebab-slug.md`, never at the repository root.
2. Include the five required sections with these exact headings: `Executor preamble`, `Touched files and markers` (a table), `Acceptance commands` (a command block, then an expected-output block), `Drift and hallucination guardrails` (a table with the columns Trap, Why and Mechanical check) and `Review rounds` (a table where every row ends in FIX-FIRST or CLOSED).
3. Use repository-relative paths only; the abs-path guard rejects absolute machine paths.
4. Run `node scripts/guard/plan-lint.mjs` and fix every finding, then run `pnpm exec prettier --write` on the plan file.

Status: stub from bootstrap; confirm with the owner on first real use.
```

File `.claude/skills/sync-pack-copies/SKILL.md`:

```text
---
name: sync-pack-copies
description: Refreshes the copies of the guard toolkit that live in the base template pack, and the golden manifests that hash them. Use after editing any script that scripts/packs-sync.mjs copies, or .claude/settings.json.
---

# Sync pack copies

1. Run `node scripts/packs-sync.mjs`. It copies each changed file into `packages/templates/packs/base/files/`.
2. Run `node scripts/packs-sync.mjs --check`. It must print `0 stale`.
3. Refresh the golden manifests: set `INCUBATOR_GOLDEN_UPDATE=1`, run `pnpm exec vitest run --project unit packages/templates/src/packs.test.ts`, unset the variable, and run the same command again. Both runs must pass.
4. Review the diff of `packages/templates/__golden__`: only the sha256 lines of the changed files may differ.
5. If a base-pack file in the repository must differ from the rendered pack, add an entry with a reason to `.incubator/dogfood-exceptions.json`.

Status: stub from bootstrap; confirm with the owner on first real use.
```

File `.claude/skills/add-an-adr/SKILL.md`:

```text
---
name: add-an-adr
description: Records a non-obvious decision as an architecture decision record. Use when a change picks between real alternatives or amends an earlier ADR.
---

# Add an ADR

1. Number it: take the highest file number in `docs/adr/` plus one. The file is `docs/adr/NNN-kebab-title.md`.
2. Start with `# ADR-NNN: <title>`, then the Status (`Proposed` or `Accepted`), the Date and the Context doc, then the sections Context, Decision, Alternatives considered and Consequences.
3. Add a row for it to the index table in Appendix A of `docs/TDD.md`.
4. Run `pnpm exec prettier --write` on both files.

Status: stub from bootstrap; confirm with the owner on first real use.
```

### WI-5a Normalize line endings to LF

The editor tools can write CRLF into the files you just created or changed. Convert every file under `.memory` and `.claude/skills` to LF, then count the carriage returns:

```powershell
foreach ($f in Get-ChildItem .memory, .claude/skills -Recurse -File -Force) {
  $t = [IO.File]::ReadAllText($f.FullName)
  if ($t.Contains("`r")) { [IO.File]::WriteAllText($f.FullName, $t.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false)) }
}
(Get-ChildItem .memory, .claude/skills -Recurse -File -Force | ForEach-Object { [IO.File]::ReadAllBytes($_.FullName) } | Where-Object { $_ -eq 13 }).Count
```

Expected: `0`. Any other number: stop and report.

### WI-6 Rebuild the index and run the memory check

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
& $bash .memory/bin/memory index
& $bash .memory/bin/memory check
& $bash .memory/bin/memory stale
```

Expected: `wrote .memory/INDEX.md`, then `memory check: ok`, then no output from `stale`. If `check` reports a bad line, fix that line in place (never delete it) and rerun.

### WI-7 Verify (playbook phase E)

E2, line counts and citations:

```powershell
foreach ($f in 'platform/architecture','platform/conventions','platform/decisions','platform/failures','projects/the-incubator/overview','projects/the-incubator/decisions','projects/the-incubator/failures','projects/the-incubator/status') { "$f " + @(Select-String -Path ".memory/context/$f.md" -Pattern '^- \[').Count }
Get-ChildItem .memory/context -Recurse -Filter *.md | Select-String -Pattern '\[bootstrap\]' | Where-Object { $_.Line -notmatch '\(src: ' } | ForEach-Object { $_.Path }
@(Get-ChildItem .memory/context -Recurse -Filter *.md | Select-String -SimpleMatch '(unconfirmed)').Count
@(Get-ChildItem .memory/context -Recurse -Filter *.md | Select-String -SimpleMatch 'src: assets/memory-seed').Count
```

Expected: the eight counts `9, 10, 10, 0, 9, 7, 7, 3` in that order (each printed after its file name), then no paths, then `0`, then `0`.

E3, only allowed paths changed and AGENTS.md untouched:

```powershell
git status --porcelain -uall | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -notmatch '^(\.memory/|\.claude/skills/)' }
git diff --quiet HEAD -- AGENTS.md; $LASTEXITCODE
```

Expected: no paths, then `0`.

E4, the hook rejects a bad line (this stages a bad line, runs the pre-commit hooks without committing, then restores the file):

```powershell
$p = Join-Path $PWD.Path '.memory/context/projects/the-incubator/failures.md'
$orig = [IO.File]::ReadAllText($p)
[IO.File]::WriteAllText($p, $orig + "- not a dated line`n", [Text.UTF8Encoding]::new($false))
git add .memory/context/projects/the-incubator/failures.md
$out = pnpm exec lefthook run pre-commit 2>&1 | Out-String
"lefthook exit: $LASTEXITCODE"
$out -match 'not a dated line'
[IO.File]::WriteAllText($p, $orig, [Text.UTF8Encoding]::new($false))
git reset -q HEAD -- .memory/context/projects/the-incubator/failures.md
```

Expected: `lefthook exit:` is not `0`, and the last printed line is `True` (the hook output names the bad line, so the rejection came from the memory check and not from a missing `bash`). If the exit is `0` or the last line is `False`, stop and report. The file content is restored by the last two commands.

E5, policy wiring:

```powershell
Select-String -Path .memory/memory.conf -Pattern '^commit_policy=direct\s*$'
Select-String -Path .memory/hooks/pre-commit -SimpleMatch 'commit_policy=direct'
```

Expected: one match from `memory.conf`, and the matching lines of the hook's `direct` early exit.

E6, transcript capture:

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
$root = $PWD.Path -replace '\\', '/'
$env:CLAUDE_PROJECT_DIR = $root
('{"session_id":"selftest","transcript_path":"' + $root + '/.memory/README.md"}') | & $bash .memory/hooks/session-end
Remove-Item Env:CLAUDE_PROJECT_DIR
Get-ChildItem .memory/transcripts -Recurse -Filter selftest.jsonl | ForEach-Object { $_.FullName.Substring($PWD.Path.Length + 1) }
git status --porcelain -uall | Select-String 'transcripts/'
Get-ChildItem .memory/transcripts -Directory | Remove-Item -Recurse -Force
```

Expected: one path ending `selftest.jsonl` under `.memory\transcripts\<date>\`, and no `git status` line mentioning `transcripts/`. If the file was not created, report that as a failed check E6 and do not try to fix the hook.

E7, cold read. Run:

```powershell
Select-String -Path .memory/context/projects/the-incubator/overview.md -SimpleMatch 'pnpm build', 'pnpm test'
Select-String -Path .memory/context/projects/the-incubator/failures.md -SimpleMatch 'packs-sync', 'dogfood', 'index lock'
```

Then, using only `CLAUDE.md`, `.memory/INDEX.md` and the files the index points to, write the answer to this question in your final report: "How do I build and test this repo, and what are the top three things a new session would most likely get wrong?" The expected facts: build with `pnpm build`; test with `pnpm test` and gate with `pnpm check:quick` then `pnpm check`; pitfalls are stale pack copies and golden manifests after editing a copied script, a scaffold marker alone on a line, and Windows shims and CRLF.

### WI-8 Run the quick gate, then commit 2

```powershell
pnpm check:quick
```

This takes up to 20 minutes. Do not interrupt it. Expected: exit 0. If it fails, fix only files this plan touched; if the cause is elsewhere, stop and report the failing step's output.

Then:

```powershell
git add .memory .claude/skills
git diff --cached --name-only | Where-Object { $_ -notmatch '^(\.memory/|\.claude/skills/)' }
git commit -m "mem(platform): bootstrap repo memory`n`nActor: bootstrap`nSession: manual"
git status --porcelain
git log -3 --format=%s
git status -sb | Select-Object -First 1
```

Expected: the second command prints nothing, the commit succeeds, `git status --porcelain` prints nothing, `git log` shows `mem(platform): bootstrap repo memory`, `mem(platform): scaffold memory infrastructure`, then the plan 071 commit subject, and the last line shows the branch ahead of its upstream (or no upstream). Do not push.

## Acceptance commands

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
& $bash .memory/bin/memory check
& $bash .memory/bin/memory stale
node scripts/guard/plan-lint.mjs
git diff --quiet HEAD~2 -- AGENTS.md; $LASTEXITCODE
git log -2 --format=%s
```

```text
memory check: ok
0
mem(platform): bootstrap repo memory
mem(platform): scaffold memory infrastructure
```

## Drift and hallucination guardrails

| Trap                                                     | Why                                                                                       | Mechanical check                                                                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A memory line copied into the wrong file or dropped      | Nine files are filled from one plan, and a missed paste still passes `memory check`       | WI-7 prints the line count of every context file and expects `9, 10, 10, 0, 9, 7, 7, 3`                                                                           |
| A bootstrap line without a source                        | The write rules require `(src: ...)` on every bootstrap line, but `memory check` does not | WI-7 lists every `[bootstrap]` line that lacks `(src: ` and expects no output                                                                                     |
| The seed is read as a source of conventions              | The seed's own skills and templates look like repository conventions                      | WI-7 counts lines that cite `src: assets/memory-seed` and expects `0`                                                                                             |
| The bad-line test leaves a bad line behind or commits it | The test edits a real memory file                                                         | WI-7 E4 restores the file content from `$orig`, unstages it, and never runs `git commit`; WI-8 `check` then passes                                                |
| AGENTS.md or CLAUDE.md is edited                         | The memory block lives in CLAUDE.md, next to AGENTS.md's generated body                   | `git diff --quiet HEAD~2 -- AGENTS.md` exits 0, and WI-8 stages only `.memory` and `.claude/skills`                                                               |
| Index out of date after the stubs                        | `memory check` fails when `INDEX.md` does not match the files                             | WI-6 runs `index` then `check` after the stubs exist                                                                                                              |
| CRLF or a BOM in the new files                           | PowerShell 5.1 writes CRLF or ANSI with `Add-Content` and `Set-Content`                   | `(Get-ChildItem .memory,.claude/skills -Recurse -File \| ForEach-Object { [IO.File]::ReadAllBytes($_.FullName) } \| Where-Object { $_ -eq 13 }).Count` prints `0` |
| A secret-looking string trips the memory check           | `bin/memory check` greps context for `token`, `secret`, `password` followed by `:` or `=` | WI-6 `check` prints `memory check: ok`; lines in this plan name tokens only in prose, never as `name: value`                                                      |
| A push happens by accident                               | The policy is `direct`, so the repository normally pushes                                 | WI-8 ends with `git status -sb` showing the branch ahead (or no upstream); no `git push` appears in this plan                                                     |

## Review rounds

| Round | Reviewer            | Finding                                                                                                                      | Status |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Claude (in-session) | Every source cited in the drafted lines was checked against the ADRs, config files and commit subjects read while planning   | CLOSED |
| 2     | Claude (in-session) | The bad-line test cannot use a real commit (it could not be undone safely), so it runs the lefthook pre-commit hooks instead | CLOSED |
