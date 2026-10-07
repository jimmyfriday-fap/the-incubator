import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
import { nodeExec } from '@incubator/runtime';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { seedAdoptRepo, startFakeServer } from '../src/testing-fixtures/fake-web.js';
import type { RunningServer } from '../src/server/server.js';

const UI_DIR = path.resolve(import.meta.dirname, '../dist/ui');
// Screenshots of each flow land in .reports/e2e (ignored by git; CI can upload them).
const SHOTS = path.resolve(import.meta.dirname, '../../../.reports/e2e');
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: path.join(SHOTS, `${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
const servers: RunningServer[] = [];
let browser: Browser;

beforeAll(() => {
  // The commit step uses the owner's git identity; the machine's own configuration is not consulted.
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'e2e gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
  process.env['GIT_CONFIG_GLOBAL'] = cfg;
  process.env['GIT_CONFIG_NOSYSTEM'] = '1';
  process.env['FAKE_AGENT_MODE'] = 'edit';
});

beforeAll(async () => {
  if (!existsSync(path.join(UI_DIR, 'index.html')))
    throw new Error('the UI is not built: pnpm --filter @incubator/web build:ui');
  // why: CI runners use their installed Chrome (no browser download); locally the preinstalled
  // Playwright Chromium is found through PLAYWRIGHT_BROWSERS_PATH.
  const channel = process.env['INCUBATOR_E2E_CHANNEL'];
  browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
});
afterAll(async () => {
  await browser?.close();
  for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'FAKE_AGENT_MODE'])
    delete process.env[k];
});
afterEach(async () => {
  // A test that needs another kind of agent sets it for itself; the next one starts from the usual one.
  process.env['FAKE_AGENT_MODE'] = 'edit';
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function open(
  opts: {
    enhance?: string;
    pick?: string[];
    fixtureDir?: string;
    stacks?: NonNullable<Parameters<typeof startFakeServer>[0]>['stacks'];
  } = {},
) {
  const picks = [...(opts.pick ?? [])];
  const { server, h, stackCalls } = await startFakeServer({
    uiDir: UI_DIR,
    ...(opts.enhance ? { enhance: opts.enhance } : {}),
    ...(opts.fixtureDir ? { fixtureDir: opts.fixtureDir } : {}),
    ...(opts.stacks ? { stacks: opts.stacks } : {}),
    // The native folder dialog cannot be driven from a test; the host hands back the queued choices.
    host: { pickFolder: () => Promise.resolve(picks.shift() ?? null) },
  });
  servers.push(server);
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(server.url);
  return { server, h, page, errors, stackCalls };
}

const state = (page: Page) => page.getByTestId('run-state');
// why: the first tree preview renders the whole spec on the server (1-2 s of CPU on its one thread),
// so a UI poll can wait behind it; vitest's default expect.poll timeout (1 s) is too short.
const UI = { timeout: 15_000 };
const intent = (page: Page) => page.getByLabel('What would you like to do');
const newFolder = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'e2e new ')), 'my solution');

describe('web UI (Playwright, fakes)', () => {
  it('the wizard offers two paths, shows nothing until one is chosen, and explains a folder before it starts', async () => {
    const { page, h, errors } = await open();
    expect(await intent(page).inputValue()).toBe('');
    expect(await page.getByTestId('narrative').count()).toBe(0);
    expect(
      (await intent(page).locator('option').allTextContents()).filter((t) => t !== 'Choose…'),
    ).toEqual(['New solution', 'Update an existing solution']);

    // Update: a folder that is not a repository, then one with uncommitted work, then a good one.
    await intent(page).selectOption({ label: 'Update an existing solution' });
    expect(await page.getByTestId('path-update').textContent()).toContain(
      'Browse to a folder that has a local repository in it',
    );
    const plain = mkdtempSync(path.join(os.tmpdir(), 'e2e plain '));
    await page.getByTestId('folder-path').fill(plain);
    await expect
      .poll(() => page.getByTestId('folder-verdict').textContent(), UI)
      .toContain('not a git repository');
    expect(await page.getByTestId('start-enhance').isDisabled()).toBe(true);
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    writeFileSync(path.join(dir, 'half-done.txt'), 'wip\n');
    await page.getByTestId('folder-path').fill(dir);
    await expect
      .poll(() => page.getByTestId('folder-verdict').textContent(), UI)
      .toContain('1 uncommitted change');
    expect(await page.getByTestId('start-enhance').isDisabled()).toBe(true);
    rmSync(path.join(dir, 'half-done.txt'));
    await page.getByTestId('folder-recheck').click();
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), UI)
      .toContain('working tree clean');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);

    // Switching path clears the folder: an update's repository never suits a new solution.
    await intent(page).selectOption({ label: 'New solution' });
    expect(await page.getByTestId('folder-path').inputValue()).toBe('');
    expect(await page.getByTestId('path-new').textContent()).toContain(
      'Choose the folder where you want to initialize the new repository',
    );
    await page.getByTestId('folder-path').fill(dir);
    await expect
      .poll(() => page.getByTestId('folder-verdict').textContent(), UI)
      .toContain('not empty');
    await page.getByTestId('narrative').fill('Anything');
    expect(await page.getByTestId('start-new').isDisabled()).toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('new: a Flutter project made by its own tool: suggest → create → the idea is planned as an update', async () => {
    const STACK_FIXTURES = path.resolve(
      import.meta.dirname,
      '../../../packages/core/fixtures/stacks/flutter-create',
    );
    const folder = newFolder();
    const { page, errors, stackCalls } = await open({ pick: [folder], fixtureDir: STACK_FIXTURES });
    await intent(page).selectOption({ label: 'New solution' });
    await page.getByTestId('pick-folder').click();
    await expect.poll(() => page.getByTestId('folder-path').inputValue(), UI).toBe(folder);
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), UI)
      .toContain('will be created and become the repository');
    await page
      .getByTestId('narrative')
      .fill(
        'A club event sign-up app for phones and the web: list events, sign up, see who is coming.',
      );

    // The stack: asked for, explained, and the owner's choice.
    await page.getByTestId('suggest-stack').click();
    await page.getByTestId('stack-rec').waitFor({ timeout: 15_000 });
    expect(await page.getByTestId('stack-rec').textContent()).toContain('Suggested: Flutter app');
    expect(await page.getByTestId('stack-rec').textContent()).toContain('one codebase');
    expect(await page.getByTestId('stack-rec').textContent()).toContain('Node web app');
    await page.getByTestId('use-suggested').click();
    await expect
      .poll(() => page.getByTestId('stack-ready').textContent(), UI)
      .toContain('Flutter 3.99.0');
    expect(await page.getByTestId('stack-details').textContent()).toContain(
      'never installs the tool for you',
    );
    // The folder name is the project name unless the owner changes it.
    expect(await page.getByTestId('stack-name').inputValue()).toBe('my solution');
    await page.getByTestId('stack-name').fill('Club Events');
    await shot(page, 'stack-1-choice');
    await page.getByTestId('start-create').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);

    // Created by the generator, committed, and then planned like any update, with the idea as the request.
    expect(stackCalls.find((c) => c.args[0] === 'create')?.args).toContain('club_events');
    await page.getByTestId('review').waitFor({ timeout: 60_000 });
    const note = (await page.getByTestId('no-pack-note').textContent()) ?? '';
    expect(note).toContain('Detected: Dart/Flutter');
    expect(await page.getByTestId('checks-editor').inputValue()).toBe(
      'flutter analyze\nflutter test',
    );
    await shot(page, 'stack-2-review');
    expect(
      errors.filter((e) => !/Failed to load resource/.test(e)),
      errors.join('\n'),
    ).toEqual([]);
  });

  it('new: a stack whose tool is missing says where to get it and does not start', async () => {
    const folder = newFolder();
    const { page, stackCalls } = await open({ pick: [folder], stacks: { installed: false } });
    await intent(page).selectOption({ label: 'New solution' });
    await page.getByTestId('pick-folder').click();
    await expect.poll(() => page.getByTestId('folder-path').inputValue(), UI).toBe(folder);
    await page.getByTestId('narrative').fill('A phone app for club events');
    await page.getByTestId('stack').selectOption('flutter');
    const missing = page.getByTestId('stack-missing');
    await missing.waitFor({ timeout: 15_000 });
    expect(await missing.textContent()).toContain('flutter isn');
    expect(await missing.locator('a').getAttribute('href')).toBe(
      'https://docs.flutter.dev/get-started/install',
    );
    expect(await page.getByTestId('start-create').isDisabled()).toBe(true);
    // Back to the built-in stacks: the usual button returns.
    await page.getByTestId('stack').selectOption('');
    await page.getByTestId('start-new').waitFor();
    expect(stackCalls.filter((c) => c.args[0] === 'create')).toEqual([]);
  });

  it('new solution: folder → describe → questions → review → publish → coding → commit → push → DONE', async () => {
    const folder = newFolder();
    const { server, h, page, errors } = await open({ pick: [folder] });
    // The launch token was exchanged for a cookie and is gone from the address bar.
    expect(page.url()).toBe(`${server.origin}/`);
    await intent(page).selectOption({ label: 'New solution' });
    await page.getByTestId('pick-folder').click();
    await expect.poll(() => page.getByTestId('folder-path').inputValue(), UI).toBe(folder);
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), UI)
      .toContain('will be created and become the repository');
    await page
      .getByTestId('narrative')
      .fill(
        'Stockroom: a web app for independent cafés to track stock levels, record deliveries and get reorder alerts.',
      );
    await page.getByTestId('start-new').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);

    const questions = page.getByTestId('questions');
    await questions.waitFor();
    await shot(page, 'greenfield-1-questions');
    expect(await questions.locator('fieldset').count()).toBeGreaterThan(0);
    // Pick a non-recommended option for the first question, then submit.
    const first = questions.locator('fieldset').first();
    const radios = first.locator('input[type=radio]');
    if ((await radios.count()) > 1) await radios.nth(1).check();
    await page.getByTestId('submit-answers').click();

    const review = page.getByTestId('review');
    await review.waitFor({ timeout: 30_000 });
    await expect
      .poll(() => page.getByTestId('spec-diff').locator('tr').count(), UI)
      .toBeGreaterThan(0);
    expect(await page.getByTestId('decisions').locator('li').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('decisions').textContent()).toMatch(/user|inferred|default/);
    await page.getByTestId('diff-from').selectOption('0');
    await expect
      .poll(() => page.getByTestId('spec-diff').textContent(), UI)
      .toContain('/project/slug');
    // The tree preview exists at REVIEW and opens files from memory.
    await page.getByTestId('runtab-files').click();
    await page.getByTestId('tree').getByRole('button', { name: 'CLAUDE.md', exact: true }).click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Stockroom');
    await page.getByTestId('runtab-plan').click();

    expect(await page.getByTestId('approve').isDisabled()).toBe(true);
    await page.getByTestId('owner-login').fill('octo');
    await shot(page, 'greenfield-2-review');
    expect(await page.getByTestId('spec-editor').inputValue()).toContain('"login": "octo"');
    await page.getByTestId('approve').click();

    // The repository is created and pushed, the agent codes in the folder, and then the run asks.
    const commit = page.getByTestId('commit-request');
    await commit.waitFor({ timeout: 90_000 });
    expect(h.github.repos.has('octo/stockroom')).toBe(true);
    expect(await page.getByTestId('changed-files').textContent()).toContain('src/agent-work.txt');
    expect(await page.getByTestId('agent-summary').textContent()).toContain(
      'Added src/agent-work.txt',
    );
    expect(await page.getByTestId('commit-message').inputValue()).toMatch(/^feat: build Stockroom/);
    expect(await page.getByTestId('commit-identity').textContent()).toContain('Owner Person');
    expect(await page.getByTestId('run-state').textContent()).toBe('PARKED');
    await shot(page, 'greenfield-3-commit');
    await page.getByTestId('commit-message').fill('feat: stock tracking\n\nWritten by me.');
    await page.getByTestId('commit').click();

    await page.getByTestId('push-request').waitFor({ timeout: 60_000 });
    expect(h.github.repos.get('octo/stockroom')!.prs).toEqual([]);
    await shot(page, 'greenfield-4-push');
    await page.getByTestId('push').click();
    await expect.poll(() => state(page).textContent(), { timeout: 60_000 }).toBe('DONE');
    expect(await page.getByTestId('finish-pr-link').getAttribute('href')).toBe(
      'https://github.com/octo/stockroom/pull/1',
    );
    expect(await page.getByTestId('repo-link').getAttribute('href')).toBe(
      'https://github.com/octo/stockroom',
    );
    expect(await page.getByTestId('committed').textContent()).toContain(folder);
    await expect.poll(() => page.getByTestId('run-log').textContent(), UI).toContain('run.done');
    await shot(page, 'greenfield-5-done');
    await page.getByTestId('runtab-log').click();
    await page.getByTestId('log-filter').selectOption('warn');
    const warned = await page.getByTestId('run-log').locator('li').allTextContents();
    expect(warned.length).toBeGreaterThan(0);
    expect(
      warned.every((t) => t.includes('parked')),
      warned.join('\n'),
    ).toBe(true);

    // Back home, the run is listed.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await expect.poll(() => page.getByTestId('projects').textContent(), UI).toContain('DONE');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('update: folder → only add the canonical files → review with delta statuses → pull request DONE', async () => {
    const { h, page, errors } = await open();
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    // The folder's origin is not a GitHub URL, so the wizard asks which repository the PR is for.
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-adopt').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-adopt').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('owner-login').inputValue()).toBe('octo');
    const tree = page.getByTestId('tree');
    await expect.poll(() => tree.textContent(), UI).toContain('create');
    expect(await tree.textContent()).toContain('proposed');
    await shot(page, 'brownfield-1-review');
    await page.getByTestId('approve').click();
    await expect.poll(() => state(page).textContent(), { timeout: 60_000 }).toBe('DONE');
    expect(await page.getByTestId('pr-link').getAttribute('href')).toBe(
      'https://github.com/octo/bare-node/pull/1',
    );
    expect(await page.getByTestId('gap-report').textContent()).toContain('Incubator gap report');
    await shot(page, 'brownfield-2-done');
    expect(h.github.repos.get('octo/bare-node')!.prs).toHaveLength(1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('navigation: tabs, breadcrumbs, and back and forward through run, runs and projects', async () => {
    const { h, page, errors } = await open({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    // Nothing to go back to on the first page.
    await expect.poll(() => page.getByTestId('nav-back').isDisabled(), UI).toBe(true);
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    const runUrl = page.url();

    // The run page says where you are; the Runs tab lists it as waiting for you.
    await expect.poll(() => page.getByTestId('crumbs').textContent(), UI).toContain('Projects');
    await page.getByTestId('tab-runs').click();
    await page.waitForURL(/\/runs$/);
    await expect.poll(() => page.getByTestId('runs').textContent(), UI).toContain('PARKED');
    await page.getByTestId('runs-filter-finished').click();
    await expect
      .poll(() => page.getByTestId('runs-page').textContent(), UI)
      .toContain('No runs here.');
    await page.getByTestId('runs-filter-waiting').click();
    await expect
      .poll(() => page.getByTestId('runs').textContent(), UI)
      .toContain(path.basename(dir));

    // Projects lists the project; Back returns to the Runs tab, Back again to the run, Forward reverses it.
    await page.getByTestId('tab-projects').click();
    await page.waitForURL(/\/projects$/);
    await expect
      .poll(() => page.getByTestId('projects').textContent(), UI)
      .toContain(path.basename(dir));
    await page.getByTestId('nav-back').click();
    await page.waitForURL(/\/runs$/);
    await page.getByTestId('nav-back').click();
    await page.waitForURL((u) => u.toString() === runUrl);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    await page.getByTestId('nav-forward').click();
    await page.waitForURL(/\/runs$/);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('settings: shows what is in use, saves a coding model, and the next run uses it and says which model ran', async () => {
    const { h, page, errors } = await open({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await page.getByTestId('tab-settings').click();
    await page.waitForURL(/\/settings$/);
    await expect
      .poll(() => page.getByTestId('in-use-planning').textContent(), UI)
      .toContain('claude-cli');
    expect(await page.getByTestId('in-use-coding').textContent()).toContain('claude');
    // Accounts show where they come from and never a value.
    expect(await page.getByTestId('accounts').textContent()).toContain('github');
    expect(await page.getByTestId('adapters').textContent()).toContain('copilot-cli');

    // A model that could not be a model id is stopped on the page.
    await page.getByTestId('coding-model').fill('--evil');
    expect(await page.getByTestId('save-settings').isDisabled()).toBe(true);
    await page.getByTestId('coding-model').fill('claude-sonnet-5-5');
    await page.getByTestId('save-settings').click();
    await page.getByTestId('settings-saved').waitFor(UI);
    expect(await page.getByTestId('in-use-coding').textContent()).toContain('claude-sonnet-5-5');

    // The next run is coded with it: the log names it, and so does the models line.
    await page.getByTestId('tab-home').click();
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    await page.getByTestId('approve').click();
    await page.getByTestId('commit-request').waitFor({ timeout: 90_000 });
    await expect
      .poll(() => page.getByTestId('models-used').textContent(), UI)
      .toContain('Coding: claude (fake-agent-model)');
    await expect
      .poll(() => page.getByTestId('run-log').textContent(), UI)
      .toContain('coding agent started: claude · claude-sonnet-5-5');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('stop and cancel: stop the coding agent, resume to the commit request, then cancel the run', async () => {
    process.env['FAKE_AGENT_MODE'] = 'slow';
    const { h, page, errors } = await open({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    // Review is waiting for the owner: nothing is running, so there is no Stop, but the run can be cancelled.
    expect(await page.getByTestId('stop').count()).toBe(0);
    expect(await page.getByTestId('cancel-run').count()).toBe(1);
    await page.getByTestId('approve').click();

    // The agent is working: Stop it.
    await page.getByTestId('coding-progress').waitFor({ timeout: 60_000 });
    await shot(page, 'stop-1-coding');
    // A tab picked while the agent works stays picked as the run refreshes (plan 024).
    await page.getByTestId('runtab-log').click();
    const progress = await page.getByTestId('coding-progress').textContent();
    await expect
      .poll(() => page.getByTestId('coding-progress').textContent(), UI)
      .not.toBe(progress);
    expect(await page.getByTestId('runtab-log').getAttribute('aria-selected')).toBe('true');
    await page.getByTestId('stop').click();
    expect(await page.getByTestId('stopped').textContent()).toContain('You stopped this at COMMIT');
    expect(await page.getByTestId('stop').count()).toBe(0);
    await shot(page, 'stop-2-stopped');

    // Resume goes on to the commit request, which says the agent was stopped; its half-done file is listed.
    await page.getByTestId('resume').click();
    await page.getByTestId('commit-request').waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('agent-verdict').textContent()).toContain(
      'You stopped the agent',
    );
    expect(await page.getByTestId('changed-files').textContent()).toContain(
      'src/agent-partial.txt',
    );

    // Cancel asks first; "Keep it" changes nothing, "Yes" ends the run for good.
    await page.getByTestId('cancel-run').click();
    await page.getByTestId('cancel-keep').click();
    expect(await page.getByTestId('cancel-confirm-box').count()).toBe(0);
    expect(await state(page).textContent()).toBe('PARKED');
    await page.getByTestId('cancel-run').click();
    await page.getByTestId('cancel-confirm').click();
    await expect.poll(() => state(page).textContent(), UI).toBe('CANCELLED');
    expect(await page.getByTestId('cancelled').textContent()).toContain('Nothing was deleted');
    expect(await page.getByTestId('commit-request').count()).toBe(0);
    expect(await page.getByTestId('resume').count()).toBe(0);
    await shot(page, 'stop-3-cancelled');

    // Runs lists it under Cancelled, not under Finished.
    await page.getByTestId('tab-runs').click();
    await page.getByTestId('runs-filter-cancelled').click();
    await expect.poll(() => page.getByTestId('runs').textContent(), UI).toContain('CANCELLED');
    await page.getByTestId('runs-filter-finished').click();
    await expect
      .poll(() => page.getByTestId('runs-page').textContent(), UI)
      .toContain('No runs here.');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('review: the owner corrects the plan in words and gets a new plan and brief (plan 021)', async () => {
    const { h, page, errors } = await open({ enhance: 'review-changes' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });

    // The box sits under "What this run will do"; it needs words before it can be sent.
    expect(await page.getByTestId('submit-changes').isDisabled()).toBe(true);
    await page
      .getByTestId('review-changes-text')
      .fill('Also let kitchen staff filter the export by date.');
    await shot(page, 'review-changes-1-typed');
    await page.getByTestId('submit-changes').click();

    // The run drafts the plan again and comes back to review with the new feature and a new brief.
    await expect
      .poll(() => page.getByTestId('brief-headline').textContent(), { timeout: 60_000 })
      .toContain('filtered by date');
    await expect
      .poll(() => page.getByTestId('spec-diff').textContent(), UI)
      .toContain('export-filter');
    await expect
      .poll(() => page.getByTestId('run-log').textContent(), UI)
      .toContain('correction at review: Also let kitchen staff filter the export by date.');
    await shot(page, 'review-changes-2-revised');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('look: the navy bar with the logo, the hero illustration, and the Inter font (plan 023)', async () => {
    const { page, errors } = await open();
    await page.getByTestId('hero').waitFor(UI);
    expect(await page.getByTestId('hero-art').count()).toBe(1);
    expect(await page.locator('.brand svg').count()).toBe(1);
    expect(await page.locator('.tab svg').count()).toBe(4);
    const bar = await page
      .locator('.topbar')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bar).toBe('rgb(30, 41, 59)');
    // why: fonts.check() is true when no @font-face matches at all, so assert a face really loaded.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            await document.fonts.load('16px "Inter Variable"');
            return [...document.fonts].some(
              (f) => f.family === 'Inter Variable' && f.status === 'loaded',
            );
          }),
        UI,
      )
      .toBe(true);
    await shot(page, 'look-1-home');
    await page.getByTestId('tab-runs').click();
    await page.getByTestId('empty').waitFor(UI);
    await shot(page, 'look-2-empty');
    // Dark mode: the active tab keeps dark text on its white pill.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(
        () => page.locator('.topbar').evaluate((el) => getComputedStyle(el).backgroundColor),
        UI,
      )
      .toBe('rgb(15, 23, 42)');
    await expect
      .poll(
        () =>
          page
            .getByTestId('tab-runs')
            .evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]),
        UI,
      )
      .toEqual(['rgb(15, 23, 42)', 'rgb(255, 255, 255)']);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('tabs: the run page opens Plan at review and switches on request; Settings has sections (plan 024)', async () => {
    const { h, page, errors } = await open({ enhance: 'export-orders' });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('runtab-overview').getAttribute('aria-selected')).toBe('true');
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();

    // At review the page opens the Plan tab by itself, and the tab carries a dot.
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('runtab-plan').getAttribute('aria-selected')).toBe('true');
    expect(await page.getByTestId('runtab-plan').locator('.dot').count()).toBe(1);
    await shot(page, 'tabs-1-plan');

    // Files and Log are one click away; the review stays in place behind its tab.
    await page.getByTestId('runtab-files').click();
    await page.getByTestId('tree').waitFor(UI);
    expect(await page.getByTestId('review').isVisible()).toBe(false);
    await shot(page, 'tabs-2-files');
    await page.getByTestId('runtab-log').click();
    await page.getByTestId('run-log').waitFor(UI);
    await page.getByTestId('runtab-plan').click();
    await page.getByTestId('review').waitFor(UI);

    // Settings has section tabs.
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('coding-model').waitFor(UI);
    await page.getByTestId('settingstab-accounts').click();
    await page.getByTestId('accounts').waitFor(UI);
    expect(await page.getByTestId('coding-model').isVisible()).toBe(false);
    await page.getByTestId('settingstab-limits').click();
    await page.getByTestId('gc-days').waitFor(UI);
    await shot(page, 'tabs-3-settings');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('update: a GitHub remote that is not origin is suggested and pre-fills the repository field', async () => {
    const { h, page, errors } = await open();
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await nodeExec.run(
      'git',
      ['remote', 'add', 'github', 'https://github.com/octo/bare-node.git'],
      {
        cwd: dir,
        timeoutMs: 10_000,
      },
    );
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    const field = page.getByTestId('repo-ref');
    await expect.poll(() => field.inputValue(), UI).toBe('octo/bare-node');
    const note = (await page.locator('.warn').allTextContents()).join(' ');
    expect(note).toContain('This is a git repository.');
    expect(note).toContain('The remote "github" points to GitHub (octo/bare-node)');
    // A value the owner typed survives the next check of the same folder.
    await field.fill('octo/other');
    await page.getByTestId('folder-path').fill(`${dir} `);
    await page.getByTestId('folder-path').fill(dir);
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    expect(await field.inputValue()).toBe('octo/other');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('update: a repository with no stack pack (Flutter) is scanned and reviewed, with the canonical files unavailable', async () => {
    const { h, page, errors } = await open({ enhance: 'export-orders', pick: [] });
    const { dir } = await seedAdoptRepo(h, 'flutter-app');
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/flutter-app');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    // The folder check already says why the canonical files are off, and adopt is not offered.
    expect(await page.getByTestId('no-pack').textContent()).toContain('Dart/Flutter');
    expect(await page.getByTestId('enhance-gaps').isDisabled()).toBe(true);
    expect(await page.getByTestId('start-adopt').isDisabled()).toBe(true);
    expect((await page.locator('.warn').allTextContents()).join(' ')).toContain(
      'This is a Dart/Flutter repository, which has no Incubator stack pack.',
    );
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);

    // No park at ANALYZE: the scan is done and the owner is asked what to change.
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('scan-coverage').textContent()).toMatch(
      /^Scanned \d+ of \d+ files/,
    );
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();

    // Review says the stack values are placeholders, and previews the plan without a canonical tree.
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    const note = (await page.getByTestId('no-pack-note').textContent()) ?? '';
    expect(note).toContain('Detected: Dart/Flutter');
    expect(note).toContain('pubspec.yaml');
    expect(note).toContain("doesn't have a stack pack");
    // A plain-English brief sits above the spec, so the owner can read what is proposed.
    await expect
      .poll(() => page.getByTestId('brief-headline').textContent(), UI)
      .toContain("export the day's orders as a CSV file");
    expect(await page.getByTestId('brief-changes').textContent()).toContain('export button');
    expect(await page.getByTestId('brief-approach').textContent()).toContain(
      'Nothing in your repository changes until you approve',
    );
    const above = await page.evaluate(() => {
      const brief = document.querySelector('[data-testid=review-brief]')!.getBoundingClientRect();
      const review = document.querySelector('[data-testid=review]')!.getBoundingClientRect();
      return brief.bottom <= review.top;
    });
    expect(above).toBe(true);
    const tree = page.getByTestId('tree');
    await expect.poll(() => tree.textContent(), UI).toContain('docs/plans/001-enhance-20260501.md');
    expect(await tree.textContent()).not.toContain('CLAUDE.md');

    // The owner decides what the coding agent may run: the proposals are prefilled, never applied
    // on their own. An unsafe line is refused and nothing is approved.
    const editor = page.getByTestId('checks-editor');
    expect(await editor.inputValue()).toBe('flutter analyze\nflutter test');
    const proposed = (await page.getByTestId('checks-proposed').textContent()) ?? '';
    expect(proposed).toContain('pubspec.yaml');
    expect(proposed).toContain('Scans the Dart code for errors and style problems');
    expect(await page.getByTestId('checks').textContent()).toContain(
      'the only commands it is allowed to run',
    );
    await shot(page, 'enhance-other-review');
    await editor.fill('flutter test; rm -rf .');
    await page.getByTestId('approve').click();
    await expect
      .poll(() => page.getByTestId('review-error').textContent(), UI)
      .toContain('check commands refused');
    expect(await state(page).textContent()).not.toBe('DONE');
    await editor.fill('flutter analyze\nflutter test');
    await page.getByTestId('approve').click();

    // The agent coded in the folder with exactly those commands; the commit request says so.
    await page.getByTestId('commit-request').waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('agent-checks').textContent()).toContain(
      'flutter analyze, flutter test',
    );
    const runId = page.url().split('/').pop()!;
    const launch = h.engine.entries(runId).findLast((e) => e.type === 'handoff.launch')!;
    expect(launch['checks']).toEqual({
      mode: 'approved',
      commands: ['flutter analyze', 'flutter test'],
    });
    await shot(page, 'enhance-other-commit');
    // The console shows the refused request (HTTP 4xx) and nothing else.
    expect(
      errors.filter((e) => !/Failed to load resource/.test(e)),
      errors.join('\n'),
    ).toEqual([]);
  });

  it('update: browse to the repository → scan → what to change → review → the agent codes in the folder → commit → push → DONE', async () => {
    const { h, page, errors } = await open({ enhance: 'export-orders', pick: [] });
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    const mainBefore = (await h.github.getBranchSha({ owner: 'octo', name: 'bare-node' }, 'main'))!;
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await page.getByTestId('repo-ref').fill('octo/bare-node');
    await expect.poll(() => page.getByTestId('start-enhance').isDisabled(), UI).toBe(false);
    await page.getByTestId('start-enhance').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);

    // The scan is done; the owner says what to change.
    await page.getByTestId('change-request').waitFor({ timeout: 30_000 });
    // The run is filed under a project, shown at the top of the page.
    await expect
      .poll(() => page.getByTestId('project-banner').textContent(), UI)
      .toContain(path.basename(dir));
    expect(await page.getByTestId('scan-coverage').textContent()).toMatch(
      /^Scanned \d+ of \d+ files/,
    );
    expect(await page.getByTestId('submit-request').isDisabled()).toBe(true);
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await shot(page, 'enhance-1-request');
    await page.getByTestId('submit-request').click();

    // Review previews the delivery, not the canonical tree.
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    const tree = page.getByTestId('tree');
    await expect.poll(() => tree.textContent(), UI).toContain('docs/plans/001-enhance-20260501.md');
    expect(await tree.textContent()).not.toContain('CLAUDE.md');
    await page.getByTestId('runtab-files').click();
    await tree
      .getByRole('button', { name: 'docs/plans/001-enhance-20260501.md', exact: true })
      .click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Step 1');
    await shot(page, 'enhance-2-review');
    await page.getByTestId('runtab-plan').click();
    await page.getByTestId('approve').click();

    // The agent works in the owner's folder; the run then asks for the commit.
    await page.getByTestId('commit-request').waitFor({ timeout: 90_000 });
    expect(await page.getByTestId('changed-files').textContent()).toContain('src/agent-work.txt');
    expect(await page.getByTestId('commit-message').inputValue()).toMatch(
      /^feat: Export the day's orders as CSV/,
    );
    expect(await page.getByTestId('commit-identity').textContent()).toContain(
      'incubator/enhance-20260501',
    );
    await shot(page, 'enhance-3-commit');
    await page.getByTestId('commit').click();
    await page.getByTestId('push-request').waitFor({ timeout: 60_000 });
    expect(await page.getByTestId('push-request').textContent()).toContain('octo/bare-node');
    await shot(page, 'enhance-4-push');
    await page.getByTestId('push').click();

    await expect.poll(() => state(page).textContent(), { timeout: 60_000 }).toBe('DONE');
    expect(await page.getByTestId('finish-pr-link').getAttribute('href')).toBe(
      'https://github.com/octo/bare-node/pull/1',
    );
    expect(await page.getByTestId('requests').textContent()).toContain('export-orders');
    expect(await page.getByTestId('plan-path').textContent()).toBe(
      'docs/plans/001-enhance-20260501.md',
    );
    await shot(page, 'enhance-5-done');
    // GitHub's main is untouched; the owner's folder is on the update branch.
    expect(await h.github.getBranchSha({ owner: 'octo', name: 'bare-node' }, 'main')).toBe(
      mainBefore,
    );
    expect(h.github.repos.get('octo/bare-node')!.prs).toHaveLength(1);

    // The portfolio lists the project with this run in its history; "Update again" starts again at the
    // scan, in the same folder, and the new run joins the same project.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await page.locator('.project-card').first().click();
    await page.waitForURL(/\/projects\/[\w-]+$/);
    await expect.poll(() => page.getByTestId('project-runs').textContent(), UI).toContain('DONE');
    await shot(page, 'enhance-6-project');
    await page.getByTestId('project-update').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await expect
      .poll(() => page.getByTestId('project-banner').textContent(), UI)
      .toContain('2 runs so far');
    await expect
      .poll(
        () => page.locator('[data-testid="change-request"], [data-testid="parked"]').count(),
        UI,
      )
      .toBeGreaterThan(0);
    // Choosing the same folder in the wizard again says the Incubator knows it.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await intent(page).selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('folder-path').fill(dir);
    await expect
      .poll(() => page.getByTestId('recognised').textContent(), UI)
      .toContain(path.basename(dir));
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('a page on another origin cannot drive the API, and a reused launch link is refused', async () => {
    const { server, h, page } = await open();
    const evil = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><title>evil</title>');
    });
    await new Promise<void>((r) => evil.listen(0, '127.0.0.1', r));
    const port = (evil.address() as { port: number }).port;
    try {
      await page.goto(`http://127.0.0.1:${port}/`);
      const results = await page.evaluate(async (api) => {
        const out: string[] = [];
        for (const init of [
          {
            method: 'POST',
            mode: 'no-cors',
            credentials: 'include',
            headers: { 'content-type': 'text/plain' },
            body: '{"kind":"new","narrative":"x"}',
          },
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: '{"kind":"new","narrative":"x"}',
          },
          { method: 'GET', credentials: 'include' },
        ] as RequestInit[]) {
          try {
            const r = await fetch(`${api}/api/runs`, init);
            out.push(`status ${r.status} ${r.type}`);
          } catch (e) {
            out.push(`blocked ${(e as Error).name}`);
          }
        }
        return out;
      }, server.origin);
      // Opaque or blocked: the page can read nothing, and no run was created.
      expect(results.every((r) => r.startsWith('blocked') || r.includes('opaque'))).toBe(true);
      expect(h.store.list()).toEqual([]);
    } finally {
      await new Promise((r) => evil.close(r));
    }
    const again = await page.goto(server.url);
    expect(again?.status()).toBe(401);
  });
});
