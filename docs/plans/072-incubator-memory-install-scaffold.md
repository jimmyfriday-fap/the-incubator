# Plan 072: Install memory in the Incubator itself, part 1 of 2 (commit, scaffold, wire)

## Executor preamble

This plan installs the memory seed (`assets/memory-seed/`, version 1.0.1) into this repository in repo mode, following `assets/memory-seed/playbooks/deploy-repo.md` phases A, B and D. Plan 073 does phase C (bootstrap), phase E (verify) and the second commit. Run plan 072 first, then plan 073.

Rules for the executor (Haiku-class model):

- Output only the edits and commands this plan lists. Do not add steps, files, dependencies or explanations of your own.
- Run every command from the repository root (the folder that holds `package.json`, `AGENTS.md` and `lefthook.yml`). Every path in this plan is relative to it, because this repository's `abs-path` guard forbids absolute machine paths in committed files.
- Stop at the first mismatch: a find/replace that does not match exactly once, a command that exits non-zero when this plan expects 0, or output that differs from what is written. Report the command and its output. Never improvise a fix.
- Run PowerShell commands in PowerShell. Run the memory scripts only through Git Bash: `$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'`. A bare `bash` on this machine is the WSL launcher and is wrong.
- Never edit `AGENTS.md`. Never edit anything under `assets/memory-seed/`: copy from it only. Do not read the seed's skills, templates or playbooks as a source of conventions or decisions for this repository.
- Create and edit text files as UTF-8 without a BOM and with LF line endings. Never use `Add-Content` or `Set-Content` on repository files (they write CRLF or the wrong encoding).
- Commit only in WI-2 and WI-14, with the exact messages given. Never push, never run `gh`, never use `--no-verify`.
- A line that holds only a scaffold marker is parsed by the drift guard. Where this plan needs the CLAUDE.md markers, it builds them from two string pieces. Never type a marker on a line of its own in any file except through WI-9.

## Lane conformance

Not applicable. This plan changes the Incubator's own tooling and memory files, not a Backshack tool or plugin, so no Leantime lane applies.

## Touched files and markers

| File                                                                    | Marker                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------ |
| scripts/agent/sync-instructions.mjs                                     | `export function memoryRegion(`                        |
| scripts/agent/sync-instructions.test.mjs                                | `describe('memoryRegion'`                              |
| packages/templates/packs/base/files/scripts/agent/sync-instructions.mjs | `export function memoryRegion(`                        |
| .claude/settings.json                                                   | `"SessionEnd"`                                         |
| packages/templates/packs/base/files/.claude/settings.json               | `"SessionEnd"`                                         |
| CLAUDE.md                                                               | `<scaffold:memory>`                                    |
| lefthook.yml                                                            | `bash .memory/hooks/pre-commit`                        |
| .incubator/dogfood-exceptions.json                                      | `"glob": "lefthook.yml"`                               |
| .prettierignore                                                         | `.claude/skills/`                                      |
| .memory/memory.conf                                                     | `commit_policy=direct`                                 |
| .memory/PERMISSIONS.md                                                  | `**direct** (set in`                                   |
| .memory/WRITE-RULES.md                                                  | `## Incubator-specific rule: whose knowledge is this?` |
| .memory/README.md                                                       | `.memory/hooks/pre-commit`                             |
| .memory/.seed-version                                                   | `1.0.1`                                                |
| .memory/context/platform/architecture.md                                | `name: architecture`                                   |
| .memory/context/platform/conventions.md                                 | `name: conventions`                                    |
| .memory/context/platform/decisions.md                                   | `name: decisions`                                      |
| .memory/context/platform/failures.md                                    | `name: platform-failures`                              |
| .memory/context/projects/the-incubator/overview.md                      | `name: the-incubator-overview`                         |
| .memory/context/projects/the-incubator/decisions.md                     | `name: the-incubator-decisions`                        |
| .memory/context/projects/the-incubator/failures.md                      | `name: the-incubator-failures`                         |
| .memory/context/projects/the-incubator/status.md                        | `name: the-incubator-status`                           |
| .memory/INDEX.md                                                        | `# Memory index`                                       |
| .claude/skills/write-memory/SKILL.md                                    | `name: write-memory`                                   |
| .claude/skills/dream/SKILL.md                                           | `name: dream`                                          |
| .claude/skills/memory-bootstrap/SKILL.md                                | `name: memory-bootstrap`                               |

