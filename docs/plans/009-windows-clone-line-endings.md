# Plan 009: clones must not depend on the user's `core.autocrlf`

## Executor preamble

Work in the repository root (the directory that holds `package.json`). Every path below is relative to it.
Output only code and file edits. Write no commentary into files. Do not commit, push, or change branches.
Do not run `pnpm contracts:pin`, edit `security/accepted-risks.json`, or touch any file not listed in the
manifest. Never spawn a subprocess through a shell.

**The defect.** `git clone` honours the user's `core.autocrlf`. Git for Windows ships it as `true`, so
the Incubator's workspace clone of a repository gets CRLF files while the freshly rendered tree has LF.
Every byte comparison then says "different", so `adopt` and `enhance` report identical files as
`proposed`, and the "already compliant" and "nothing to change" results never happen. The proof is the
unit test `enhance is a no-op when this plan was already delivered on the same day` in
`packages/core/src/enhance.test.ts`: it fails on Windows and passes with `GIT_CONFIG_NOSYSTEM=1`.

**The fix.** One place creates every clone: `clone` in `packages/git/src/gitops.ts`. Make that clone
write files exactly as stored (`core.autocrlf=false`) and persist the setting into the clone's own
config. Add one unit test that checks the persisted setting, so it fails on every OS, not only Windows.

**Out of scope (the owner does these by hand; do not attempt them):** applying
`docs/phases/phase-7-spec-1.1.patch` and `pnpm contracts:pin`; the OS keychain, default-browser and
installer checks; live GitHub and Leantime; merging or pushing.

### Micro-task 1: change `clone`

File: `packages/git/src/gitops.ts`, method `clone` on the object returned by `createGitOps`. Replace the
argv array so `-c core.autocrlf=false` comes right after `'-q'`. The call becomes exactly:

```ts
    async clone(remote, dir, opts = {}) {
      await git(
        [
          'clone',
          '-q',
          '-c',
          'core.autocrlf=false',
          ...(opts.depth ? ['--depth', String(opts.depth)] : []),
          remote,
          dir,
        ],
        {
          env: tokenEnv(opts.token),
        },
      );
    },
```

Change nothing else in the file. Do not add a new function, import or option.

### Micro-task 2: add the unit test

File: `packages/git/src/gitops.test.ts`.

1. In the first import line change `import { mkdtempSync, writeFileSync } from 'node:fs';` to
   `import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';`.
2. Inside `describe('GitOps', () => { ... })`, directly after the test that starts
   `it('commits deterministically, marks executables and pushes to a bare remote'` and ends before
   `it('puts the token in the environment`, insert exactly this test:

```ts
it('clones with core.autocrlf=false so a user setting cannot rewrite line endings', async () => {
  const src = tmp('gitops-eol-src-');
  writeFileSync(path.join(src, 'a.txt'), 'one\ntwo\n');
  await git.init(src);
  await git.addAll(src);
  await git.commit(src, 'chore: eol', ident);
  const dst = path.join(tmp('gitops-eol-dst-'), 'clone');
  await git.clone(src, dst);
  const cfg = await nodeExec.run('git', ['config', '--local', 'core.autocrlf'], {
    cwd: dst,
    timeoutMs: 10_000,
  });
  expect(cfg.stdout.trim()).toBe('false');
  expect(readFileSync(path.join(dst, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
});
```

Assume `nodeExec`, `git`, `ident`, `tmp` and `path` already exist in that file (they do). Do not stub anything.

### Micro-task 3: format and verify

The test above is shown without its two-space indent; it sits inside `describe`. Run
`pnpm exec prettier --write packages/git/src/gitops.ts packages/git/src/gitops.test.ts` first, then run
the acceptance commands below in order. If any command fails, stop and report the exact output; do not
change other files to make it pass.

## Touched files and markers

| File or directory                              | Marker / note                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/git/src/gitops.ts`                   | `core.autocrlf=false` (inside the `clone` argv)                                 |
| `packages/git/src/gitops.test.ts`              | `clones with core.autocrlf=false so a user setting cannot rewrite line endings` |
| `docs/plans/009-windows-clone-line-endings.md` | this plan; written before execution, not part of the run                        |

## Acceptance commands

```sh
pnpm exec vitest run packages/git/src/gitops.test.ts
pnpm exec vitest run packages/core/src/enhance.test.ts -t "already delivered"
pnpm check:quick
```

```text
gitops.test.ts: the new test and the existing tests pass
enhance.test.ts: "is a no-op when this plan was already delivered on the same day" passes with the machine's default git config (do NOT set GIT_CONFIG_NOSYSTEM)
check:quick: exit 0 under Node 22 (the node22 folder first on PATH)
```

## Drift and hallucination guardrails

| Trap                                                             | Why                                                                                         | Mechanical check                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| The test passes on Linux and macOS but proves nothing            | Those machines default to `core.autocrlf` unset, so CRLF never appears                      | The test asserts the persisted `core.autocrlf` value `false`, which is absent without the fix on any OS                               |
| The fix is applied with `git -c ... clone` instead of `clone -c` | The global form is not written into the workspace repo's config, so later checkouts regress | `grep -n "'core.autocrlf=false'" packages/git/src/gitops.ts` prints exactly one line, inside `clone`; the test reads `--local` config |
| A second clone site is missed                                    | Phase 7 added more engine paths                                                             | `grep -rn "'clone'" packages apps --include=*.ts` outside tests shows only `gitops.ts` and the `testing.ts` method-name list          |
| `.gitattributes` is edited to "fix" line endings                 | The repo already pins `* text=auto eol=lf`; the defect is in the user's clone               | `git diff --name-only` lists exactly the two code files                                                                               |
| The enhance test is edited or skipped to go green                | CLAUDE.md forbids deleting, skipping or weakening tests                                     | `git diff --stat packages/core/src/enhance.test.ts` is empty                                                                          |
| Absolute machine paths or a shell spawn slip into new code       | Guards `abs-path` and the `Exec` rule                                                       | `pnpm check:quick` runs the `abs-path` guard and lint                                                                                 |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Plan drafted from the failing phase 7 test on Windows                                                                                                                                                                                  | CLOSED |
| 2     | Opus review: format step not in acceptance; ambiguous `'-c'` grep (also matches the commit call)                                                                                                                                       | CLOSED |
| 3     | Opus review of the run: `core.autocrlf=false` alone still gives CRLF on Windows for a repo whose `.gitattributes` says `* text=auto` (`core.eol` defaults to native); `clone` now also passes `-c core.eol=lf` and the test asserts it | CLOSED |
