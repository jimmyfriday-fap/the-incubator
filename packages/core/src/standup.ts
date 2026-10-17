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
          'The command exits 0 (`$LASTEXITCODE` is 0) and the last lines say the `db` and `wordpress` containers are `Healthy` or `Started`. The first run builds the WordPress image and can take several minutes: wait for the command to finish, do not stop it.',
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
    // why: plan 057's line points at its "How to run it" section; this document has none, its work items are the steps.
    ...g.next.map(
      (l, i) =>
        `${i + 1}. ${esc(l.replace('the steps are under "How to run it" above', 'the steps are the work items above'))}`,
    ),
    '',
  ].join('\n');
}

/** The stand-up guide for a run: the file name and the markdown. */
export function standUp(f: StandUpFacts): StandUp {
  return { fileName: `STAND-UP-${f.slug}.md`, markdown: standUpMarkdown(f, standUpSteps(f)) };
}
