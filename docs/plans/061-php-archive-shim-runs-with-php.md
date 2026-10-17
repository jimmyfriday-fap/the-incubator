# Plan 061: on Windows a command shim that wraps a PHP archive is run with php, not with node

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 4 runs the formatter and the sync.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Before you start, check that `scripts/guard/lib/proc.mjs` contains `export function parseCmdShim(` and that `scripts/guard/guards.test.mjs` contains `it('parses cmd shims like the runtime does'`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment. Do not edit anything under `packages/templates/packs/` or `packages/templates/__golden__/` by hand: work item 4 produces them.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** In the COI Tracker run the coding session's SessionStart hook tried to install the PHP dependencies and failed: `composer.phar:2 <?php SyntaxError: Unexpected token '<'`. On this machine `composer` on PATH is `composer.bat`, whose only job is to run `composer.phar` with PHP. The generated repository's guard toolkit (`which` in `scripts/guard/lib/proc.mjs`, copied into every generated repository) reads that shim, takes its target `composer.phar`, and returns `[node, [composer.phar]]`: it runs a PHP archive with node. Every Windows machine with Composer installed this way gets the same failure, so the hook's install (plan 056's template fix, commit f161bcd) cannot work there. The generated WordPress repository already knows the rule for its own audit step (`scripts/php/composer.mjs`: `php composer.phar` next to the `composer.bat` shim); the shared helper does not.

After this plan, `which` returns `[php, [composer.phar]]` for a shim whose target is a `.phar`, found through the same PATH lookup, and skips the shim (as it does for a shim it cannot read) when php is not on PATH. A native `.exe` or `.com` target and a JavaScript target behave as before. The rule lives in a small exported function, `shimCommand`, so a test can run it on any operating system.

## Work items

### 1. The helper and its use

In `scripts/guard/lib/proc.mjs`:

Find:

```text
/** PATH lookup; returns [command, prefixArgs] runnable with shell:false, or null. */
```

Replace with:

```text
/**
 * Plan 061: what runs the target of a Windows command shim. A native program runs itself, a PHP archive (Composer's
 * `composer.phar`) runs through php, and anything else is a script for node. Null when php is needed and is not on PATH.
 */
export function shimCommand(target, env = process.env) {
  if (/\.(exe|com)$/i.test(target)) return [target, []];
  if (/\.phar$/i.test(target)) {
    const php = which('php', env);
    return php === null ? null : [php[0], [...php[1], target]];
  }
  return [process.execPath, [target]];
}

/** PATH lookup; returns [command, prefixArgs] runnable with shell:false, or null. */
```

Find:

```text
        return /\.(exe|com)$/i.test(target) ? [target, []] : [process.execPath, [target]];
```

Replace with:

```text
        const command = shimCommand(target, env);
        if (command === null) continue;
        return command;
```

### 2. The test

In `scripts/guard/guards.test.mjs`:

Find:

```text
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
```

Replace with:

```text
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
```

Find:

```text
import { childEnv, parseCmdShim, run, which } from './lib/proc.mjs';
```

Replace with:

```text
import { childEnv, parseCmdShim, run, shimCommand, which } from './lib/proc.mjs';
```

Find:

```text
    expect(parseCmdShim('echo', 'C:\\x.cmd')).toBeNull();
  });
```

Replace with:

```text
    expect(parseCmdShim('echo', 'C:\\x.cmd')).toBeNull();
  });
  it('runs a shim that wraps a PHP archive with php, not with node (plan 061)', () => {
    const bin = mkdtempSync(path.join(tmpdir(), 'shim php '));
    const phpName = process.platform === 'win32' ? 'php.exe' : 'php';
    const php = path.join(bin, phpName);
    writeFileSync(php, '');
    chmodSync(php, 0o755);
    const env = { PATH: bin };
    expect(shimCommand('bin\\composer.phar', env)).toEqual([php, ['bin\\composer.phar']]);
    // A native program and a script keep their own runners.
    expect(shimCommand('bin\\x.exe', env)).toEqual(['bin\\x.exe', []]);
    expect(shimCommand('r\\x\\bin\\x.js', env)).toEqual([process.execPath, ['r\\x\\bin\\x.js']]);
    // No php on PATH: nothing to run the archive with.
    expect(shimCommand('bin\\composer.phar', { PATH: path.join(bin, 'empty') })).toBeNull();
  });
```

