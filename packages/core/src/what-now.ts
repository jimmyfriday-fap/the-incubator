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
