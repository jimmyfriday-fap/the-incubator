import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright-core';
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
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

async function open() {
  const { server, h } = await startFakeServer({ uiDir: UI_DIR });
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

describe('web UI (Playwright, fakes)', () => {
  it('greenfield: narrative → questions → review with diff and owner → published DONE', async () => {
    const { server, h, page, errors } = await open();
    // The launch token was exchanged for a cookie and is gone from the address bar.
    expect(page.url()).toBe(`${server.origin}/`);
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
    await expect.poll(() => page.getByTestId('spec-diff').locator('tr').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('decisions').locator('li').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('decisions').textContent()).toMatch(/user|inferred|default/);
    await page.getByTestId('diff-from').selectOption('0');
    await expect.poll(() => page.getByTestId('spec-diff').textContent()).toContain('/project/slug');
    // The tree preview exists at REVIEW and opens files from memory.
    await page.getByTestId('tree').getByRole('button', { name: 'CLAUDE.md', exact: true }).click();
    await expect.poll(() => page.getByTestId('file-view').textContent()).toContain('Stockroom');

    expect(await page.getByTestId('approve').isDisabled()).toBe(true);
    await page.getByTestId('owner-login').fill('octo');
    await shot(page, 'greenfield-2-review');
    expect(await page.getByTestId('spec-editor').inputValue()).toContain('"login": "octo"');
    await page.getByTestId('approve').click();

    await expect.poll(() => state(page).textContent(), { timeout: 60_000 }).toBe('DONE');
    const link = page.getByTestId('repo-link');
    expect(await link.getAttribute('href')).toBe('https://github.com/octo/stockroom');
    expect(h.github.repos.has('octo/stockroom')).toBe(true);
    await expect.poll(() => page.getByTestId('run-log').textContent()).toContain('run.done');
    await shot(page, 'greenfield-3-done');
    await page.getByTestId('log-filter').selectOption('warn');
    const warned = await page.getByTestId('run-log').locator('li').allTextContents();
    expect(warned.length).toBeGreaterThan(0);
    expect(warned.every((t) => t.includes('parked'))).toBe(true);

    // Back home, the run is listed.
    await page.getByRole('link', { name: 'The Incubator' }).click();
    await expect.poll(() => page.getByTestId('runs').textContent()).toContain('DONE');
    expect(errors, errors.join('\n')).toEqual([]);
  });

  it('brownfield: repository → review with delta statuses → pull request DONE', async () => {
    const { h, page, errors } = await open();
    const { dir } = await seedAdoptRepo(h, 'bare-node');
    await page.getByTestId('adopt-repo').fill(dir);
    await page.getByTestId('adopt-ref').fill('octo/bare-node');
    await page.getByTestId('start-adopt').click();
    await page.waitForURL(/\/runs\/[\w-]+$/);
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    expect(await page.getByTestId('owner-login').inputValue()).toBe('octo');
    const tree = page.getByTestId('tree');
    await expect.poll(() => tree.textContent()).toContain('create');
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