## Work items

### WI-1 Preflight (no changes)

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
Test-Path $bash
git rev-parse --show-toplevel
git branch --show-current
node -v
Test-Path .memory
Test-Path .memory-link
Get-Content assets/memory-seed/VERSION
& $bash -c 'uname -s'
```

Expected: `True`, the repository folder, a non-empty branch name, a Node version starting `v22.`, `False`, `False`, `1.0.1`, and a line containing `MINGW64`. Anything else: stop.

### WI-2 Commit the current working tree (the plan 071 work, the seed, and plans 072 and 073)

The tree was green on `pnpm check:quick` before these plans were added. First prove that nothing foreign is in it. This prints the paths that are NOT on the allowed list, and must print nothing:

```powershell
git status --porcelain -uall | ForEach-Object { $_.Substring(3) } | Where-Object { $_ -notmatch '^(\.prettierignore$|apps/cli/|apps/desktop/|apps/web/|assets/memory-seed/|config/features\.json$|docs/TDD\.md$|docs/adr/|docs/incubator-memory-feature\.md$|docs/plans/07[1-3]-|packages/core/|packages/llm/|tests/adapters/add-memory\.ts$|tests/scenarios/add-memory/)' }
```

If it printed anything, stop and report it. Otherwise commit:

```powershell
git add -A
git commit -m "feat(cli,core,web): Add memory repo mode (plan 071) and ship memory seed v1.0.1" -m "Also adds executor plans 072 and 073 for installing memory in the Incubator itself."
git status --porcelain
```

Expected: the commit succeeds (the lefthook pre-commit checks run) and the last command prints nothing.

### WI-3 Copy the seed into place (phase B, copy rows)

```powershell
$seed = 'assets/memory-seed'
New-Item -ItemType Directory -Force .memory/bin, .memory/hooks, .memory/transcripts, .memory/dreams, .memory/context/platform, .memory/context/projects/the-incubator, .claude/skills | Out-Null
Copy-Item "$seed/templates/README-store.md" .memory/README.md
Copy-Item "$seed/templates/WRITE-RULES.md" .memory/WRITE-RULES.md
Copy-Item "$seed/templates/DREAM-STEERING.md" .memory/DREAM-STEERING.md
Copy-Item "$seed/templates/PERMISSIONS.md" .memory/PERMISSIONS.md
Copy-Item "$seed/templates/memory.conf" .memory/memory.conf
Copy-Item "$seed/templates/ISOLATION.txt" .memory/ISOLATION.txt
Copy-Item "$seed/templates/gitignore" .memory/.gitignore
Copy-Item "$seed/VERSION" .memory/.seed-version
Copy-Item "$seed/bin/memory" .memory/bin/memory
Copy-Item "$seed/hooks/pre-commit" .memory/hooks/pre-commit
Copy-Item "$seed/hooks/session-end" .memory/hooks/session-end
Copy-Item "$seed/templates/transcripts-README.md" .memory/transcripts/README.md
New-Item -ItemType File -Force .memory/dreams/.gitkeep | Out-Null
Copy-Item "$seed/skills/write-memory" .claude/skills/write-memory -Recurse
Copy-Item "$seed/skills/dream" .claude/skills/dream -Recurse
Copy-Item "$seed/skills/memory-bootstrap" .claude/skills/memory-bootstrap -Recurse
```

`ISOLATION.txt` stays exactly as copied: this repository has no isolation terms (the Incubator legitimately knows about every system it builds for; isolation here is a write rule, see WI-5).

### WI-4 Fill the copied templates (use the edit tool; each old text must match exactly once)

File `.memory/memory.conf`:

- old: `commit_policy=<pr|direct>`
- new: `commit_policy=direct`

File `.memory/README.md`:

- old: `<store-prefix>hooks/pre-commit`
- new: `.memory/hooks/pre-commit`

File `.memory/PERMISSIONS.md`, edit 1:

- old: `Commit policy for this store: **<pr|direct>** (set in `memory.conf`).`
- new: `Commit policy for this store: **direct** (set in `memory.conf`).`

File `.memory/PERMISSIONS.md`, edit 2 (delete the `pr` section; the new text is empty). Old text, exactly, from the heading line through the sentence that ends `Only the human owner sets it.` and the blank line after it:

```text
## When commit_policy=pr

