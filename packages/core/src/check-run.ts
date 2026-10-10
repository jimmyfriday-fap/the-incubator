import { existsSync } from 'node:fs';
import path from 'node:path';
import { InterruptedError, PolicyError } from '@incubator/runtime';
import { STACK_CATALOG } from '@incubator/spec';
import { validateChecks } from './checks.js';
import { cleanAgentText } from './handoff.js';
import { locateTool, type ToolsDeps } from './stacks.js';

/** One approved check command, run by the Incubator itself after the agent stops (plan 041). */
export interface CheckRun {
  command: string;
  /** `missing`: the program is not installed here, so the work is unverified, not failed. */
  result: 'passed' | 'failed' | 'missing';
  exitCode: number | null;
  /** The end of its output, for the owner and for the agent's next part. */
  tail: string;
}

/** How long one check may run: a full Flutter test run or a Docker-backed SQL suite takes minutes. */
export const CHECK_TIMEOUT_MS = 20 * 60_000;

/**
 * Where a check's program runs from: a catalog tool found off PATH (for example `flutter` under the
 * owner's home), Git's own bash on Windows (never WSL's), or PATH. Null when it is not installed.
 */
export async function checkProgram(
  program: string,
  tools: ToolsDeps,
  platform: NodeJS.Platform = process.platform,
): Promise<{ bin: string; batch: boolean } | null> {
  // why: the validator lowercases the program and drops `.exe`, so `BASH` and `bash.exe` must resolve the same way.
  const name = program.toLowerCase().replace(/\.exe$/, '');
  const pre = STACK_CATALOG.flatMap((s) => s.prerequisites ?? []).find((p) => p.tool === name);
  if (pre) {
    const loc = await locateTool(pre, tools);
    return loc ? { bin: loc.path, batch: true } : null;
  }
  if (name === 'bash' && platform === 'win32') {
    // why: the bash.exe under Windows' System32 is WSL; the agent's shell, and the scripts' bash, is Git's.
    const git = await tools.exec.which('git');
    if (!git) return null;
    for (const up of ['..', path.join('..', '..')]) {
      const candidate = path.resolve(path.dirname(git.path), up, 'bin', 'bash.exe');
      if (existsSync(candidate)) return { bin: candidate, batch: false };
    }
    return null;
  }
  const found = await tools.exec.which(program);
  return found ? { bin: found.path, batch: true } : null;
}

function tailOf(text: string, timedOut: boolean): string {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n').slice(-40).join('\n');
  const body = cleanAgentText(lines.length > 4000 ? lines.slice(-4000) : lines, 4000) ?? '';
  return timedOut ? `timed out\n${body}` : body;
}

/** Runs each approved check command in `cwd`, in order, with no shell (plan 041). */
export async function runChecks(
  commands: readonly string[],
  cwd: string,
  tools: ToolsDeps,
  opts: { env?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CheckRun[]> {
  // why: these commands run on the owner's computer, so the approval rules are checked again here.
  if (validateChecks(commands).length > 0)
    throw new PolicyError('check commands refused', { code: 'check_command' });
  const runs: CheckRun[] = [];
  for (const command of commands) {
    const [program, ...args] = command.split(' ');
    // why: `./gradlew test` names a file in the repository, so it is looked up from the folder it runs in.
    const prog = await checkProgram(
      program!.includes('/') ? path.resolve(cwd, program!) : program!,
      tools,
    );
    if (!prog) {
      runs.push({
        command,
        result: 'missing',
        exitCode: null,
        tail: `${program!} was not found on this computer`,
      });
      continue;
    }
    try {
      const r = await tools.exec.run(prog.bin, args, {
        cwd,
        timeoutMs: opts.timeoutMs ?? CHECK_TIMEOUT_MS,
        allowBatch: prog.batch,
        ...(opts.env ? { env: opts.env } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      // why: a stop pressed while a check runs resolves as an aborted exit, not a throw.
      if (r.aborted) throw new InterruptedError(`${command} was stopped`);
      runs.push({
        command,
        result: r.code === 0 && !r.timedOut ? 'passed' : 'failed',
        exitCode: r.code,
        tail: tailOf(`${r.stdout}\n${r.stderr}`, r.timedOut),
      });
    } catch (err) {
      if (err instanceof InterruptedError) throw err;
      runs.push({
        command,
        result: 'failed',
        exitCode: null,
        tail: tailOf(err instanceof Error ? err.message : String(err), false),
      });
    }
  }
  return runs;
}
