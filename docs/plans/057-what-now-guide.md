# Plan 057: every coding run ends with a WHAT-NOW.md in the repository and the same guide on the run page

## Executor preamble

You are implementing an exact change. Rules for every work item:

- Change only the files named here, at the places named. Work item 9 runs the formatter.
- Every path is relative to the repository root, which is your current working directory. Only this repository is in scope.
- This plan builds on plan 056. Before you start, check that `packages/core/src/engine.ts` contains `await this.installDependencies(runId, dir, checks.mode);` and that `packages/core/src/finish.ts` contains `setup: string | null;`; stop if either is missing.
- Each "Find" block must match the file exactly once; replace it with the "Replace with" block. Blocks in `text` fences carry the file's own indentation: keep it exactly. A "Create" item writes a new file with exactly the content shown.
- Copy every string exactly as written; the tests compare them.
- Do not commit, push, or run `pnpm contracts:pin`. Do not delete, skip or weaken any existing test, and do not add an eslint-disable comment.
- Never spawn a process through a shell. Run commands in PowerShell from the repository root; `node -v` already prints v22; do not change PATH.
- Output only the edits. No commentary in the files beyond the comments written here.

**Why.** A run that built a project ends with "Done" and a pull request, but nothing tells the operator what the project actually is or what to do next. After a real run (COI Tracker) the operator could not tell whether the result was a WordPress plugin, a web app or both. The README is the generic scaffold text; the facts are spread over the spec, the tickets and the run journal.