### 3. Sync the copy that generated repositories receive

Run:

```powershell
node scripts/packs-sync.mjs
```

### 4. Format and refresh the golden manifests

The sync changes the template pack's copy of `proc.mjs`, whose hash is recorded in each golden manifest. Run:

```powershell
pnpm exec prettier --write scripts/guard/lib/proc.mjs scripts/guard/guards.test.mjs
$env:INCUBATOR_GOLDEN_UPDATE = '1'; pnpm exec vitest run --project unit packages/templates/src/packs.test.ts; Remove-Item Env:INCUBATOR_GOLDEN_UPDATE
git --no-optional-locks status --short
```

The status lists `scripts/guard/lib/proc.mjs`, `scripts/guard/guards.test.mjs`, `packages/templates/packs/base/files/scripts/guard/lib/proc.mjs` and the ten files under `packages/templates/__golden__/`, and nothing else besides this plan.

## Touched files and markers

| File                                                             | Marker                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `scripts/guard/lib/proc.mjs`                                     | `export function shimCommand(target, env = process.env)`                  |
| `packages/templates/packs/base/files/scripts/guard/lib/proc.mjs` | `export function shimCommand(target, env = process.env)`                  |
| `scripts/guard/guards.test.mjs`                                  | `runs a shim that wraps a PHP archive with php, not with node (plan 061)` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit scripts/guard/guards.test.mjs scripts/dogfood.test.mjs packages/templates/src/packs.test.ts
(Select-String -SimpleMatch -Path scripts/guard/lib/proc.mjs "shimCommand(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 scripts packages/templates
pnpm check:quick
```

```text
guards.test.mjs, dogfood.test.mjs and packs.test.ts pass, including the new plan 061 test, the pack-copy equality check and all ten golden manifests
the Select-String count prints 2
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                         | Why                                                                                                                                    | Mechanical check                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fix is only in the repository's own copy, not in the copy generated repositories receive | `scripts/guard/lib/proc.mjs` is copied into `packages/templates/packs/base/files/` by `scripts/packs-sync.mjs`, and a stale copy ships | `scripts/dogfood.test.mjs` asserts the pack copies equal the repository (`scripts/packs-sync.mjs --check`) and is in the acceptance command; the manifest lists both files with the same marker |
| The golden manifests are not refreshed                                                       | each golden records the hash of the pack's `proc.mjs`, so every template combination test fails                                        | `packs.test.ts` is in the acceptance command and compares all ten                                                                                                                               |
| The test only runs on Windows                                                                | `which` reads a `.bat` shim only when `process.platform` is `win32`, and CI may be Linux                                               | the test calls `shimCommand`, which has no platform branch, with a fake `php` on a temporary PATH                                                                                               |
| A native or script shim changes behaviour                                                    | the old line returned the target itself for `.exe` and `.com`, and node for the rest                                                   | the test asserts both of those results unchanged                                                                                                                                                |
| The `.phar` rule matches too much                                                            | a target such as `x.phar.js` must still run with node                                                                                  | the pattern is anchored at the end of the name (`\.phar$`)                                                                                                                                      |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                     | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | The SessionStart hook's composer install failed in the COI Tracker run: the guard toolkit ran `composer.phar` with node                                                                                                                                                                                                                                     | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable): the guardrail that claimed the drift step catches a stale pack copy was wrong (it is scripts/dogfood.test.mjs), now corrected and in the acceptance run; trial apply passed typecheck, eslint and 64 tests, ten golden manifests refreshed; two mutants (the php branch and the .phar match) are killed | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): all 14 changed paths (the helper, its pack copy, the test and the ten golden manifests) are identical to the trial apply; the two mutants killed in round 2 are the same code; `pnpm check:quick` follows                                                                                                       | CLOSED |
| 4     | Found by `pnpm check:quick` (the abs-path guard), not by the targeted trial: the plan text and its test data held Windows drive paths. Fixed in the code review: the test data has no drive (the helper only reads the file extension) and the explanation names no machine path; a plan must run the full quick check before dispatch                      | CLOSED |
