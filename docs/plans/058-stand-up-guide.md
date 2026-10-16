# Plan 058: the engine writes a stand-up guide for a finished run, as an executor plan a small model can follow

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 5 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 057. Before you start, check that `packages/core/src/what-now.ts` contains `export function whatNow(` and that `packages/core/src/engine.ts` contains `private whatNowFor(`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" item writes a new file with exactly the content shown.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A run that finished before plan 057 has no WHAT-NOW.md, and even with one the operator still has to work out the commands to stand the project up. After the COI Tracker run the operator could not tell whether the result was a WordPress plugin or a web app, nor how to run it. This plan adds a second document for any finished run with a project folder: a step-by-step stand-up guide, written in the executor-plan shape (preamble, numbered work items with a literal command and an expected result, touched files and markers, acceptance commands, drift guardrails) so that a small model such as Haiku 4.5 can execute it in the project's own repository. The guide is also saved in the repository as a plan, so it passes the generated repository's own plan-lint.

After this plan, `Engine.standUpGuide(runId)` returns `{ fileName, markdown }` for a finished run that has a folder, writes the same file under the run's own directory (`<run>/guide/`), and journals `guide.written`. It never writes into the project folder: an untracked file there would make "Continue coding" refuse with `dirty_tree`. It is built from plan 057's guide (what the project is, what was built, where it stands) plus the literal commands for the project's stack pack. A stack the Incubator has no commands for gets no executable steps: the guide lists the README's Getting started lines for a person to follow.

The web route and the run page button are plan 059.

## Work items

### 1. The builder

Create `packages/core/src/standup.ts` with exactly this content:

````ts
import type { IncubatorSpec } from '@incubator/spec';
import { snake } from '@incubator/templates';
import type { WhatNow } from './what-now.js';

/** One literal step of the stand-up guide. */
export interface StandUpStep {
  title: string;
  /** One PowerShell command, run from the repository root. */
  command: string;
  /** What the output must show, in words the executor can compare. */
  expect: string;
  /** A text the rendered README must contain for this step (the drift test); empty when the README has none. */
  source: string;
}

/** What the guide is built from. */
export interface StandUpFacts {
  runId: string;
  name: string;
  slug: string;
  pack: string;
  platform: IncubatorSpec['platform'];
  /** Plan 057's guide for the same run. */
  guide: WhatNow;
}

/** The guide: the file name and its markdown. */
export interface StandUp {
  fileName: string;
  markdown: string;
}

const check = (title: string, command: string, expect: string): StandUpStep => ({
  title,
  command,
  expect,
  source: '',
});

const NODE = check('Check Node', 'node -v', 'Starts with `v22`.');
const DOCKER = [
  check('Check Docker is installed', 'docker --version', 'Starts with `Docker version`.'),
  check(
    'Check Docker is running',
    'docker info --format "{{.ServerVersion}}"',
    'A version number. If it prints an error instead, stop and report that Docker Desktop must be started.',
  ),
];
const COPY_ENV: StandUpStep = {
  title: 'Create the local settings file',
  command: 'if (-not (Test-Path .env)) { Copy-Item .env.example .env }',
  expect: 'No output. The file `.env` exists afterwards.',
  source: 'Copy `.env.example` to `.env`',
};
const CHECK_QUICK: StandUpStep = {
  title: "Run the project's own quick check",
  command: 'node scripts/check.mjs quick',
  expect:
    'The last line is `exit 0`. If it is `exit 2`, copy every line that starts with `✖` into your report and carry on: do not fix any code.',
  source: '',
};