After this plan, when the owner approves the commit at the end of a coding run, the Incubator writes `WHAT-NOW.md` at the root of the folder and commits it with the work. It says, in plain words: what the project is (platform, stack, where it deploys), how to run it on the operator's machine (the numbered steps of the README's "Getting started" block, which each stack pack writes), how to put it into real use (for a WordPress plugin: install it in `wp-content/plugins/<slug>/` and activate it, or run the Docker image as its own site), what was built (each feature ticket and its state), where things stand (the agent's outcome, a setup problem from plan 056, warnings from the run), and an ordered list of what to do next. The run page shows the same guide, laid out as a panel, once the run is done (`FinishDetail.whatNow`). The guide is built deterministically from the run's own data: no model is asked. The markdown is written so that prettier leaves it unchanged, because a generated Node repository checks the format of every file.

## Work items

### 1. The guide

Create `packages/core/src/what-now.ts` with exactly this content:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { stackById, type IncubatorSpec } from '@incubator/spec';
import type { AgentVerdict, FinishDetail } from './finish.js';

/** Plan 057: the file at the root of the repository that tells the operator what was built and what to do next. */
export const WHAT_NOW_FILE = 'WHAT-NOW.md';

/** One ticket in the folder's `.incubator/tickets/`. */
export interface TicketFact {
  id: string;
  title: string;
  state: string;
}

/** What the guide is built from. */
export interface WhatNowFacts {
  runId: string;
  name: string;
  slug: string;
  description: string;
  platform: IncubatorSpec['platform'];
  pack: string;
  /** The steps of the README's "Getting started" block (see readGettingStarted); empty when there is none. */
  gettingStarted: string[];
  deployTarget: IncubatorSpec['deploy']['target'];
  branch: string | null;
  verdict: AgentVerdict | null;
  setup: string | null;
  tickets: TicketFact[];
  warnings: string[];
  /** Absent in the file written just before the commit: the commit and push lines are left out. */
  commit?: FinishDetail['commit'];
  pr: { number: number; url: string } | null;
}

/** The guide: shown on the run page, and written as WHAT-NOW.md. */
export interface WhatNow {
  title: string;
  runId: string;
  about: string[];
  /** How to run it on the operator's machine (markdown inline code allowed). */
  run: string[];
  /** How to put it into real use, for this kind of project (markdown inline code allowed). */
  install: string[];
  built: { id: string; title: string; state: string; ready: boolean }[];
  status: string[];
  next: string[];
}

const PLATFORM: Record<IncubatorSpec['platform'], string> = {
  web: 'a web application: people use it in a browser',
  service: 'a back-end service: other programs call its HTTP API',
  cli: 'a command-line tool',
  library: 'a library: other code installs and imports it',
  'wordpress-plugin':
    'a WordPress plugin: it is installed on a WordPress site (wp-content/plugins) and activated there',
  'wordpress-theme':
    'a WordPress theme: it is installed on a WordPress site (wp-content/themes) and activated there',
  other: 'a project of its own kind',
};

/** How a project of each kind is put into real use, beyond running it locally. */
function installSteps(platform: IncubatorSpec['platform'], name: string, slug: string): string[] {
  switch (platform) {
    case 'wordpress-plugin':
      return [
        `On an existing WordPress site: run \`composer install --no-dev\` in this folder, copy the folder (with \`vendor/\`) to \`wp-content/plugins/${slug}/\` on the site, then activate "${name}" under Plugins in the WordPress admin.`,
        'As its own site: the Dockerfile builds a WordPress image with the plugin installed, and every push to main deploys it to staging (DEPLOY.md lists what the deploy needs).',
      ];
    case 'wordpress-theme':
      return [
        `On an existing WordPress site: run \`composer install --no-dev\` in this folder, copy the folder (with \`vendor/\`) to \`wp-content/themes/${slug}/\` on the site, then activate "${name}" under Appearance, Themes in the WordPress admin.`,
        'As its own site: the Dockerfile builds a WordPress image with the theme installed, and every push to main deploys it to staging (DEPLOY.md lists what the deploy needs).',
      ];
    case 'web':
      return [
        'Every push to main deploys it to staging; people then open it in a browser at the staging address. Production only changes through the promote workflow (DEPLOY.md).',
      ];
    case 'service':
      return [
        'Every push to main deploys it to staging, where other programs call its HTTP API. Production only changes through the promote workflow (DEPLOY.md).',
      ];
    case 'cli':
    case 'library':
      return [
        'A release publishes a versioned package; others then install that version with their package manager (DEPLOY.md has the release steps).',
      ];
    case 'other':
      return ['DEPLOY.md describes how this project is deployed.'];
  }
}

const DEPLOY: Record<IncubatorSpec['deploy']['target'], string> = {
  'vps-tailscale': 'a server on your Tailscale network',
  'docker-host': 'a Docker host, as a container image',
  'package-release': 'a package registry, as a versioned release',
  other: 'a target of your own',
};

const STATE: Record<string, string> = {
  NEW: 'Not started',
  TAGGED_TO_RELEASE: 'Not started',
  IN_PROGRESS: 'In progress',
  DEV_IN_PROGRESS: 'In progress',
  READY_FOR_TEST: 'Ready for test',
  TEST_PASSED: 'Test passed',
  TEST_FAILED: 'Test failed',
  DEPLOYED: 'Deployed',
  PARKED: 'Parked',
};

const READY = new Set(['READY_FOR_TEST', 'TEST_PASSED', 'DEPLOYED']);

const VERDICT: Record<AgentVerdict, string> = {
  ready: 'The coding agent finished the plan.',
  parked: 'The coding agent stopped before finishing the plan.',
  ceiling: 'The coding agent stopped at a run limit.',
  failed: 'The coding agent exited with an error.',
  stopped: 'The coding agent was stopped.',
};

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The tickets in `.incubator/tickets/`, sorted by file name; a file that cannot be read is skipped. */
export function readTickets(dir: string): TicketFact[] {
  const ticketsDir = path.join(dir, '.incubator', 'tickets');
  let names: string[];
  try {
    names = readdirSync(ticketsDir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
  const out: TicketFact[] = [];
  for (const name of names) {
    try {
      const t = JSON.parse(readFileSync(path.join(ticketsDir, name), 'utf8')) as Record<
        string,
        unknown
      >;
      const id = typeof t['id'] === 'string' ? t['id'] : name.slice(0, -'.json'.length);
      const title = typeof t['title'] === 'string' ? t['title'] : id;
      const state = typeof t['state'] === 'string' ? t['state'] : 'unknown';
      out.push({ id, title: oneLine(title, 160), state });
    } catch {
      // why: a hand-edited ticket that is not JSON must not stop the guide being written.
    }
  }
  return out;
}

/**
 * The numbered steps of the README's "Getting started" block (between the `scaffold:readme-commands` markers the
 * stack pack writes), without their numbers. Empty when the README or the block is missing.
 */
export function readGettingStarted(dir: string): string[] {
  let text: string;
  try {
    text = readFileSync(path.join(dir, 'README.md'), 'utf8');
  } catch {
    return [];
  }
  const block =
    /<!-- <scaffold:readme-commands> -->([\s\S]*?)<!-- <\/scaffold:readme-commands> -->/.exec(
      text,
    )?.[1];
  if (!block) return [];
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('<!--'))
    .map((l) => oneLine(l.replace(/^(\d+\.|[-*])\s+/, ''), 400))
    .slice(0, 10);
}

/** The guide from the run's facts: deterministic, no model. */
export function whatNow(f: WhatNowFacts): WhatNow {
  const built = f.tickets.map((t) => ({
    id: t.id,
    title: t.title,
    state: STATE[t.state] ?? t.state,
    ready: READY.has(t.state),
  }));
  const waiting = built.filter((t) => !t.ready).length;
  const about = [
    `${f.name}: ${oneLine(f.description, 300)}`,
    `What it is: ${PLATFORM[f.platform]}.`,
    `How it is built: ${stackById(f.pack)?.summary ?? f.pack}`,
    `Where it runs: ${DEPLOY[f.deployTarget]}. DEPLOY.md has the details.`,
  ];
  const status = [f.verdict ? VERDICT[f.verdict] : 'The coding agent has not run yet.'];
  if (built.length > 0)
    status.push(`${built.length - waiting} of ${built.length} features are ready for test.`);
  if (f.setup) status.push(`Setting up the project failed: ${f.setup}.`);
  if (f.commit !== undefined) {
    if (f.commit?.sha)
      status.push(
        `Committed ${f.commit.sha.slice(0, 10)} on ${f.commit.branch ?? f.branch ?? 'the branch'}.`,
      );
    else if (f.commit?.left) status.push('The changes are left uncommitted in the folder.');
    else if (f.commit?.none) status.push('The agent changed nothing, so nothing was committed.');
    else status.push('The changes are not committed yet.');
    status.push(f.pr ? `Pull request #${f.pr.number}: ${f.pr.url}` : 'Not pushed to GitHub yet.');
  }
  for (const w of f.warnings) status.push(`Note: ${w}`);

  const next: string[] = [];
  if (f.setup)
    next.push(
      `Fix the setup problem first (${f.setup}), then press Continue coding in the Incubator.`,
    );
  else if (f.verdict !== null && f.verdict !== 'ready')
    next.push(
      `Press Continue coding in the Incubator: the agent picks up where it stopped${waiting > 0 ? ` (${waiting} feature${waiting === 1 ? '' : 's'} not ready for test)` : ''}.`,
    );
  next.push('Run it on your machine: the steps are under "How to run it" above.');
  if (f.pr)
    next.push(
      `Review pull request #${f.pr.number} and merge it into main when you are happy with it: every push to main deploys to staging.`,
    );
  else if (f.commit === undefined || f.commit?.sha)
    next.push(
      'Push the branch from the Incubator, then review the pull request and merge it into main: every push to main deploys to staging.',
    );
  next.push(
    'Before the first deploy, add the secrets and hosts DEPLOY.md lists; production only deploys through the promote workflow.',
  );
  const run =
    f.gettingStarted.length > 0 ? f.gettingStarted : ['Follow "Getting started" in README.md.'];
  const install = installSteps(f.platform, f.name, f.slug);
  return { title: `What now: ${f.name}`, runId: f.runId, about, run, install, built, status, next };
}

/** Backslash-escapes the characters markdown would read as formatting in text that came from the spec or a ticket. */
function esc(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

/** WHAT-NOW.md: the guide as markdown that prettier (proseWrap preserve) leaves unchanged. */
export function whatNowMarkdown(w: WhatNow): string {
  const list = (items: string[]) => items.map((i) => `- ${esc(i)}`);
  return [
    `# ${esc(w.title)}`,
    '',
    `Written by the Incubator at the end of run \`${w.runId}\`. The next run replaces it.`,
    '',
    '## What this is',
    '',
    ...list(w.about),
    '',
    // why: the run and install steps are the Incubator's own text (README template, installSteps) and carry
    // inline code on purpose, so they are not escaped.
    '## How to run it',
    '',
    ...w.run.map((n, i) => `${i + 1}. ${n}`),
    '',
    '## How to put it into use',
    '',
    ...w.install.map((n) => `- ${n}`),
    '',
    ...(w.built.length > 0
      ? [
          '## What was built',
          '',
          ...w.built.map((t) => `- **${t.state}**: \`${t.id}\`, ${esc(t.title)}`),
          '',
        ]
      : []),
    '## Where it stands',
    '',
    ...list(w.status),
    '',
    '## What to do next',
    '',
    ...w.next.map((n, i) => `${i + 1}. ${esc(n)}`),
    '',
  ].join('\n');
}
```

### 2. The finished-run detail type

In `packages/core/src/finish.ts`:

Find:

```text
  setup: string | null;
```

Replace with:

```text
  setup: string | null;
  /** Plan 057: the operator's guide, once the run is done; null before. */
  whatNow: WhatNow | null;
```

Find:

```text
import type { CheckRun } from './check-run.js';
```

Replace with:

```text
import type { CheckRun } from './check-run.js';
import type { WhatNow } from './what-now.js';
```

### 3. The engine: imports and the setup helper

In `packages/core/src/engine.ts`:

Find:

```text
import type { InstallRun } from './verify.js';
```

Replace with:

```text
import type { InstallRun } from './verify.js';
import {
  readGettingStarted,
  readTickets,
  WHAT_NOW_FILE,
  whatNow,
  whatNowMarkdown,
  type WhatNow,
} from './what-now.js';
```

Find:

```text
    const installed = this.entries(runId).findLast(
      (e) => e.type === 'code.install' && e.seq > after,
    )?.['runs'] as InstallRun[] | undefined;
    const setup = installed?.find((r) => r.result !== 'ok')?.note ?? null;
    return {
      stage,
      dir,
```

Replace with:

```text
    const setup = this.setupProblem(runId);
    const detail: Omit<FinishDetail, 'whatNow'> = {
      stage,
      dir,
```

### 4. The engine: the guide on the finished-run detail

In `packages/core/src/engine.ts`:

Find:

```text
          : null,
    };
  }

  /** The subject of the drafted commit: the one request, the count of requests, or the new project. */
```

Replace with:

```text
          : null,
    };
    return { ...detail, whatNow: stage === 'done' ? this.whatNowFor(runId, s, detail) : null };
  }

  /** Plan 056: the first problem installing the dependencies before the agent coded, or null. */
  private setupProblem(runId: string): string | null {
    const after = this.continuedAt(runId);
    const installed = this.entries(runId).findLast(
      (e) => e.type === 'code.install' && e.seq > after,
    )?.['runs'] as InstallRun[] | undefined;
    return installed?.find((r) => r.result !== 'ok')?.note ?? null;
  }

  /** Plan 057: the operator's guide for this run, from the approved spec, the folder's tickets and the journal. */
  private whatNowFor(
    runId: string,
    s: RunState,
    d: Pick<FinishDetail, 'agent' | 'setup' | 'branch'> &
      Partial<Pick<FinishDetail, 'commit' | 'pr'>>,
  ): WhatNow {
    const spec = this.approvedSpec(runId);
    const warnings = this.entries(runId)
      .filter((e) => e.type === 'step.warn')
      .map((e) => {
        const data = e['data'] as { reason?: unknown } | undefined;
        const text = typeof e['message'] === 'string' ? e['message'] : data?.reason;
        return typeof text === 'string' ? text : '';
      })
      .filter((t) => t.length > 0);
    return whatNow({
      runId,
      name: spec.project.name,
      description: spec.project.description,
      platform: spec.platform,
      slug: spec.project.slug,
      pack: spec.stack.pack,
      gettingStarted: readGettingStarted(this.runDir(s)),
      deployTarget: spec.deploy.target,
      branch: d.branch,
      verdict: d.agent?.verdict ?? null,
      setup: d.setup,
      tickets: readTickets(this.runDir(s)),
      warnings: [...new Set(warnings)],
      ...(d.commit !== undefined ? { commit: d.commit } : {}),
      pr: d.pr ?? null,
    });
  }

  /** The subject of the drafted commit: the one request, the count of requests, or the new project. */
```

### 5. The engine: WHAT-NOW.md is committed with the work

In `packages/core/src/engine.ts`:

Find:

```text
        summary: (s.steps['code.done']?.data as AgentReport | undefined)?.summary ?? null,
      });
      await git.addAll(dir);
