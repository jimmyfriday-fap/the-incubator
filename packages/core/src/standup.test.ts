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

  it('points at its own work items and tells the executor to wait for the image build (plan 060)', () => {
    const md = standUp(facts()).markdown;
    expect(md).toContain('2. Run it on your machine: the steps are the work items above.');
    expect(md).not.toContain('How to run it');
    expect(md).toContain(
      'The first run builds the WordPress image and can take several minutes: wait for the command to finish, do not stop it.',
    );
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