| Tier | Paths | human | claude-code (attended) | claude-code (unattended) | dream |
| --- | --- | --- | --- | --- | --- |
| platform | context/platform/**, skills, root rule files, system.yaml | direct | branch + PR | branch + PR | branch + PR |
| project | context/projects/<repo>/** | direct | direct, own repo only | branch + PR | branch + PR |
| scratch | scratch/** | direct | direct | direct | read-only |

The pre-commit hook blocks platform-tier commits on `main`/`master` unless `MEMORY_ALLOW_SYSTEM=1` is set. Only the human owner sets it.

```

Then replace the placeholder date in three files:

```powershell
foreach ($f in 'WRITE-RULES.md', 'DREAM-STEERING.md', 'PERMISSIONS.md') {
  $p = Join-Path $PWD.Path ".memory/$f"
  $t = [IO.File]::ReadAllText($p)
  [IO.File]::WriteAllText($p, $t.Replace('<TODAY>', '2026-11-04'), [Text.UTF8Encoding]::new($false))
}
```

### WI-5 Add the incubator-specific write rule to `.memory/WRITE-RULES.md`

Use the edit tool. Old text (exactly once):

```text
- Facts about other systems. `ISOLATION.txt` lists terms that must never appear.

## Where it goes
```

New text:

```text
- Facts about other systems. `ISOLATION.txt` lists terms that must never appear.

## Incubator-specific rule: whose knowledge is this?

This store holds knowledge about **how the incubator itself works**: its code, its build pipeline, its prompts, its session runner, its failure modes, and decisions about it.

Knowledge about a **solution the incubator builds** belongs in that solution's own memory store, never here. Examples: a target app's conventions, a target platform's rules, or a bug in generated code that is specific to one target.

One kind of target knowledge is allowed: rules the incubator must apply *when building* for a target, such as "Backshack-bound solutions must be built under Backshack guards from the start". Record these as incubator decisions, and point to the target's own store for the details instead of copying them.

## Where it goes
```

### WI-6 Create the eight context files (frontmatter and a title only; plan 073 fills them)

Create each file with exactly the content shown, ending with a single newline. Create the folders first if missing.

File `.memory/context/platform/architecture.md`:

```text
---
name: architecture
tier: platform
description: Components and how they connect; in a multi-repo system, one line per repo and every cross-repo edge. Read before structural changes.
last_verified: 2026-11-04
---

# Architecture
```

File `.memory/context/platform/conventions.md`:

```text
---
name: conventions
tier: platform
description: Rules that hold everywhere: naming, data access, error handling, UI and styling constraints. Read before writing code.
last_verified: 2026-11-04
---

# Conventions
```

File `.memory/context/platform/decisions.md`:

```text
---
name: decisions
tier: platform
description: Decisions that affect more than one repo, with reasons, newest first. Read before proposing an alternative approach.
last_verified: 2026-11-04
---

# Decisions
```

File `.memory/context/platform/failures.md`:

```text
---
name: platform-failures
tier: platform
description: Mistakes that recur across repos, and their fixes. Read before debugging.
last_verified: 2026-11-04
---

# Platform failures
```

File `.memory/context/projects/the-incubator/overview.md`:

```text
---
name: the-incubator-overview
tier: project
description: What the-incubator is, its entry points, and exact build/run/test commands. Read first when working in the-incubator.
last_verified: 2026-11-04
---

# the-incubator overview
```

File `.memory/context/projects/the-incubator/decisions.md`:

```text
---
name: the-incubator-decisions
tier: project
description: Decisions local to the-incubator, newest first. Read before changing how the-incubator does something.
last_verified: 2026-11-04
---

# the-incubator decisions
```

File `.memory/context/projects/the-incubator/failures.md`:

```text
---
name: the-incubator-failures
tier: project
description: Recurring mistakes in the-incubator and their fixes. Read before debugging the-incubator; append when you fix something likely to recur.
last_verified: 2026-11-04
---

# the-incubator failures
```

File `.memory/context/projects/the-incubator/status.md`:

```text
---
name: the-incubator-status
tier: project
description: Current state of in-flight work in the-incubator. Read at session start for orientation.
last_verified: 2026-11-04
---

# the-incubator status
```

### WI-7 Teach the generator to keep a memory region in CLAUDE.md

File `scripts/agent/sync-instructions.mjs`, edit 1 (use the edit tool; old text exactly once):

- old: `export function render(source) {`
- new:

```text
/** The memory region at the very top of an existing CLAUDE.md, followed by one blank line, or ''. */
export function memoryRegion(existing) {
  if (!existing) return '';
  const text = existing.replace(/\r\n?/g, '\n');
  const open = '<!-- <scaffold:' + 'memory> -->';
  const close = '<!-- </scaffold:' + 'memory> -->';
  if (!text.startsWith(open)) return '';
  const end = text.indexOf(close);
  if (end < 0) return '';
  return `${text.slice(0, end + close.length)}\n\n`;
}