/** The executable steps for the project's stack pack, in order. Empty for a stack with no known commands. */
export function standUpSteps(f: StandUpFacts): StandUpStep[] {
  const snakeName = snake(f.slug);
  if (f.pack === 'wordpress') {
    const theme = f.platform === 'wordpress-theme';
    const install = `docker compose run --rm cli wp core install --url=http://localhost:8080 --title=${f.slug} --admin_user=admin --admin_email=admin@example.test --skip-email`;
    return [
      check('Check PHP', 'php -v', 'Starts with `PHP 8.`.'),
      check('Check Composer', 'composer --version', 'Starts with `Composer version 2`.'),
      NODE,
      ...DOCKER,
      {
        title: 'Install the PHP dependencies',
        command: 'composer install --no-interaction',
        expect: 'The output ends with `Generating autoload files` and the folder `vendor/` exists.',
        source: 'composer install',
      },
      COPY_ENV,
      {
        title: 'Start WordPress and the database',
        command: 'docker compose up -d --wait',
        expect:
          'The command exits 0 (`$LASTEXITCODE` is 0) and the last lines say the `db` and `wordpress` containers are `Healthy` or `Started`.',
        source: 'docker compose up -d --wait',
      },
      {
        title: 'Install WordPress',
        command: install,
        expect:
          'The output contains `Success: WordPress installed successfully.` and a line starting `Admin password:`: copy that line into your report. If it says `WordPress is already installed`, that is fine: carry on.',
        source: install,
      },
      check(
        theme ? 'Activate the theme' : 'Activate the plugin',
        `docker compose run --rm cli wp ${theme ? 'theme' : 'plugin'} activate ${f.slug}`,
        'The output starts with `Success:`.',
      ),
      check(
        'Ask the health route',
        `Invoke-RestMethod -Uri "http://localhost:8080/?rest_route=/${f.slug}/v1/health" | ConvertTo-Json -Compress`,
        'The output contains `"status":"ok"`.',
      ),
      CHECK_QUICK,
    ];
  }
  if (f.pack === 'node-web') {
    return [
      NODE,
      { ...check('Enable pnpm', 'corepack enable', 'No output.'), source: 'corepack enable' },
      check('Check pnpm', 'pnpm --version', 'A version number.'),
      ...DOCKER,
      {
        title: 'Install the packages',
        command: 'pnpm install',
        expect: 'The output contains `Done` and the folder `node_modules/` exists.',
        source: 'pnpm install',
      },
      COPY_ENV,
      {
        title: 'Start the database',
        command: 'docker compose up -d db',
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0).',
        source: 'docker compose up -d db',
      },
      {
        title: 'Create the database tables',
        command: 'pnpm db:bootstrap',
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0).',
        source: 'pnpm db:bootstrap',
      },
      CHECK_QUICK,
    ];
  }
  if (f.pack === 'python-service') {
    const boot = `uv run python -m ${snakeName}.db`;
    return [
      check('Check uv', 'uv --version', 'Starts with `uv `.'),
      NODE,
      ...DOCKER,
      {
        title: 'Install the Python packages',
        command: 'uv sync',
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0) and the folder `.venv/` exists.',
        source: 'uv sync',
      },
      COPY_ENV,
      {
        title: 'Start the database',
        command: 'docker compose up -d db',
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0).',
        source: 'docker compose up -d db',
      },
      {
        title: 'Create the database tables',
        command: boot,
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0).',
        source: boot,
      },
      CHECK_QUICK,
    ];
  }
  if (f.pack === 'node-lib') {
    return [
      NODE,
      { ...check('Enable pnpm', 'corepack enable', 'No output.'), source: 'corepack enable' },
      {
        title: 'Install the packages',
        command: 'pnpm install',
        expect: 'The output contains `Done` and the folder `node_modules/` exists.',
        source: 'pnpm install',
      },
      {
        title: 'Build the library',
        command: 'pnpm build',
        expect: 'The command exits 0 (`$LASTEXITCODE` is 0) and the folder `dist/` exists.',
        source: 'pnpm build',
      },
      ...(f.platform === 'cli'
        ? [
            {
              ...check('Run the built command', 'node dist/bin.js --help', 'Prints a usage text.'),
              source: 'node dist/bin.js --help',
            },
          ]
        : []),
      CHECK_QUICK,
    ];
  }
  return [];
}

