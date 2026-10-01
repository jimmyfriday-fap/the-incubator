/// <reference lib="dom" />
import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { _electron, type ElectronApplication } from 'playwright-core';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_FAKES_FLAG } from '../src/window.js';

// Targets: a packaged executable from electron-builder (CI), or a staged app directory run by the
// electron binary (local). Build them first: `pnpm --filter @incubator/desktop bundle` (release) and
// `INCUBATOR_TEST_BUILD=1 pnpm --filter @incubator/desktop bundle` (test build).
const desktop = path.resolve(import.meta.dirname, '..');
const electronBin = createRequire(path.join(desktop, 'package.json'))(
  'electron',
) as unknown as string;
const asRoot = process.getuid?.() === 0;

function target(kind: 'release' | 'test'): { executablePath: string; args: string[] } {
  const exe =
    process.env[kind === 'release' ? 'INCUBATOR_DESKTOP_EXE' : 'INCUBATOR_DESKTOP_TEST_EXE'];
  // why: Chromium's sandbox cannot start as root (containers); CI runs as a normal user.
  const extra = asRoot ? ['--no-sandbox'] : [];
  if (exe) return { executablePath: exe, args: extra };
  const dir = path.join(desktop, kind === 'release' ? 'app' : 'app-test');
  if (!existsSync(path.join(dir, 'dist', 'main.mjs')))
    throw new Error(`${dir} is not staged: run the desktop bundle script first`);
  return { executablePath: electronBin, args: [...extra, dir] };
}

// why: a wedged app must not hang the suite; close politely, then kill what is left. The child
// process handle is taken at launch (Playwright cannot hand it out after close).
const running: { app: ElectronApplication; proc: ReturnType<ElectronApplication['process']> }[] =
  [];
async function stop(r: (typeof running)[number]): Promise<void> {
  await Promise.race([
    r.app.close().catch(() => undefined),
    new Promise((res) => setTimeout(res, 15_000)),
  ]);
  if (r.proc.exitCode === null && r.proc.signalCode === null) r.proc.kill('SIGKILL');
}
afterEach(async () => {
  await Promise.all(running.splice(0).map(stop));
});

