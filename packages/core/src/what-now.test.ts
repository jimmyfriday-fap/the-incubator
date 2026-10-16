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