export function render(source) {
```

File `scripts/agent/sync-instructions.mjs`, edit 2 (old text exactly once):

```text
    const want = make(t.header);
    const abs = path.join(root, t.file);
    let have;
    try {
      have = readFileSync(abs, 'utf8');
    } catch {
      have = null;
    }
```

New text:

```text
    const abs = path.join(root, t.file);
    let have;
    try {
      have = readFileSync(abs, 'utf8');
    } catch {
      have = null;
    }
    const want = `${t.file === 'CLAUDE.md' ? memoryRegion(have) : ''}${make(t.header)}`;
```

Create the test file `scripts/agent/sync-instructions.test.mjs` with exactly this content:

```text
// The CLAUDE.md memory region survives `pnpm agent:sync` (plan 072).
import { describe, expect, it } from 'vitest';
import { memoryRegion, render } from './sync-instructions.mjs';

const BLOCK =
  '<!-- <scaffold:' +
  'memory> -->\n## Memory\n\nRead the index first.\n<!-- </scaffold:' +
  'memory> -->';

describe('memoryRegion', () => {
  it('returns the region at the top of the file followed by one blank line', () => {
    expect(memoryRegion(`${BLOCK}\n\nrest of the file\n`)).toBe(`${BLOCK}\n\n`);
  });

  it('accepts CRLF input and returns LF text', () => {
    const crlf = `${BLOCK}\n\nrest\n`.replace(/\n/g, '\r\n');
    expect(memoryRegion(crlf)).toBe(`${BLOCK}\n\n`);
  });

  it('returns nothing when the file does not start with the region', () => {
    expect(memoryRegion(`intro\n${BLOCK}\n`)).toBe('');
    expect(memoryRegion(null)).toBe('');
    expect(memoryRegion('')).toBe('');
  });

  it('returns nothing when the region is never closed', () => {
    expect(memoryRegion('<!-- <scaffold:' + 'memory> -->\nunfinished\n')).toBe('');
  });

  it('keeps the region above the generated body', () => {
    const out = `${memoryRegion(`${BLOCK}\n\nold\n`)}${render('# Title\n\nBody\n')('')}`;
    expect(out.startsWith(`${BLOCK}\n\n<!-- Generated from`)).toBe(true);
    expect(out).toContain('<!-- <scaffold:agent-instructions> -->');
  });
});
```

Then format and lint the two files, and run the test:

```powershell
pnpm exec prettier --write scripts/agent/sync-instructions.mjs scripts/agent/sync-instructions.test.mjs
pnpm exec eslint --config eslint.config.js --max-warnings=0 scripts/agent/sync-instructions.mjs scripts/agent/sync-instructions.test.mjs
pnpm exec vitest run --project unit scripts/agent/sync-instructions.test.mjs
```

Expected: prettier lists both files, eslint prints nothing and exits 0, and vitest reports 5 passed tests.

### WI-8 Add the memory transcript hook to `.claude/settings.json`

Use the edit tool on `.claude/settings.json`. Old text (exactly once):

```text
          { "type": "command", "command": "node scripts/agent/on-stop.mjs", "timeout": 900 }
        ]
      }
    ]
  }
}
```

New text:

```text
          { "type": "command", "command": "node scripts/agent/on-stop.mjs", "timeout": 900 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "[ -f \"$CLAUDE_PROJECT_DIR/.memory/hooks/session-end\" ] && bash \"$CLAUDE_PROJECT_DIR/.memory/hooks/session-end\" || true"
          }
        ]
      }
    ]
  }
}
```

The `[ -f ... ]` guard makes the hook do nothing in a repository that has no `.memory/` (this file is copied into every generated repository). Then:

```powershell
pnpm exec prettier --check .claude/settings.json
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.json','utf8'))"
```

Expected: prettier says the file is formatted, and node prints nothing.

### WI-9 Put the memory block at the top of CLAUDE.md

```powershell
$open = '<!-- <scaffold:' + 'memory> -->'
$close = '<!-- </scaffold:' + 'memory> -->'
$block = [IO.File]::ReadAllText((Join-Path $PWD.Path 'assets/memory-seed/templates/CLAUDE-block-repo.md')).TrimEnd()
$claude = [IO.File]::ReadAllText((Join-Path $PWD.Path 'CLAUDE.md'))
$new = $open + "`n" + $block + "`n" + $close + "`n`n" + $claude
[IO.File]::WriteAllText((Join-Path $PWD.Path 'CLAUDE.md'), $new, [Text.UTF8Encoding]::new($false))
node scripts/agent/sync-instructions.mjs --check
```

Expected: the last command prints nothing and exits 0 (the generator now accepts the file as up to date, which proves the region is preserved). `AGENTS.md` is not touched by this item.

### WI-10 Refresh the pack copies and the golden manifests

```powershell
node scripts/packs-sync.mjs
node scripts/packs-sync.mjs --check
$env:INCUBATOR_GOLDEN_UPDATE = '1'
pnpm exec vitest run --project unit packages/templates/src/packs.test.ts
Remove-Item Env:INCUBATOR_GOLDEN_UPDATE
pnpm exec vitest run --project unit packages/templates/src/packs.test.ts
git diff --stat -- packages/templates/__golden__
(git diff -U0 -- packages/templates/__golden__ | Select-String '^[+-][0-9a-f]{64} ').Count
```

Expected: `synced 2 file(s)`, then `0 stale`, two passing vitest runs, a diff stat of 10 files changed, and the count `40` (two hash lines per golden file, removed and added). Any other count: stop and report.

### WI-11 Wire the git hook, the dogfood exception and prettier

File `lefthook.yml` (edit tool, old text exactly once):

```text
    abs-path:
      run: node scripts/guard/abs-path.mjs --quiet {staged_files}