/** What a person does once the executor is done: the programs that run until stopped, and how to stop them. */
function operatorSteps(f: StandUpFacts): string[] {
  const snakeName = snake(f.slug);
  if (f.pack === 'wordpress')
    return [
      'Open http://localhost:8080/wp-admin and sign in as `admin` with the password the install step printed. The project is listed as active under ' +
        (f.platform === 'wordpress-theme' ? 'Appearance, Themes.' : 'Plugins.'),
      'Stop it with `docker compose down` (add `-v` to also delete the data).',
    ];
  if (f.pack === 'node-web')
    return [
      'Run `pnpm dev` in one terminal for the API on port 3000 and `pnpm dev:web` in another for the UI at http://localhost:5173. Stop each with Ctrl+C.',
      'Stop the database with `docker compose down`.',
    ];
  if (f.pack === 'python-service')
    return [
      `Run \`uv run python -m ${snakeName}\` for the API on port 8000. Stop it with Ctrl+C.`,
      'Stop the database with `docker compose down`.',
    ];
  if (f.pack === 'node-lib') return ['A library has nothing to keep running.'];
  return [];
}

/** The files the executor creates, each with a text that must be in it. */
function touched(f: StandUpFacts, steps: StandUpStep[]): [string, string][] {
  const rows: [string, string][] = [];
  if (steps.some((s) => s === COPY_ENV)) rows.push(['.env', 'APP_ENV=']);
  if (f.pack === 'wordpress') rows.push(['vendor/autoload.php', 'ComposerAutoloaderInit']);
  if (f.pack === 'node-web' || f.pack === 'node-lib')
    rows.push(['node_modules/.modules.yaml', 'pnpm']);
  if (f.pack === 'python-service') rows.push(['.venv/pyvenv.cfg', 'home = ']);
  if (rows.length === 0) rows.push(['(none)', 'This stack has no executable steps']);
  return rows;
}