```

Replace with:

```text
        summary: (s.steps['code.done']?.data as AgentReport | undefined)?.summary ?? null,
      });
      // Plan 057: the operator's guide to what was built and what to do next, committed with the work.
      writeFileSync(
        path.join(dir, WHAT_NOW_FILE),
        whatNowMarkdown(
          this.whatNowFor(runId, s, {
            agent: (s.steps['code.done']?.data as AgentReport | undefined) ?? null,
            setup: this.setupProblem(runId),
            branch: start.branch,
          }),
        ),
      );
      await git.addAll(dir);
```

### 6. The run page: types and the panel

In `apps/web/src/api-types.ts`:

Find:

```text
  setup: string | null;
```

Replace with:

```text
  setup: string | null;
  /** Plan 057: the operator's guide, once the run is done; null before. */
  whatNow: WhatNow | null;
```

Find:

```text
export interface Question {
```

Replace with:

```text
/** Plan 057: the operator's guide at the end of a run (the same content as WHAT-NOW.md). */
export interface WhatNow {
  title: string;
  runId: string;
  about: string[];
  run: string[];
  install: string[];
  built: { id: string; title: string; state: string; ready: boolean }[];
  status: string[];
  next: string[];
}

export interface Question {
```

Create `apps/web/src/ui/views/WhatNow.tsx` with exactly this content:

```tsx
import type { WhatNow } from '../../api-types.js';

/** Text with `inline code` spans (the run and install steps carry them): odd pieces between backticks are code. */
function Inline({ text }: { text: string }) {
  return (
    <>{text.split('`').map((piece, i) => (i % 2 === 1 ? <code key={i}>{piece}</code> : piece))}</>
  );
}

/** Plan 057: the operator's guide at the end of a run, the same content as WHAT-NOW.md in the repository. */
export function WhatNowPanel({ w }: { w: WhatNow }) {
  return (
    <section className="what-now" data-testid="what-now">
      <h3>{w.title}</h3>
      <h4>What this is</h4>
      <ul>
        {w.about.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h4>How to run it</h4>
      <ol data-testid="what-now-run">
        {w.run.map((line) => (
          <li key={line}>
            <Inline text={line} />
          </li>
        ))}
      </ol>
      <h4>How to put it into use</h4>
      <ul>
        {w.install.map((line) => (
          <li key={line}>
            <Inline text={line} />
          </li>
        ))}
      </ul>
      {w.built.length > 0 && (
        <>
          <h4>What was built</h4>
          <ul className="what-now-built">
            {w.built.map((t) => (
              <li key={t.id}>
                <span className={`badge ${t.ready ? 'ready' : 'waiting'}`}>{t.state}</span>{' '}
                <code>{t.id}</code> {t.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Where it stands</h4>
      <ul>
        {w.status.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h4>What to do next</h4>
      <ol>
        {w.next.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className="muted">
        The same guide is in <code>WHAT-NOW.md</code> at the root of the repository.
      </p>
    </section>
  );
}
```

In `apps/web/src/ui/views/Summary.tsx`:

Find:

```text
import type { RunDetail } from '../../api-types.js';
```

Replace with:

```text
import type { RunDetail } from '../../api-types.js';
import { WhatNowPanel } from './WhatNow.js';
```

Find:

```text
            </div>
          )}
        </>
      )}
      {run.enhance && (
```

Replace with:

```text
            </div>
          )}
          {run.finish.whatNow && <WhatNowPanel w={run.finish.whatNow} />}
        </>
      )}
      {run.enhance && (
```

### 7. The run page: styles

In `apps/web/src/ui/styles.css`:

Find:

```text
/* --- badges --- */
```

Replace with:

```text
/* --- what now (plan 057) --- */

.what-now {
  border-top: 1px solid var(--line);
  margin-top: var(--s4);
  padding-top: var(--s3);
}

.what-now li {
  margin-bottom: var(--s2);
}

.what-now .badge {
  margin-left: 0;
}

.what-now .badge.ready {
  color: var(--ok);
}

.what-now .badge.waiting {
  color: var(--warn);
}

/* --- badges --- */
```

### 8. Tests

Create `packages/core/src/what-now.test.ts` with exactly this content:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { format } from 'prettier';
import { describe, expect, it } from 'vitest';
import {
  readGettingStarted,
  readTickets,
  whatNow,
  whatNowMarkdown,
  type WhatNowFacts,
} from './what-now.js';

const facts = (over: Partial<WhatNowFacts> = {}): WhatNowFacts => ({
  runId: '20261015-030815-taltpt',
  name: 'COI Tracker',
  slug: 'coi-tracker',
  description: 'Tracks subcontractor insurance certificates for general contractors.',
  platform: 'wordpress-plugin',
  pack: 'wordpress',
  gettingStarted: [
    'Install PHP 8.3 with Composer 2, then run `composer install`.',
    'Run `docker compose up -d --wait`: WordPress on http://localhost:8080.',
  ],
  deployTarget: 'docker-host',
  branch: 'incubator/build-20261015',
  verdict: 'parked',
  setup: null,
  tickets: [
    { id: 'F-sub-roster', title: 'Subcontractor roster per job', state: 'READY_FOR_TEST' },
    {
      id: 'F-upload-portal',
      title: 'Upload *all* certificates_now to [the] portal <fast>',
      state: 'DEV_IN_PROGRESS',
    },
  ],
  warnings: ['branch protection on main is unavailable for this repository or plan'],
  pr: null,
  ...over,
});

describe('the WHAT-NOW guide (plan 057)', () => {
  it('says what the project is, in plain words', () => {
    const w = whatNow(facts());
    expect(w.title).toBe('What now: COI Tracker');
    expect(w.about).toContain(
      'What it is: a WordPress plugin: it is installed on a WordPress site (wp-content/plugins) and activated there.',
    );
    expect(w.about).toContain(
      'How it is built: A WordPress plugin or theme with Composer autoloading.',
    );
    expect(w.built.map((t) => [t.id, t.state, t.ready])).toEqual([
      ['F-sub-roster', 'Ready for test', true],
      ['F-upload-portal', 'In progress', false],
    ]);
  });

  it('says how to run it and how to install a WordPress plugin on a site', () => {
    const w = whatNow(facts());
    expect(w.run).toEqual([
      'Install PHP 8.3 with Composer 2, then run `composer install`.',
      'Run `docker compose up -d --wait`: WordPress on http://localhost:8080.',
    ]);
    expect(w.install[0]).toBe(
      'On an existing WordPress site: run `composer install --no-dev` in this folder, copy the folder (with `vendor/`) to `wp-content/plugins/coi-tracker/` on the site, then activate "COI Tracker" under Plugins in the WordPress admin.',
    );
    expect(whatNow(facts({ gettingStarted: [] })).run).toEqual([
      'Follow "Getting started" in README.md.',
    ]);
    expect(whatNow(facts({ platform: 'web' })).install[0]).toContain('open it in a browser');
  });

  it('reads the Getting started steps from the README block the stack pack writes', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'what now readme '));
    writeFileSync(
      path.join(dir, 'README.md'),
      [
        '# X',
        '',
        '## Getting started',
        '',
        '<!-- <scaffold:readme-commands> -->',
        '<!-- @wordpress -->',
        '',
        '1. Install PHP, then run `composer install`.',
        '2. Run `docker compose up -d --wait`.',
        '',
        '<!-- </scaffold:readme-commands> -->',
        '',
        '## Everyday commands',
      ].join('\n'),
    );
    expect(readGettingStarted(dir)).toEqual([
      'Install PHP, then run `composer install`.',
      'Run `docker compose up -d --wait`.',
    ]);
    expect(readGettingStarted(path.join(dir, 'missing'))).toEqual([]);
  });

  it('puts continuing the coding first when the agent did not finish', () => {
    const w = whatNow(facts());
    expect(w.status).toContain('1 of 2 features are ready for test.');
    expect(w.status).toContain(
      'Note: branch protection on main is unavailable for this repository or plan',
    );
    expect(w.next[0]).toBe(
      'Press Continue coding in the Incubator: the agent picks up where it stopped (1 feature not ready for test).',
    );
  });

  it('puts a setup problem before everything else', () => {
    const w = whatNow(facts({ setup: 'composer is not installed' }));
    expect(w.status).toContain('Setting up the project failed: composer is not installed.');
    expect(w.next[0]).toBe(
      'Fix the setup problem first (composer is not installed), then press Continue coding in the Incubator.',
    );
  });

  it('leaves the commit and push out of the file written before the commit, and names the pull request after it', () => {
    const before = whatNow(facts());
    expect(before.status.some((l) => l.startsWith('Committed') || l.startsWith('Not pushed'))).toBe(
      false,
    );
    const done = whatNow(
      facts({
        verdict: 'ready',
        commit: { sha: 'e9baec8c44e4489fc0d7', branch: 'incubator/build-20261015' },
        pr: { number: 1, url: 'https://github.com/o/r/pull/1' },
      }),
    );
    expect(done.status).toContain('Committed e9baec8c44 on incubator/build-20261015.');
    expect(done.status).toContain('Pull request #1: https://github.com/o/r/pull/1');
    expect(done.next[0]).toBe('Run it on your machine: the steps are under "How to run it" above.');
    expect(done.next[1]).toContain('Review pull request #1');
  });

  it('writes markdown that prettier leaves unchanged (a generated repository checks its format)', async () => {
    const md = whatNowMarkdown(whatNow(facts({ setup: 'composer install exited 1' })));
    expect(md.startsWith('# What now: COI Tracker\n')).toBe(true);
    expect(md).toContain('## What to do next');
    expect(md).toContain(
      '## How to run it\n\n1. Install PHP 8.3 with Composer 2, then run `composer install`.\n',
    );
    expect(md).toContain('`wp-content/plugins/coi-tracker/`');
    expect(md).toContain('\\*all\\* certificates\\_now to \\[the\\] portal \\<fast\\>');
    expect(await format(md, { parser: 'markdown', printWidth: 100, proseWrap: 'preserve' })).toBe(
      md,
    );
  });

  it('reads the tickets in the folder and skips one that is not JSON', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'what now '));
    const t = path.join(dir, '.incubator', 'tickets');
    mkdirSync(t, { recursive: true });
    writeFileSync(
      path.join(t, 'F-b.json'),
      JSON.stringify({ id: 'F-b', title: 'Second\n  line', state: 'NEW' }),
    );
    writeFileSync(
      path.join(t, 'F-a.json'),
      JSON.stringify({ id: 'F-a', title: 'First', state: 'READY_FOR_TEST' }),
    );
    writeFileSync(path.join(t, 'F-c.json'), 'not json');
    expect(readTickets(dir)).toEqual([
      { id: 'F-a', title: 'First', state: 'READY_FOR_TEST' },
      { id: 'F-b', title: 'Second line', state: 'NEW' },
    ]);
    expect(readTickets(path.join(dir, 'missing'))).toEqual([]);
  });
});
```

In `packages/core/src/folder-runs.test.ts`:

Find:

```text
  it('asks before every commit and push: git must know the owner, then commit, then push opens one PR', async () => {
```

Replace with:

```text
  it('commits WHAT-NOW.md with the work and shows the same guide once the run is done (plan 057)', async () => {
    const h = harness();
    const dir = freshFolder();
    const { runId } = await newSolution(h, dir);
    expect((await h.engine.finishDetail(runId))!.whatNow).toBeNull();
    await setOwner(dir);
    h.engine.submitCommit(runId, { action: 'commit' });
    let r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.parked).toMatchObject({ state: 'PUSH', reason: 'needs_push' });
    const file = readFileSync(path.join(dir, 'WHAT-NOW.md'), 'utf8');
    expect(file.startsWith('# What now: Tallyho\n')).toBe(true);
    expect(file).toContain(`run \`${runId}\``);
    expect(file).toContain('## What to do next');
    // The run steps come from the rendered README's Getting started block, not the fallback line.
    expect(file).toContain('## How to run it\n\n1. ');
    expect(file).not.toContain('Follow "Getting started" in README.md.');
    // Committed with the work: nothing is left over in the folder.
    expect(await out(['status', '--porcelain'], dir)).toBe('');
    expect(await out(['show', '--name-only', '--format=', 'HEAD'], dir)).toContain('WHAT-NOW.md');
    h.engine.submitPush(runId, 'push');
    r = await h.engine.resume(runId, new DefaultsPrompter());
    expect(r.done).toBe(true);
    const w = (await h.engine.finishDetail(runId))!.whatNow!;
    expect(w.title).toBe('What now: Tallyho');
    expect(w.status.some((l) => l.startsWith('Pull request #1: '))).toBe(true);
    expect(w.next[0]).toBe('Run it on your machine: the steps are under "How to run it" above.');
  });

  it('asks before every commit and push: git must know the owner, then commit, then push opens one PR', async () => {
```

### 9. Format the touched files

Run:

```powershell
pnpm exec prettier --write packages/core/src/what-now.ts packages/core/src/what-now.test.ts packages/core/src/finish.ts packages/core/src/engine.ts packages/core/src/folder-runs.test.ts apps/web/src/api-types.ts apps/web/src/ui/views/WhatNow.tsx apps/web/src/ui/views/Summary.tsx apps/web/src/ui/styles.css
```

## Touched files and markers

| File                                    | Marker                                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| `packages/core/src/what-now.ts`         | `export const WHAT_NOW_FILE = 'WHAT-NOW.md';`                |
| `packages/core/src/finish.ts`           | `whatNow: WhatNow \| null;`                                  |
| `packages/core/src/engine.ts`           | `private whatNowFor(`                                        |
| `apps/web/src/api-types.ts`             | `export interface WhatNow {`                                 |
| `apps/web/src/ui/views/WhatNow.tsx`     | `export function WhatNowPanel(`                              |
| `apps/web/src/ui/views/Summary.tsx`     | `<WhatNowPanel w={run.finish.whatNow} />`                    |
| `apps/web/src/ui/styles.css`            | `/* --- what now (plan 057) --- */`                          |
| `packages/core/src/what-now.test.ts`    | `describe('the WHAT-NOW guide (plan 057)'`                   |
| `packages/core/src/folder-runs.test.ts` | `commits WHAT-NOW.md with the work and shows the same guide` |

## Acceptance commands

```powershell
pnpm exec vitest run --project unit packages/core/src/what-now.test.ts packages/core/src/folder-runs.test.ts apps/web/src/server/server.test.ts apps/web/src/ui/styles.test.ts
(Select-String -SimpleMatch -Path packages/core/src/engine.ts "this.whatNowFor(").Count
pnpm typecheck
pnpm exec eslint --max-warnings=0 packages/core apps/web
pnpm check:quick
```

```text
what-now.test.ts, folder-runs.test.ts, server.test.ts and styles.test.ts pass, including the new plan 057 tests
the Select-String count prints 2
pnpm typecheck and eslint exit 0
pnpm check:quick exits 0
```

## Drift and hallucination guardrails

| Trap                                                                                          | Why                                                                         | Mechanical check                                                                                                                |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The guide is built but never written into the repository                                      | `whatNowMarkdown` type-checks whether or not the commit step calls it       | the engine test reads `WHAT-NOW.md` from the folder and finds it in `git show --name-only HEAD`                                 |
| The file is written after the commit, so the folder is dirty and Continue coding refuses      | Continue coding requires a clean folder (`dirty_tree`)                      | the engine test asserts `git status --porcelain` is empty after the commit                                                      |
| A ticket title with markdown characters makes a generated Node repository's format check fail | its `check quick` runs prettier on every file, markdown included            | the unit test formats the guide with prettier and expects it unchanged, with a title holding `* _ [ ] < >`                      |
| The run page shows the guide before the run is done, with half-known facts                    | the commit and pull request lines only exist at the end                     | the engine test expects `whatNow` null at the commit request and set once the run is done                                       |
| The setup line drifts from plan 056's                                                         | two copies of the same lookup                                               | plan 056's inline lookup is replaced by `setupProblem`, used by both the detail and the file                                    |
| The run steps silently fall back to "Follow Getting started in README.md"                     | a wrong marker pattern in `readGettingStarted` still produces a valid guide | the engine test reads a really rendered README and expects the fallback line absent; the unit test feeds the exact marker lines |
| The web type differs from the core type                                                       | the web bundle keeps its own copy of the API types                          | `pnpm typecheck` compiles the server, which returns the core `FinishDetail` as the web `RunDetail['finish']`                    |

## Review rounds

| Round | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1     | Operator request after a real run (COI Tracker): the run ends without saying what the project is or what to do next; write it to the repository root as markdown and show it on the run page                                                                                                                                                                                                                                                  | CLOSED |
| 2     | In-session adversarial review (Cursor unavailable): operator asked for how to run and install it, now the How to run it (README Getting started block) and How to put it into use sections; finish.ts import moved to the top; trial apply passed typecheck (core and UI) and 155 engine and server tests plus 8 new unit tests (prettier leaves the markdown unchanged); eslint required `case 'other'` instead of `default` in installSteps | CLOSED |
| 3     | Code review of the Copilot run (Haiku 4.5): all three new files and every tracked-file change are identical to the trial apply; typecheck, eslint and `pnpm check:quick` (844 tests) pass; writing the guide to another file name and showing it before the run is done each fail the engine test                                                                                                                                             | CLOSED |
