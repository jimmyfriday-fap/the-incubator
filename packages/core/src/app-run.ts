import type { Exec } from '@incubator/runtime';
import { standUpSteps, type StandUpFacts, type StandUpStep } from './standup.js';

/** Plan 064: the address a finished project answers on once it is up; null for a stack with nothing to open. */
export function appUrl(f: Pick<StandUpFacts, 'pack'>): string | null {
  if (f.pack === 'wordpress') return 'http://localhost:8080';
  if (f.pack === 'node-web') return 'http://localhost:3000';
  if (f.pack === 'python-service') return 'http://localhost:8000';
  return null;
}

const CHECK_QUICK = 'node scripts/check.mjs quick';

/**
 * Plan 064: the stand-up steps that bring the project up, in order: the stand-up guide's steps without the project's
 * own check, plus a last step that starts the app in Docker for the stacks whose guide leaves it to a terminal.
 */
export function appRunSteps(f: StandUpFacts): StandUpStep[] {
  const steps = standUpSteps(f).filter((s) => s.command !== CHECK_QUICK);
  if (f.pack === 'node-web' || f.pack === 'python-service')
    steps.push({
      title: 'Start the app',
      command: 'docker compose up -d --build',
      expect: 'The command exits 0.',
      source: '',
    });
  return steps;
}

/** What one step did: the journal keeps these. */
export interface AppStepResult {
  title: string;
  ok: boolean;
  code: number | null;
  /** The last lines of what the step printed, for the owner when it failed. */
  tail: string;
}

const STEP_TIMEOUT = 15 * 60_000;

const lastLines = (text: string): string =>
  text.trim().split(/\r?\n/).slice(-8).join('\n').slice(-800);

/**
 * Runs the steps one at a time through PowerShell (`pwsh` off Windows) and stops at the first that fails. A missing
 * PowerShell fails the first step rather than throwing.
 */
export async function runAppSteps(
  exec: Exec,
  dir: string,
  steps: readonly StandUpStep[],
  signal: AbortSignal | undefined,
  onStep: (r: AppStepResult) => void,
): Promise<boolean> {
  const shell = process.platform === 'win32' ? 'powershell' : 'pwsh';
  for (const step of steps) {
    let result: AppStepResult;
    if (!(await exec.which(shell))) {
      result = { title: step.title, ok: false, code: null, tail: `${shell} is not installed` };
    } else {
      try {
        const r = await exec.run(
          shell,
          ['-NoProfile', '-NonInteractive', '-Command', `${step.command}; exit $LASTEXITCODE`],
          { cwd: dir, timeoutMs: STEP_TIMEOUT, ...(signal ? { signal } : {}) },
        );
        result = {
          title: step.title,
          ok: r.code === 0 && !r.timedOut && !r.aborted,
          code: r.code,
          tail: lastLines(`${r.stdout}\n${r.stderr}`),
        };
      } catch {
        result = { title: step.title, ok: false, code: null, tail: 'the command could not run' };
      }
    }
    onStep(result);
    if (!result.ok) return false;
  }
  return true;
}

/**
 * Plan 066: before a start, a failed step when something already answers on the project's address (another app
 * or container holds the port, and the readiness check would mistake it for the project); null when it is free.
 */
export async function addressInUse(
  url: string | null,
  ping: ((url: string) => Promise<boolean>) | undefined,
): Promise<AppStepResult | null> {
  if (!url || !ping) return null;
  if (!(await ping(url).catch(() => false))) return null;
  return {
    title: 'Check the address is free',
    ok: false,
    code: null,
    tail: `Something else already answers on ${url}. Stop that app or container, then start again.`,
  };
}

/** True once the project's address answers with anything below 500, within the time given. */
export async function waitForUrl(
  url: string,
  ping: (url: string) => Promise<boolean>,
  waitMs: number,
  pauseMs = 2000,
): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    if (await ping(url).catch(() => false)) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, pauseMs));
  }
}
