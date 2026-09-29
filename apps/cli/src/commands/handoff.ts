import { ExitCode, PolicyError } from '@incubator/runtime';
import type { HandoffAgent } from '@incubator/core';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

const AGENTS: HandoffAgent[] = ['claude', 'copilot', 'cursor'];

/** `incubator handoff <runId> [--agent claude|copilot|cursor] [--launch]` (TDD §8). */
export async function runHandoff(
  deps: CliDeps,
  io: Io,
  runId: string,
  opts: { agent?: string; launch?: boolean },
): Promise<number> {
  if (opts.agent && !AGENTS.includes(opts.agent as HandoffAgent))
    throw new PolicyError(`unknown agent ${opts.agent} (use ${AGENTS.join(', ')})`, {
      code: 'usage',
    });
  const agent = opts.agent as HandoffAgent | undefined;
  const { plan, ticket } = await deps.engine.prepareHandoff(runId, agent ? { agent } : {});
  const shown = [plan.bin, ...plan.argv]
    .map((a) => (/^[\w./:=@,+-]+$/.test(a) ? a : JSON.stringify(a)))
    .join(' ');
  if (!opts.launch) {
    io.stderr(
      [
        `repository  ${plan.cwd}`,
        `plan        ${plan.planPath}`,
        `ticket      ${ticket ?? '(all feature tickets are ready for test)'}`,
        `ceilings    ${plan.ceilings.turns} turns, ${plan.ceilings.toolCalls} tool calls, ${plan.ceilings.minutes} min, $${plan.ceilings.usd}`,
        '',
        'Run this in the repository, with the plan as the prompt on stdin, or add --launch:',
        '',
      ].join('\n'),
    );
    io.stdout(`${shown}\n`);
    return ExitCode.Ok;
  }
  io.stderr(`▶ launching ${plan.agent} in ${plan.cwd} (ticket ${ticket ?? 'none'})\n`);
  const out = await deps.engine.launchHandoff(runId, agent ? { agent } : {});
  const stats = `${out.turns} turns, ${out.toolCalls} tool calls${out.costUsd !== null ? `, $${out.costUsd}` : ''}`;
  if (out.tripped) {
    io.stderr(
      `⏸ stopped at a run ceiling: ${out.tripped} (${stats}); the repository keeps its work\n`,
    );
    return ExitCode.Policy;
  }
  if (ticket && out.ticketState !== 'READY_FOR_TEST') {
    io.stderr(
      `✖ the agent exited (code ${out.exitCode}) before ${ticket} reached READY_FOR_TEST (${stats})\n`,
    );
    return ExitCode.Policy;
  }
  io.stderr(`✔ ${ticket ?? 'handoff'} is READY_FOR_TEST (${stats})\n`);
  return out.exitCode === 0 ? ExitCode.Ok : ExitCode.Policy;
}