// The owner's git identity and the fake agent's behaviour for a launch (the machine's own git
// configuration is not consulted).
function ownerGit(): Record<string, string> {
  const cfg = path.join(mkdtempSync(path.join(os.tmpdir(), 'desktop gitcfg ')), 'gitconfig');
  writeFileSync(cfg, '[user]\n\tname = Owner Person\n\temail = owner@example.invalid\n');
  return { GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', FAKE_AGENT_MODE: 'edit' };
}

// Each launch gets its own home and userData, so the single-instance lock is never shared.
const isolated = () => ({
  INCUBATOR_HOME: mkdtempSync(path.join(os.tmpdir(), 'desktop-home-')),
  INCUBATOR_DESKTOP_USER_DATA: mkdtempSync(path.join(os.tmpdir(), 'desktop-data-')),
});

async function launch(
  kind: 'release' | 'test',
  args: string[] = [],
  env: Record<string, string> = {},
) {
  const t = target(kind);
  const app = await _electron.launch({
    executablePath: t.executablePath,
    args: [...t.args, ...args],
    env: { ...process.env, ...isolated(), ...env, ELECTRON_ENABLE_LOGGING: '0' },
    timeout: 60_000,
  });
  running.push({ app, proc: app.process() });
  return app;
}

describe('desktop smoke', () => {
  it('release build: launches, locks the renderer down and shows the app', async () => {
    const app = await launch('release');
    const page = await app.firstWindow();
    await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await page.getByTestId('intent').waitFor();
    // No Node in the renderer (nodeIntegration off, context isolation on, no preload).
    expect(
      await page.evaluate(() => typeof (globalThis as Record<string, unknown>)['require']),
    ).toBe('undefined');
    expect(
      await page.evaluate(() => typeof (globalThis as Record<string, unknown>)['process']),
    ).toBe('undefined');
    // New windows are denied; off-origin navigation is blocked.
    expect(await page.evaluate(() => window.open('https://example.com/') === null)).toBe(true);
    const before = page.url();
    await page.evaluate(() => {
      window.location.href = 'https://example.com/';
    });
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
    expect(app.windows()).toHaveLength(1);
  });

  it('release build: refuses the test-fakes flag', async () => {
    const t = target('release');
    const { nodeExec } = await import('@incubator/runtime');
    const r = await nodeExec.run(t.executablePath, [...t.args, TEST_FAKES_FLAG], {
      timeoutMs: 60_000,
      env: isolated(),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('is refused: this is not a test build');
  });

  it('test build: a new solution in a chosen folder goes from the dropdown to a pushed pull request', async () => {
    // The folder has a space, as on the owner's machine, and does not exist yet.
    const folder = path.join(mkdtempSync(path.join(os.tmpdir(), 'new repo ')), 'stock room');
    const app = await launch('test', [TEST_FAKES_FLAG], {
      INCUBATOR_TEST_PICK_FOLDER: folder,
      ...ownerGit(),
    });
    const page = await app.firstWindow();
    await page.getByTestId('intent').selectOption({ label: 'New solution' });
    await page.getByTestId('pick-folder').click();
    await expect
      .poll(() => page.getByTestId('folder-path').inputValue(), { timeout: 30_000 })
      .toBe(folder);
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), { timeout: 30_000 })
      .toContain('will be created');
    await page
      .getByTestId('narrative')
      .fill(
        'Stockroom: a web app for independent cafés to track stock levels and get reorder alerts.',
      );
    await page.getByTestId('start-new').click();
    await page.getByTestId('questions').waitFor({ timeout: 30_000 });
    await page.getByTestId('accept-defaults').click();
    await page.getByTestId('review').waitFor({ timeout: 30_000 });
    await page.getByTestId('owner-login').fill('octo');
    await page.getByTestId('approve').click();
    // The agent codes in the folder; the owner then approves the commit, and the push.
    await page.getByTestId('commit-request').waitFor({ timeout: 90_000 });
    expect(await page.getByTestId('changed-files').textContent()).toContain('src/agent-work.txt');
    await page.getByTestId('commit').click();
    await page.getByTestId('push-request').waitFor({ timeout: 60_000 });
    await page.getByTestId('push').click();
    await expect
      .poll(() => page.getByTestId('run-state').textContent(), { timeout: 90_000 })
      .toBe('DONE');
    expect(await page.getByTestId('repo-link').getAttribute('href')).toBe(
      'https://github.com/octo/stockroom',
    );
    expect(await page.getByTestId('finish-pr-link').getAttribute('href')).toBe(
      'https://github.com/octo/stockroom/pull/1',
    );
    expect(existsSync(path.join(folder, '.git'))).toBe(true);
    expect(existsSync(path.join(folder, 'src', 'agent-work.txt'))).toBe(true);
    await page.screenshot({ path: path.resolve(desktop, '../../.reports/desktop-smoke.png') });
  });

  it('test build: updates a local repository whose path has a space, committing on a new branch', async () => {
    // A path with a space, as on the owner's machine: it must survive the UI, the clone and git.
    const src = path.join(mkdtempSync(path.join(os.tmpdir(), 'enhance repo ')), 'order desk');
    cpSync(path.resolve(desktop, '../../packages/analyzer/fixtures/bare-node'), src, {
      recursive: true,
      filter: (f) => !f.endsWith('expected-gap-report.json'),
    });
    const { nodeExec } = await import('@incubator/runtime');
    const env = { ...process.env, ...ownerGit() };
    const git = (...args: string[]) =>
      nodeExec.run('git', args, { cwd: src, timeoutMs: 30_000, env });
    for (const args of [
      ['init', '-q', '-b', 'main'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'existing'],
    ])
      expect((await git(...args)).code).toBe(0);

    const app = await launch('test', [TEST_FAKES_FLAG], {
      INCUBATOR_TEST_FIXTURE: 'enhance:export-orders',
      INCUBATOR_TEST_PICK_FOLDER: src,
      ...ownerGit(),
    });
    const page = await app.firstWindow();
    await page.getByTestId('intent').selectOption({ label: 'Update an existing solution' });
    await page.getByTestId('pick-folder').click();
    await expect
      .poll(() => page.getByTestId('folder-ok').textContent(), { timeout: 30_000 })
      .toContain('working tree clean');
    await page.getByTestId('start-enhance').click();
    await page.getByTestId('change-request').waitFor({ timeout: 60_000 });
    await page
      .getByTestId('request-text')
      .fill('Kitchen staff need to export the orders list as a CSV file at the end of the day.');
    await page.getByTestId('submit-request').click();
    await page.getByTestId('review').waitFor({ timeout: 60_000 });
    // A local repository has no GitHub origin to take the owner from, so the review asks for it.
    await page.getByTestId('owner-login').fill('octo');
    await page.getByTestId('approve').click();
    await page.getByTestId('commit-request').waitFor({ timeout: 90_000 });
    expect(await page.getByTestId('changed-files').textContent()).toContain('src/agent-work.txt');
    // The owner's own branch is untouched until the delivery branch is committed.
    await page.getByTestId('commit').click();
    // Nothing to push to (no GitHub origin), so the run ends with the commit kept locally.
    await expect
      .poll(() => page.getByTestId('run-state').textContent(), { timeout: 90_000 })
      .toBe('DONE');
    await page.getByTestId('committed').waitFor();
    expect((await git('branch', '--show-current')).stdout.trim()).toBe(
      'incubator/enhance-20260501',
    );
    expect((await git('status', '--porcelain')).stdout).toBe('');
    expect((await git('log', '--format=%an', '-1')).stdout.trim()).toBe('Owner Person');
    await page.screenshot({
      path: path.resolve(desktop, '../../.reports/desktop-smoke-enhance.png'),
    });
  });
});
