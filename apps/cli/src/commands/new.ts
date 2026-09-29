import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DefaultsPrompter,
  NonInteractivePrompter,
  type Prompter,
  type RunState,
} from '@incubator/core';
import { ExitCode, PolicyError, fileSink } from '@incubator/runtime';
import { isLlmAdapterId } from '@incubator/llm';
import { serializeSpec, type IncubatorSpec } from '@incubator/spec';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';
import { TerminalPrompter } from '../prompter.js';
import { summarizeSpec } from '../summary.js';

export interface NewOptions {
  prompt?: string;
  promptFile?: string;
  specOnly?: boolean;
  yes?: boolean;
  out?: string;
  adapter?: string;
}

export function choosePrompter(io: Io, yes: boolean | undefined): Prompter {
  if (yes) return new DefaultsPrompter();
  return io.isTTY ? new TerminalPrompter(io) : new NonInteractivePrompter();
}

/** Prints the outcome of an advance() and returns the exit code. */
export function reportRun(deps: CliDeps, io: Io, state: RunState, out?: string): number {
  if (state.state === 'PARKED') {
    io.stderr(
      `⏸ run ${state.runId} parked at ${state.parked?.state ?? '?'}: ${state.parked?.message ?? ''}\n`,
    );
    io.stderr(
      `  resume with: incubator resume ${state.runId}${state.parked?.reason === 'needs_input' || state.parked?.reason === 'needs_review' ? ' (interactively, or add --yes)' : ''}\n`,
    );
    return ExitCode.Policy;
  }
  const spec = deps.engine.draft(state.runId) as unknown as IncubatorSpec;
  const text = serializeSpec(spec);
  if (state.state === 'DONE' || state.state === 'APPROVED') {
    if (out) {
      writeFileSync(path.resolve(out), text);
      io.stderr(
        `✔ spec approved (run ${state.runId})\n${summarizeSpec(spec)}\nwritten    ${out}\n`,
      );
    } else {
      io.stderr(`✔ spec approved (run ${state.runId})\n${summarizeSpec(spec)}\n`);
      io.stdout(text);
    }
    return ExitCode.Ok;
  }
  io.stderr(`run ${state.runId} stopped at ${state.state}\n`);
  return ExitCode.Ok;
}

export async function runNew(deps: CliDeps, io: Io, opts: NewOptions): Promise<number> {
  if (opts.prompt && opts.promptFile)
    throw new PolicyError('use either --prompt or --prompt-file, not both', { code: 'usage' });
  const narrative = opts.promptFile
    ? readFileSync(path.resolve(opts.promptFile), 'utf8')
    : opts.prompt;
  if (!narrative?.trim())
    throw new PolicyError('a narrative is required: --prompt "…" or --prompt-file <path>', {
      code: 'usage',
    });
  if (opts.adapter && !isLlmAdapterId(opts.adapter))
    throw new PolicyError(`unknown adapter ${opts.adapter}`, { code: 'usage' });
  if (!opts.specOnly) {
    throw new PolicyError(
      'this build supports `incubator new --spec-only`; scaffolding arrives with `incubator scaffold`',
      { code: 'usage' },
    );
  }
  const runId = deps.engine.start({
    kind: 'new',
    narrative: narrative.trim(),
    specOnly: true,
    yes: Boolean(opts.yes),
    ...(opts.adapter ? { adapter: opts.adapter } : {}),
    surface: 'cli',
  });
  deps.log.addSink(fileSink(path.join(deps.store.runDir(runId), 'logs', 'incubator.log')));
  io.stderr(`▶ run ${runId}\n`);
  const state = await deps.engine.advance(runId, choosePrompter(io, opts.yes));
  return reportRun(deps, io, state, opts.out);
}
