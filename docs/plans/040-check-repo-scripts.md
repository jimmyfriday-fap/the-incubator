# Plan 040: a repository's own test scripts can be approved as checks, and the CI's are proposed

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 8 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** On a repository the Incubator did not build, the coding agent may run only the check commands the owner approved (ADR-025). The Incubator proposes built-in commands chosen by which files exist: for a Flutter repository, `flutter analyze` and `flutter test`. A real update run on a Flutter and Supabase repository (rolling-schedule) built a database migration, but its SQL tests could not be run. They run as `bash supabase/tests/run.sh` (local Docker, never the live project), and `bash` is a denied program, so the owner could not even approve it.

From now on:

1. **`bash` with a script.** `bash <relative path>.sh [arguments]` is an approvable check. The path must be relative, stay inside the repository, start with a letter, digit or `_`, and end in `.sh`. A bare `bash`, `bash -c …`, `bash /abs/x.sh` and `sh …` stay refused. `Bash(bash scripts/x.sh:*)` lets the agent run that one script with arguments. The script is repository code, like a test file `flutter test` already runs, and the owner still approves it.
2. **CI test scripts are proposed.** When a GitHub workflow has a step `run: bash <path>.sh` and that file exists, the Incubator proposes `bash <path>.sh`. Only the path is taken from the repository (threat T6: repository text otherwise never becomes a command), and it must pass the same rules. Only scripts whose path says they are tests (a `test` or `tests` folder or name) are proposed: `scripts/deploy.sh` is not. Live commands such as `supabase db push` are never proposed.

## Work items

### 1. Core: `bash` leaves the denied programs

In `packages/core/src/checks.ts`:

Find:

```text
const DENIED_PROGRAMS = new Set([
  'git',
  'sh',
  'bash',
  'zsh',
```

Replace with:

```text
const DENIED_PROGRAMS = new Set([
  'git',
  'sh',
  // plan 040: shells and wrappers that run whatever they are given (the Incubator now runs approved commands itself)
  'dash',
  'ash',
  'busybox',
  'wsl',
  'nohup',
  'timeout',
  'nice',
  'time',
  'setsid',
  'stdbuf',
  'command',
  'zsh',
```

### 2. Core: `bash` runs one script in the repository, nothing else

In `packages/core/src/checks.ts`:

Find:

```text
    if (DENIED_PROGRAMS.has(name))
      return add(i, `"${program}" is not a check command: it can run anything`);
```

Replace with:

```text
    if (DENIED_PROGRAMS.has(name))
      return add(i, `"${program}" is not a check command: it can run anything`);
    // ADR-025 amendment (plan 040): bash runs one script in the repository, never inline code.
    if (name === 'bash' && !/^[A-Za-z0-9_][A-Za-z0-9_./-]*\.sh$/.test(tokens[1] ?? ''))
      return add(
        i,
        '"bash" only runs a script in the repository, for example "bash scripts/test.sh"',
      );
```

### 3. Core test: the new rule

In `packages/core/src/checks.test.ts`:

Find:

```text
      ['bash', /can run anything/],
      ['sh run.sh', /can run anything/],
```

Replace with:

```text
      ['bash', /only runs a script in the repository/],
      ['bash -c x', /only runs a script in the repository/],
      ['bash script', /only runs a script in the repository/],
      ['bash ./run.sh', /only runs a script in the repository/],
      ['bash /etc/x.sh', /only runs a script in the repository/],
      ['bash ../x.sh', /may not leave the repository/],
      ['sh run.sh', /can run anything/],
      ['timeout 5 sh -c id', /can run anything/],
      ['nohup node scripts/x.mjs', /can run anything/],
      ['wsl bash x.sh', /can run anything/],
      ['busybox sh', /can run anything/],
```

Then, in the same file, find:

```text
      ['../bin/tool test', /may not leave the repository/],
```

Replace with:

```text
      ['../bin/tool test', /may not leave the repository/],
      ['bash.exe -c x', /only runs a script in the repository/],
```

Then, in the same file, find:

```text
  it('refuses anything that could run something else', () => {
```

Replace with:

```text
  it('accepts bash running one script in the repository, with arguments (plan 040)', () => {
    expect(
      validateChecks(['bash supabase/tests/run.sh', 'bash scripts/test.sh 051', 'bash x.sh']),
    ).toEqual([]);
    expect(externalTools(['bash supabase/tests/run.sh'])).toContain(
      'Bash(bash supabase/tests/run.sh:*)',
    );
  });

  it('refuses anything that could run something else', () => {
```

### 4. Analyzer: the plain-words description of a script check

In `packages/analyzer/src/checks.ts`:

Find:

```text
  [/^swift test$/, "Runs the project's automated tests."],
];
```

Replace with:

```text
  [/^swift test$/, "Runs the project's automated tests."],
  [/^bash \S+\.sh$/, 'Runs a test script from the repository.'],
];
```

### 5. Analyzer: propose the test scripts a GitHub workflow runs

In `packages/analyzer/src/checks.ts`:

Find:

```text
    default:
      break;
  }
  return out;
}
```

Replace with:

```text
    default:
      break;
  }
  // A test script a GitHub workflow runs with `bash <path>.sh` (plan 040): only the path comes from the
  // repository, only when that file exists and its path names a test, and it must have the shape ADR-025
  // allows; the owner approves it.
  const SCRIPT_STEP = /^\s*(?:-\s+)?run:\s*bash\s+(?:\.\/)?([A-Za-z0-9_][A-Za-z0-9_./-]*\.sh)\s*$/gm;
  // why: a workflow also runs deploy and release scripts; only a path that says it is a test is proposed.
  const TEST_SCRIPT = /(^|[/_.-])tests?([/_.-]|$)/i;
  for (const wf of view.glob('.github/workflows/*.{yml,yaml}')) {
    for (const m of (view.read(wf) ?? '').matchAll(SCRIPT_STEP)) {
      const script = m[1]!;
      if (!TEST_SCRIPT.test(script) || script.length > 100 || !view.has(script)) continue;
      const command = `bash ${script}`;
      if (!out.some((c) => c.command === command)) add(command, `${wf}: CI runs it`);
    }
  }
  return out;
}
```

### 5a. Analyzer: the docstring says what is now true

In `packages/analyzer/src/checks.ts`:

Find:

```text
 * are proposals for the owner to approve, never run by the Incubator itself.
```

Replace with:

```text
 * are proposals for the owner to approve; once approved, the Incubator runs them itself to verify the work (plan 041).
```

Then, in the same file, find:

```text
 * a command. A hostile `package.json` can at most make `npm run test` appear, and the owner still has
```

Replace with:

```text
 * a command, except (plan 040) the path of a test script that a workflow runs with `bash`. A hostile `package.json` can at most make `npm run test` appear, and the owner still has
```

### 6. Analyzer test: the proposal

In `packages/analyzer/src/analyzer.test.ts`:

Find:

```text
    expect(propose({ 'README.md': '# x\n' })).toEqual([]);
  });
```

Replace with:

```text
    expect(propose({ 'README.md': '# x\n' })).toEqual([]);
  });

  it('offers a test script a GitHub workflow runs with bash, and only when the file exists (plan 040)', () => {
    const workflow = [
      'jobs:',
      '  sql:',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - name: Migrations and SQL tests',
      '        run: bash supabase/tests/run.sh',
      '      - run: bash scripts/missing.sh',
      '      - run: bash ../outside.sh',
      '      - run: bash scripts/deploy.sh',
      '      - run: bash supabase/tests/live.sh --linked',
      '      # - run: bash supabase/tests/old.sh',
      '      - run: bash ./supabase/tests/run.sh',
      '      - run: supabase db push --yes',
      '      - run: bash supabase/tests/run.sh',
    ].join('\n');
    const view = viewFromFiles({
      'pubspec.yaml': 'name: x\n',
      '.github/workflows/test.yml': workflow,
      'supabase/tests/run.sh': '#!/usr/bin/env bash\n',
      'supabase/tests/live.sh': '#!/usr/bin/env bash\n',
      'supabase/tests/old.sh': '#!/usr/bin/env bash\n',
      'scripts/deploy.sh': '#!/usr/bin/env bash\n',
    });
    expect(proposeChecks(view, analyze(view))).toEqual([
      {
        command: 'dart analyze',
        what: 'Scans the Dart code for errors and style problems. It changes nothing.',
        why: 'pubspec.yaml: static analysis',
      },
      {
        command: 'bash supabase/tests/run.sh',
        what: 'Runs a test script from the repository.',
        why: '.github/workflows/test.yml: CI runs it',
      },
    ]);
  });
```