```

New text:

```text
    abs-path:
      run: node scripts/guard/abs-path.mjs --quiet {staged_files}
    memory:
      run: bash .memory/hooks/pre-commit
```

File `.incubator/dogfood-exceptions.json` (edit tool, old text exactly once):

```text
    {
      "glob": ".gitignore",
```

New text:

```text
    {
      "glob": "lefthook.yml",
      "reason": "The Incubator's own pre-commit adds the memory guard (.memory/hooks/pre-commit); generated repositories get it only when an Add memory run installs it."
    },
    {
      "glob": ".gitignore",
```

File `.prettierignore` (edit tool, old text exactly once):

- old: `assets/memory-seed/`
- new:

```text
assets/memory-seed/
.memory/
.claude/skills/
```

Then:

```powershell
pnpm exec lefthook install
pnpm exec prettier --check lefthook.yml .incubator/dogfood-exceptions.json .prettierignore
pnpm exec vitest run --project unit scripts/dogfood.test.mjs
```

Expected: lefthook reports it synced the hooks, prettier reports the files formatted, and the dogfood test passes.

### WI-12 Mark the scripts executable, build the index, run the memory check

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
& $bash .memory/bin/memory index
& $bash .memory/bin/memory check
& $bash .memory/bin/memory stale
```

Expected: `wrote .memory/INDEX.md`, then `memory check: ok`, then no output from `stale`.

### WI-13 Run the quick gate

```powershell
pnpm check:quick
```

This takes up to 20 minutes. Do not interrupt it. Expected: exit 0. If it fails, fix only files this plan touched; if the cause is elsewhere, stop and report the failing step's output.

### WI-14 Stage, check the staged set, and make commit 1

```powershell
git add .memory .claude/skills .claude/settings.json CLAUDE.md lefthook.yml .prettierignore .incubator/dogfood-exceptions.json scripts/agent/sync-instructions.mjs scripts/agent/sync-instructions.test.mjs packages/templates
git update-index --chmod=+x .memory/bin/memory .memory/hooks/pre-commit .memory/hooks/session-end
git diff --cached --name-only | Where-Object { $_ -notmatch '^(\.memory/|\.claude/skills/|\.claude/settings\.json$|CLAUDE\.md$|lefthook\.yml$|\.prettierignore$|\.incubator/dogfood-exceptions\.json$|scripts/agent/sync-instructions(\.test)?\.mjs$|packages/templates/)' }
git diff --cached --quiet -- AGENTS.md; $LASTEXITCODE
git ls-files -s .memory/bin/memory .memory/hooks/pre-commit .memory/hooks/session-end
```

Expected: the second command prints nothing, `$LASTEXITCODE` prints `0`, and each `ls-files` line starts with `100755`. Then commit:

```powershell
git commit -m "mem(platform): scaffold memory infrastructure`n`nActor: bootstrap`nSession: manual"
git status --porcelain
git log -1 --format=%s
```

Expected: the commit succeeds, `git status --porcelain` prints nothing, and the subject is `mem(platform): scaffold memory infrastructure`. Do not push.

## Acceptance commands

```powershell
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
& $bash .memory/bin/memory check
& $bash .memory/bin/memory stale
node scripts/agent/sync-instructions.mjs --check
node scripts/packs-sync.mjs --check
node scripts/guard/plan-lint.mjs
git diff --quiet HEAD~1 -- AGENTS.md; $LASTEXITCODE
git log -2 --format=%s
```

```text
memory check: ok
0 stale
0
mem(platform): scaffold memory infrastructure
feat(cli,core,web): Add memory repo mode (plan 071) and ship memory seed v1.0.1
```

## Drift and hallucination guardrails

| Trap                                                    | Why                                                                                                          | Mechanical check                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bash` resolves to the WSL launcher                     | On this machine a bare `bash` is `System32\bash.exe`, which has no Git tools                                 | WI-1 runs `& $bash -c 'uname -s'` and expects `MINGW64`; every other command uses `$bash`                                                                                      |
| CRLF or a BOM written into the new files                | PowerShell 5.1 `Set-Content` and `Add-Content` write CRLF or ANSI, and `.memory/bin/memory` is a bash script | `(Get-ChildItem .memory,.claude/skills -Recurse -File \| ForEach-Object { [IO.File]::ReadAllBytes($_.FullName) } \| Where-Object { $_ -eq 13 }).Count` prints `0`              |
| The commit in WI-2 sweeps up files from another session | `git add -A` takes everything in the tree                                                                    | The allowlist command in WI-2 must print nothing before `git add -A`                                                                                                           |
| The memory block in CLAUDE.md is wiped by the next sync | `pnpm agent:sync` rewrites CLAUDE.md whole                                                                   | `node scripts/agent/sync-instructions.mjs --check` exits 0 with the block present, and the 5 tests in `sync-instructions.test.mjs` pass                                        |
| Pack copies or golden manifests left stale              | The base pack carries copies of `sync-instructions.mjs` and `.claude/settings.json`, hashed in 10 goldens    | `node scripts/packs-sync.mjs --check` prints `0 stale`, and `packs.test.ts` passes without `INCUBATOR_GOLDEN_UPDATE`                                                           |
| The seed is edited instead of copied                    | The same filenames exist under `assets/memory-seed/` and `.memory/`                                          | `git diff --quiet HEAD -- assets/memory-seed` exits 0 after WI-2, and `(Get-FileHash assets/memory-seed/bin/memory).Hash -eq (Get-FileHash .memory/bin/memory).Hash` is `True` |
| AGENTS.md is edited                                     | CLAUDE.md and AGENTS.md share one generator and one body                                                     | `git diff --quiet HEAD~1 -- AGENTS.md` exits 0 (acceptance block)                                                                                                              |
| Scripts lose their executable bit                       | Windows has no execute bit, so a fresh Linux clone would fail to run the hooks                               | `git ls-files -s` shows `100755` for the three scripts (WI-14)                                                                                                                 |
| A marker typed alone on a line breaks the drift guard   | `scripts/guard/drift.mjs` parses every file that contains `scaffold:`                                        | `node scripts/guard/drift.mjs` exits 0 inside `pnpm check:quick`                                                                                                               |
| A push happens by accident                              | The playbook text mentions pushing, and the policy is `direct`                                               | `git status -sb` shows the branch ahead of its upstream, and no `git push` appears in this plan's commands                                                                     |

## Review rounds

| Round | Reviewer            | Finding                                                                                                            | Status |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------ | ------ |
| 1     | Claude (in-session) | Dogfood test and 10 golden manifests would fail on the new pack copies; added the exception and the golden refresh | CLOSED |
| 2     | Claude (in-session) | Playbook ground rule 3 needs a clean tree; added the allowlisted commit in WI-2                                    | CLOSED |