/** Backslash-escapes the characters markdown would read as formatting in text that came from the spec or a ticket. */
function esc(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

/** A markdown table with every column padded to its widest cell, the layout prettier writes. */
function table(header: string[], rows: string[][]): string[] {
  const widths = header.map((h, i) => Math.max(h.length, 3, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map((r) => line(r)),
  ];
}

/** The guide as markdown in the executor-plan shape. */
export function standUpMarkdown(f: StandUpFacts, steps: StandUpStep[]): string {
  const g = f.guide;
  const work =
    steps.length > 0
      ? steps.flatMap((s, i) => [
          `### ${i + 1}. ${s.title}`,
          '',
          'Run:',
          '',
          '```powershell',
          s.command,
          '```',
          '',
          `Expected: ${s.expect}`,
          '',
        ])
      : [
          'This stack has no automated stand-up. Follow these steps by hand:',
          '',
          ...g.run.map((l, i) => `${i + 1}. ${l}`),
          '',
        ];
  const operator = operatorSteps(f);
  // why: the check that proves the project answers is the last step before the quick check (the health route for WordPress).
  const verify = steps.findLast((s) => s !== CHECK_QUICK);
  const acceptance = [
    verify ? verify.command : 'node scripts/check.mjs quick',
    'git status --short',
  ];
  return [
    `# Stand-up guide: ${esc(f.name)}`,
    '',
    `Written by the Incubator from run \`${f.runId}\`. It is a plan for a coding assistant: do the work items in order, in this repository, and report what each one printed.`,
    '',
    '## What this project is',
    '',
    ...g.about.map((l) => `- ${esc(l)}`),
    '',
    ...(g.built.length > 0
      ? [
          '## What was built',
          '',
          ...g.built.map((t) => `- **${t.state}**: \`${t.id}\`, ${esc(t.title)}`),
          '',
        ]
      : []),
    '## How to put it into use',
    '',
    ...g.install.map((l) => `- ${l}`),
    '',
    '## Executor preamble',
    '',
    'You are standing this project up on a developer machine and checking that it answers. Rules:',
    '',
    '- Work in PowerShell, from the root of this repository. Every path in this plan is relative to that root.',
    '- Do the work items in order. After each one, compare what it printed with its Expected text. If it differs, stop and report the item number and the output: do not try another way.',
    '- Do not edit, format, delete, commit or push any file that git tracks. The only things you create are the local settings file `.env` and folders git ignores, such as `vendor/`, `node_modules/` and `.venv/`.',
    '- Do not fix failing code. The project may not be finished: a failing quick check is a finding to report, not a task.',
    '- Output only what the work items ask for, then a final report in plain words: each item with pass or fail, and anything an item told you to copy.',
    '',
    '## Work items',
    '',
    ...work,
    ...(operator.length > 0
      ? [
          '## Operator steps',
          '',
          'These are for a person, not the executor: they run until stopped.',
          '',
          ...operator.map((l) => `- ${l}`),
          '',
        ]
      : []),
    '## Touched files and markers',
    '',
    ...table(
      ['File', 'Marker'],
      touched(f, steps).map(([p, m]) => [`\`${p}\``, `\`${m}\``]),
    ),
    '',
    '## Acceptance commands',
    '',
    '```powershell',
    ...acceptance,
    '```',
    '',
    '```text',
    verify
      ? verify.expect
      : 'The last line is `exit 0`, or `exit 2` with the failing steps listed in your report.',
    'git status --short prints nothing, or only an untracked lock file such as `?? composer.lock`.',
    '```',
    '',
    '## Drift and hallucination guardrails',
    '',
    ...table(
      ['Trap', 'Why', 'Mechanical check'],
      [
        [
          'A step prints something other than Expected and the work carries on',
          'later steps then fail for a reason that is not the real one',
          'stop at the first difference and report the item number and its output',
        ],
        [
          'A tracked file gets edited, or code gets fixed',
          'the guide only needs the tools; edits would be mixed into real work',
          '`git status --short` prints nothing, or only an untracked lock file',
        ],
        [
          'Docker is installed but not running',
          'every compose step fails with a message that hides the cause',
          'the Docker running check comes before any compose step',
        ],
      ],
    ),
    '',
    '## Review rounds',
    '',
    ...table(
      ['Round', 'Finding', 'Status'],
      [['1', `Generated by the Incubator from run ${f.runId}; not yet reviewed`, 'FIX-FIRST']],
    ),
    '',
    '## What to do after it runs',
    '',
    ...g.next.map((l, i) => `${i + 1}. ${esc(l)}`),
    '',
  ].join('\n');
}

/** The stand-up guide for a run: the file name and the markdown. */
export function standUp(f: StandUpFacts): StandUp {
  return { fileName: `STAND-UP-${f.slug}.md`, markdown: standUpMarkdown(f, standUpSteps(f)) };
}
````

### 2. The engine

In `packages/core/src/engine.ts`:

Find:

```text
  type WhatNow,
} from './what-now.js';
```

Replace with:

```text
  type WhatNow,
} from './what-now.js';
import { standUp, type StandUp } from './standup.js';
```

Find:

```text
  /** The subject of the drafted commit: the one request, the count of requests, or the new project. */
```

Replace with:

```text
  /**
   * Plan 058: the stand-up guide for a finished run that has a project folder: what was built and the literal steps
   * to stand it up, as an executor plan. Written under the run's own directory, never into the project folder (an
   * untracked file there would make "continue coding" refuse with dirty_tree).
   */
  async standUpGuide(runId: string): Promise<StandUp> {
    const s = this.state(runId);
    if (!s.input.dir)
      throw new PolicyError(`run ${runId} has no project folder`, { code: 'no_folder' });
    if (!s.done || s.cancelled)
      throw new PolicyError(`run ${runId} is not finished`, { code: 'not_finished' });
    const guide = (await this.finishDetail(runId))?.whatNow;
    if (!guide)
      throw new PolicyError(`run ${runId} has no coding stage to describe`, { code: 'no_guide' });
    const spec = this.approvedSpec(runId);
    const out = standUp({
      runId,
      name: spec.project.name,
      slug: spec.project.slug,
      pack: spec.stack.pack,
      platform: spec.platform,
      guide,
    });
    const dir = path.join(this.deps.store.runDir(runId), 'guide');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, out.fileName), out.markdown);
    this.record(runId, 'guide.written', { file: out.fileName });
    return out;
  }

  /** The subject of the drafted commit: the one request, the count of requests, or the new project. */
```

### 3. Unit tests

Create `packages/core/src/standup.test.ts` with exactly this content:

```ts
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import { render, writeTree } from '@incubator/templates';
import { completeSpec } from '@incubator/spec';
import { standUp, standUpSteps, type StandUpFacts } from './standup.js';
import { readGettingStarted, whatNow, type WhatNowFacts } from './what-now.js';

const combos = path.resolve(import.meta.dirname, '../../templates/fixtures/combos');

const guideFacts = (over: Partial<WhatNowFacts> = {}): WhatNowFacts => ({
  runId: '20261015-030815-taltpt',
  name: 'COI Tracker',
  slug: 'coi-tracker',
  description: 'Tracks subcontractor insurance certificates for general contractors.',
  platform: 'wordpress-plugin',
  pack: 'wordpress',
  gettingStarted: ['Install PHP 8.3 with Composer 2, then run `composer install`.'],
  deployTarget: 'docker-host',
  branch: 'incubator/build-20261015',
  verdict: 'parked',
  setup: null,
  tickets: [{ id: 'F-sub-roster', title: 'Subcontractor roster', state: 'READY_FOR_TEST' }],
  warnings: [],
  pr: null,
  ...over,
});

const facts = (over: Partial<StandUpFacts> = {}): StandUpFacts => ({
  runId: '20261015-030815-taltpt',
  name: 'COI Tracker',
  slug: 'coi-tracker',
  pack: 'wordpress',
  platform: 'wordpress-plugin',
  guide: whatNow(guideFacts()),
  ...over,
});

describe('the stand-up guide (plan 058)', () => {
  it('lists every command of a WordPress plugin in order, with the slug put in', () => {
    expect(standUpSteps(facts()).map((s) => s.command)).toEqual([
      'php -v',
      'composer --version',
      'node -v',
      'docker --version',
      'docker info --format "{{.ServerVersion}}"',
      'composer install --no-interaction',
      'if (-not (Test-Path .env)) { Copy-Item .env.example .env }',
      'docker compose up -d --wait',
      'docker compose run --rm cli wp core install --url=http://localhost:8080 --title=coi-tracker --admin_user=admin --admin_email=admin@example.test --skip-email',
      'docker compose run --rm cli wp plugin activate coi-tracker',
      'Invoke-RestMethod -Uri "http://localhost:8080/?rest_route=/coi-tracker/v1/health" | ConvertTo-Json -Compress',
      'node scripts/check.mjs quick',
    ]);
  });

  it('activates a theme as a theme', () => {
    const steps = standUpSteps(facts({ platform: 'wordpress-theme' }));
    expect(
      steps.some((s) => s.command === 'docker compose run --rm cli wp theme activate coi-tracker'),
    ).toBe(true);
    expect(steps.some((s) => s.command.includes('wp plugin activate'))).toBe(false);
  });

  it('has steps for the other stacks and none for a stack it does not know', () => {
    const lib = standUpSteps(facts({ pack: 'node-lib', platform: 'library' })).map(
      (s) => s.command,
    );
    expect(lib).toContain('pnpm build');
    expect(lib).not.toContain('node dist/bin.js --help');
    expect(
      standUpSteps(facts({ pack: 'node-lib', platform: 'cli' })).map((s) => s.command),
    ).toContain('node dist/bin.js --help');
    expect(
      standUpSteps(facts({ pack: 'node-web', platform: 'web' })).map((s) => s.command),
    ).toContain('pnpm db:bootstrap');
    expect(
      standUpSteps(facts({ pack: 'python-service', platform: 'service' })).map((s) => s.command),
    ).toContain('uv run python -m coi_tracker.db');
    expect(standUpSteps(facts({ pack: 'flutter', platform: 'other' }))).toEqual([]);
    const md = standUp(facts({ pack: 'flutter', platform: 'other' })).markdown;
    expect(md).toContain('This stack has no automated stand-up. Follow these steps by hand:');
    expect(md).toContain('1. Install PHP 8.3 with Composer 2, then run `composer install`.');
  });

  it('says what the project is and has the five sections a generated repository checks in a plan', () => {
    const g = standUp(facts());
    expect(g.fileName).toBe('STAND-UP-coi-tracker.md');
    expect(g.markdown.startsWith('# Stand-up guide: COI Tracker\n')).toBe(true);
    expect(g.markdown).toContain('What it is: a WordPress plugin');
    for (const h of [
      '## Executor preamble',
      '## Work items',
      '## Touched files and markers',
      '## Acceptance commands',
      '## Drift and hallucination guardrails',
      '## Review rounds',
    ])
      expect(g.markdown).toContain(`\n${h}\n`);
    expect(g.markdown).toContain('| `.env`');
    expect(g.markdown).toContain('| FIX-FIRST |');
    expect(g.markdown).toContain('### 10. Activate the plugin');
  });

  it("passes the plan-lint a generated repository runs on its docs/plans (the pack's own copy)", async () => {
    const lint = path.resolve(
      import.meta.dirname,
      '../../templates/packs/base/files/scripts/guard/plan-lint.mjs',
    );
    // why: a computed specifier, so the type checker does not need declarations for a .mjs file.
    const { lintPlan } = (await import(pathToFileURL(lint).href)) as {
      lintPlan: (file: string, text: string) => string[];
    };
    for (const over of [
      {},
      { pack: 'node-web', platform: 'web' as const },
      { pack: 'flutter', platform: 'other' as const },
    ])
      expect(lintPlan('docs/plans/001-stand-up.md', standUp(facts(over)).markdown)).toEqual([]);
  });

  it('is written so prettier leaves it unchanged', async () => {
    for (const over of [
      {},
      { pack: 'node-web', platform: 'web' as const },
      { pack: 'flutter', platform: 'other' as const },
    ]) {
      const md = standUp(facts(over)).markdown;
      expect(await format(md, { parser: 'markdown', printWidth: 100, proseWrap: 'preserve' })).toBe(
        md,
      );
    }
  });

  it('only uses commands the rendered README of each stack contains', async () => {
    for (const name of [
      'node-lib.in-repo.package-release',
      'node-web.in-repo.docker-host',
      'python-service.in-repo.vps-tailscale',
      'wordpress-plugin.in-repo.vps-tailscale',
      'wordpress-theme.in-repo.docker-host',
    ]) {
      const { spec } = completeSpec(
        JSON.parse(readFileSync(path.join(combos, `${name}.json`), 'utf8')) as never,
      );
      const dir = path.join(mkdtempSync(path.join(os.tmpdir(), 'stand up ')), 'repo');
      writeTree(await render(spec), dir, { mode: 'fresh' });
      const readme = readGettingStarted(dir).join('\n');
      const steps = standUpSteps({
        runId: 'r',
        name: spec.project.name,
        slug: spec.project.slug,
        pack: spec.stack.pack,
        platform: spec.platform,
        guide: whatNow(guideFacts()),
      });
      expect(steps.length, name).toBeGreaterThan(0);
      for (const s of steps.filter((x) => x.source !== ''))
        expect(readme, `${name}: ${s.title}`).toContain(s.source);
    }
  });
});
```

### 4. The engine test

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
  it('commits WHAT-NOW.md with the work and shows the same guide once the run is done (plan 057)', async () => {
```

Replace with:

```text
  it('writes the stand-up guide for a finished run outside the project folder, and refuses an unfinished one (plan 058)', async () => {
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    await expect(h.engine.standUpGuide(runId)).rejects.toMatchObject({ code: 'not_finished' });
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    await h.engine.resume(runId, new DefaultsPrompter());
    h.engine.submitPush(runId, 'push');
    expect((await h.engine.resume(runId, new DefaultsPrompter())).done).toBe(true);
    const g = await h.engine.standUpGuide(runId);
    expect(g.fileName).toBe('STAND-UP-tallyho.md');
    expect(g.markdown).toContain('# Stand-up guide: Tallyho');
    expect(g.markdown).toContain('pnpm build');
    expect(readFileSync(path.join(h.store.runDir(runId), 'guide', g.fileName), 'utf8')).toBe(
      g.markdown,
    );
    // The project folder is untouched: continue coding still works.
    expect(await out(['status', '--porcelain'], dir)).toBe('');
    expect(existsSync(path.join(dir, g.fileName))).toBe(false);
    expect(h.engine.entries(runId).some((e) => e.type === 'guide.written')).toBe(true);
  });

  it('commits WHAT-NOW.md with the work and shows the same guide once the run is done (plan 057)', async () => {
```

### 5. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/standup.ts packages/core/src/standup.test.ts packages/core/src/engine.ts packages/core/src/folder-runs.test.ts
```

## Touched files and markers

| File                                    | Marker                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `packages/core/src/standup.ts`          | `export function standUpSteps(f: StandUpFacts)`                           |
| `packages/core/src/engine.ts`           | `async standUpGuide(runId: string): Promise<StandUp>`                     |
| `packages/core/src/standup.test.ts`     | `describe('the stand-up guide (plan 058)'`                                |
| `packages/core/src/folder-runs.test.ts` | `writes the stand-up guide for a finished run outside the project folder` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/standup.test.ts packages/core/src/folder-runs.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "standUpGuide(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core
pnpm check:quick
```

```text
standup.test.ts and folder-runs.test.ts pass, including the new plan 058 tests
the Select-String count prints 1
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                            | Why                                                                                       | Mechanical check                                                                                                       |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A command in the guide drifts from what the stack's README says | the stack packs own the README text and can change it                                     | the drift test renders five stacks and fails when a step's `source` is not in the rendered Getting started block       |
| The guide is written into the project folder                    | an untracked file there makes Continue coding refuse (`dirty_tree`)                       | the engine test asserts `git status --porcelain` is empty and the file is absent from the folder                       |
| The guide is not a valid plan in the generated repository       | the generated repository's plan-lint wants five sections and a status on every review row | the unit test runs the template pack's own `plan-lint.mjs` (`lintPlan`) on three guides and expects no findings        |
| Prettier would rewrite the markdown                             | a generated Node repository checks the format of every file                               | the unit test formats three guides with prettier and expects them unchanged                                            |
| An unfinished run gets a guide of half-known facts              | the commit, pull request and ticket lines only exist at the end                           | the engine test expects `not_finished` before the run is done                                                          |
| The engine method is written but nothing calls it               | an unused method still type-checks                                                        | plan 059 adds the route and the button; until then the engine test is the caller, and the Select-String count prints 1 |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Operator request after a real run (COI Tracker): a way to produce, for a finished run, one document of what it built and the literal steps to stand it up, that a small model can execute                                                                                                                                                                                                                                                                             | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable): the guide is now checked by the template pack's own plan-lint, by prettier, and against the rendered README of five stacks; the acceptance command is the health route rather than the quick check; trial apply passed typecheck, eslint, 7 unit tests and the engine test; four mutants (unfinished-run check, writing into the project folder, plugin vs theme activation, a README source text) are all killed | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): both new files and every tracked-file change are identical to the trial apply; the four mutants killed in round 2 are the same code; `pnpm check:quick` follows                                                                                                                                                                                                                                                           | CLOSED |
