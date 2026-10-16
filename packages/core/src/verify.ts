import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { Exec } from '@incubator/runtime';
import type { VerifyResult } from './publish.js';

const INSTALL_TIMEOUT = 15 * 60_000;
const CHECK_TIMEOUT = 20 * 60_000;

/** Install commands a rendered repository needs, from the manifests it contains. */
export function installCommands(dir: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  if (existsSync(path.join(dir, 'package.json'))) out.push(['pnpm', ['install']]);
  if (existsSync(path.join(dir, 'pyproject.toml'))) out.push(['uv', ['sync']]);
  if (existsSync(path.join(dir, 'composer.json')))
    out.push(['composer', ['install', '--no-interaction', '--no-progress']]);
  return out;
}

/** One install command run before the agent codes (plan 056): `ok`, `failed`, or `missing` (the installer is not on PATH). */
export interface InstallRun {
  command: string;
  result: 'ok' | 'failed' | 'missing';
  /** Empty when ok; otherwise one line saying what went wrong. */
  note: string;
}

/**
 * Plan 056: installs the dependencies a rendered repository needs, from its manifests, so the agent's first gate run
 * has its tools. Never throws: a problem is the result, because the agent can still work without the install.
 */
export async function installDependencies(
  exec: Exec,
  dir: string,
  signal?: AbortSignal,
): Promise<InstallRun[]> {
  const out: InstallRun[] = [];
  for (const [cmd, args] of installCommands(dir)) {
    const command = `${cmd} ${args[0]}`;
    if (!(await exec.which(cmd))) {
      out.push({ command, result: 'missing', note: `${cmd} is not installed` });
      continue;
    }
    try {
      const r = await exec.run(cmd, args, {
        cwd: dir,
        timeoutMs: INSTALL_TIMEOUT,
        ...(signal ? { signal } : {}),
      });
      out.push(
        r.code === 0
          ? { command, result: 'ok', note: '' }
          : { command, result: 'failed', note: `${command} exited ${r.code ?? 'abnormally'}` },
      );
    } catch {
      out.push({ command, result: 'failed', note: `${command} could not run` });
    }
  }
  return out;
}

/**
 * VERIFY for real: install each repository's toolchain and run its own `check quick` (TDD §7.1).
 * The paired tests repository runs against the application copied to `app/`, as its CI does.
 */
export function createCommandVerifier(exec: Exec, profile: 'quick' | 'full' = 'quick') {
  const runIn = async (dir: string): Promise<{ ok: boolean; line: string }> => {
    for (const [cmd, args] of installCommands(dir)) {
      if (!(await exec.which(cmd)))
        return { ok: false, line: `${path.basename(dir)}: ${cmd} is not installed` };
      const r = await exec.run(cmd, args, { cwd: dir, timeoutMs: INSTALL_TIMEOUT });
      if (r.code !== 0)
        return { ok: false, line: `${path.basename(dir)}: ${cmd} ${args[0]} exited ${r.code}` };
    }
    const r = await exec.run(process.execPath, ['scripts/check.mjs', profile], {
      cwd: dir,
      timeoutMs: CHECK_TIMEOUT,
    });
    const failed = r.stdout
      .split('\n')
      .filter((l) => /^[✖💥]/u.test(l))
      .map((l) => l.replace(/\s+/g, ' ').trim());
    return {
      ok: r.code === 0,
      line: `${path.basename(dir)}: check ${profile} exit ${r.code}${failed.length ? ` (${failed.join('; ')})` : ''}`,
    };
  };
  return async (dirs: { app: string; paired?: string }): Promise<VerifyResult> => {
    const lines: string[] = [];
    const app = await runIn(dirs.app);
    lines.push(app.line);
    let ok = app.ok;
    if (dirs.paired) {
      const target = path.join(dirs.paired, 'app');
      mkdirSync(target, { recursive: true });
      cpSync(dirs.app, target, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|\.git|vendor|\.venv)$/.test(src),
      });
      for (const [cmd, args] of installCommands(target)) {
        const r = await exec.run(cmd, args, { cwd: target, timeoutMs: INSTALL_TIMEOUT });
        if (r.code !== 0) {
          lines.push(`app copy: ${cmd} ${args[0]} exited ${r.code}`);
          ok = false;
        }
      }
      const tests = await runIn(dirs.paired);
      lines.push(tests.line);
      ok &&= tests.ok;
    }
    return { ok, summary: lines.join('; ') };
  };
}
