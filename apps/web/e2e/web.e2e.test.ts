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
  page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
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
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function open(opts: { enhance?: string; pick?: string[] } = {}) {
  const picks = [...(opts.pick ?? [])];
  const { server, h } = await startFakeServer({
    uiDir: UI_DIR,
    ...(opts.enhance ? { enhance: opts.enhance } : {}),
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
  return { server, h, page, errors };
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
    await page.getByTestId('tree').getByRole('button', { name: 'CLAUDE.md', exact: true }).click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Stockroom');

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
    await page.getByTestId('log-filter').selectOption('warn');
    const warned = await page.getByTestId('run-log').locator('li').allTextContents();
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.every((t) => t.includes('parked'))).toBe(true);

    // Back home, the run is listed.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await expect.poll(() => page.getByTestId('runs').textContent(), UI).toContain('DONE');
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
    expect(await page.getByTestId('no-pack-note').textContent()).toContain(
      'no Incubator stack pack',
    );
    const tree = page.getByTestId('tree');
    await expect.poll(() => tree.textContent(), UI).toContain('docs/plans/001-enhance-20260501.md');
    expect(await tree.textContent()).not.toContain('CLAUDE.md');

    // The owner decides what the coding agent may run: the proposals are prefilled, never applied
    // on their own. An unsafe line is refused and nothing is approved.
    const editor = page.getByTestId('checks-editor');
    expect(await editor.inputValue()).toBe('flutter analyze\nflutter test');
    expect(await page.getByTestId('checks-proposed').textContent()).toContain('pubspec.yaml');
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
    await tree
      .getByRole('button', { name: 'docs/plans/001-enhance-20260501.md', exact: true })
      .click();
    await expect.poll(() => page.getByTestId('file-view').textContent(), UI).toContain('Step 1');
    await shot(page, 'enhance-2-review');
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

    // Recent runs offers "Update again"; it starts again at the scan, in the same folder.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await page.locator('[data-testid^="enhance-2"]').first().click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await expect
      .poll(
        () => page.locator('[data-testid="change-request"], [data-testid="parked"]').count(),
        UI,
      )
      .toBeGreaterThan(0);
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