### 7. The decision record

In `docs/adr/025-owner-approved-check-commands.md`, append at the end of the file (after its last line, separated by one blank line):

```markdown
## Amendment (plan 040): a repository's own test scripts

- `bash <relative path>.sh [arguments]` is an approvable check: the path stays inside the repository, starts with a
  letter, digit or `_`, and ends in `.sh`. `bash` on its own, with a flag, or with an absolute path stays refused, and
  `sh` stays denied. The script is repository code, like the test files `flutter test` already runs; the owner still
  approves it. The agent can edit that script like any file, so approving it trusts what the agent writes there, as
  `flutter test` trusts the tests it writes.
- The Incubator proposes `bash <path>.sh` when a GitHub workflow runs exactly that, the file exists and its path names a
  test (a `test` or `tests` folder or file name); deploy and release scripts are not proposed. Only the path comes from
  the repository (threat T6); this is the one exception to decision 2. Commands that change live systems, such as `supabase db push`, are never
  proposed; they stay the owner's to run.
- Plan 041 lets the Incubator itself run the approved commands after the agent stops, to verify the work.
```

### 8. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/checks.ts packages/core/src/checks.test.ts packages/analyzer/src/checks.ts packages/analyzer/src/analyzer.test.ts docs/adr/025-owner-approved-check-commands.md
```

## Touched files and markers

| File                                            | Marker                                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/core/src/checks.ts`                   | `ADR-025 amendment (plan 040): bash runs one script in the repository, never inline code.`        |
| `packages/core/src/checks.test.ts`              | `accepts bash running one script in the repository, with arguments (plan 040)`                    |
| `packages/analyzer/src/checks.ts`               | `Runs a test script from the repository.`                                                         |
| `packages/analyzer/src/analyzer.test.ts`        | `offers a test script a GitHub workflow runs with bash, and only when the file exists (plan 040)` |
| `packages/analyzer/src/checks.ts` (docstring)   | `except (plan 040) the path of a test script that a workflow runs with`                           |
| `docs/adr/025-owner-approved-check-commands.md` | `## Amendment (plan 040): a repository's own test scripts`                                        |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/checks.test.ts packages/analyzer/src/analyzer.test.ts
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core packages/analyzer
pnpm check:quick
```

```text
the unit tests pass, including "accepts bash running one script in the repository, with arguments (plan 040)" and "offers a test script a GitHub workflow runs with bash, and only when the file exists (plan 040)"
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                 | Why                                                                | Mechanical check                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `bash` becomes a free shell                                          | removing it from the denied list without the script rule           | the refusal table expects `bash`, `bash -c x`, `bash ./run.sh`, `bash /etc/x.sh` and `bash.exe -c x` refused                      |
| A wrapper runs a shell or another program                            | `timeout 5 sh -c id` passed the old rules (a reviewer measured it) | the refusal table expects `timeout`, `nohup`, `wsl` and `busybox` refused with "can run anything"                                 |
| `sh` is allowed by accident                                          | the edit touches the same list                                     | the table still expects `sh run.sh` refused with "can run anything"                                                               |
| A CI line other than `bash <script>.sh` becomes a proposal           | threat T6                                                          | the analyzer test has `supabase db push --yes` in the workflow and expects it absent                                              |
| A script that does not exist, or outside the repository, is proposed | the regex alone allows any path                                    | the test has `scripts/missing.sh` and `../outside.sh` and expects neither                                                         |
| A deploy script is proposed as a test                                | a workflow runs many scripts with `bash`                           | the test workflow runs `scripts/deploy.sh` and `supabase/tests/live.sh --linked` and expects neither                              |
| A commented-out step or `bash ./x.sh` is mishandled                  | the line regex decides                                             | the test has `# - run: bash supabase/tests/old.sh` (absent) and `bash ./supabase/tests/run.sh` (deduplicated with the plain form) |
| The same script is proposed twice                                    | two jobs may run it                                                | the test workflow runs it twice and expects one proposal                                                                          |

## Review rounds

| Round | Finding                                                                                                                 | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | A real update run could not run the repository's SQL tests: `bash` was denied, and only built-in commands were proposed | CLOSED |
