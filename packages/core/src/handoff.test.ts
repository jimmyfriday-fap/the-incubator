import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { nodeExec } from '@incubator/runtime';
import type { Capabilities } from '@incubator/llm';
import { CeilingMonitor, buildHandoffArgv, HANDOFF_ALLOWED_TOOLS } from './handoff.js';
import { fakePublishEngine } from './testing.js';

const fakeAgent = path.resolve(import.meta.dirname, '../fixtures/handoff/fake-agent.mjs');
const caps = (flags: Capabilities['flags']): Capabilities => ({
  installed: true,
  path: process.execPath,
  version: '1.0.0',
  flags,
  stdinPrompt: true,
  eligible: { discovery: true, analysis: true, handoff: true },
  reasons: [],
});
const agentCaps = caps({
  printMode: [fakeAgent, '-p'],
  streamJson: ['--output-format', 'stream-json'],
});

async function publishedRun(mode: string, ceilings?: Record<string, number>) {
  process.env['FAKE_AGENT_MODE'] = mode;
  const h = fakePublishEngine({
    handoff: { exec: nodeExec, probe: () => Promise.resolve(agentCaps) },
  });
  const draft = JSON.parse(
    readFileSync(
      path.resolve(
        import.meta.dirname,
        '../../templates/fixtures/combos/node-lib.in-repo.package-release.json',
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;
  const spec = completeSpec({
    ...draft,
    project: { ...(draft['project'] as object), owner: { type: 'user', login: 'octo' } },
    ...(ceilings ? { agents: { runCeilings: ceilings } } : {}),
  }).spec;
  const runId = h.engine.startFromSpec(spec, { kind: 'scaffold', surface: 'test' });
  await h.engine.advance(runId, undefined as never);
  return { h, runId };
}

describe('handoff', () => {
  it('builds headless argv from probed capabilities', () => {
    const full = caps({
      printMode: ['-p'],
      streamJson: ['--output-format', 'stream-json'],
      verbose: '--verbose',
      maxTurns: '--max-turns',
      acceptEdits: ['--permission-mode', 'acceptEdits'],
      allowedTools: '--allowedTools',
    });
    const ceilings = { turns: 30, toolCalls: 100, minutes: 20, usd: 5 };
    expect(buildHandoffArgv(full, ceilings)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '30',
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      HANDOFF_ALLOWED_TOOLS.join(','),
    ]);
    expect(HANDOFF_ALLOWED_TOOLS.some((t) => /push|promote|rm /.test(t))).toBe(false);
    expect(() => buildHandoffArgv(caps({ printMode: ['-p'] }), ceilings)).toThrow(
      'no headless streaming mode',
    );
  });

  it('counts turns, tool calls and cost from the stream and trips ceilings', () => {
    const m = new CeilingMonitor({ turns: 2, toolCalls: 3, minutes: 1, usd: 1 }, false);
    const a = (n: number) =>
      `${JSON.stringify({ type: 'assistant', message: { content: Array.from({ length: n }, () => ({ type: 'tool_use' })) } })}\n`;
    expect(m.feed(a(1) + a(1).slice(0, 10))).toBeNull();
    expect(m.feed(a(1).slice(10) + 'not json\n')).toBeNull();
    expect([m.turns, m.toolCalls]).toEqual([2, 2]);
    expect(m.feed(a(2))).toBe('turns 3 > 2');
    const cost = new CeilingMonitor({ turns: 99, toolCalls: 99, minutes: 1, usd: 1 }, false);
    expect(cost.feed(`${JSON.stringify({ type: 'result', total_cost_usd: 2.5 })}\n`)).toBe(
      'cost $2.5 > $1',
    );
  });

  it('launches the agent on the cloned repository and ends at READY_FOR_TEST', async () => {
    const { h, runId } = await publishedRun('complete');
    const prep = await h.engine.prepareHandoff(runId);
    expect(prep.ticket).toBe('F-counter');
    expect(prep.prompt).toContain('## Executor plan');
    expect(prep.prompt).toContain('# Plan 000: bootstrap');
    const out = await h.engine.launchHandoff(runId);
    expect(out).toMatchObject({
      exitCode: 0,
      turns: 2,
      toolCalls: 1,
      costUsd: 0.42,
      tripped: null,
      ticketState: 'READY_FOR_TEST',
    });
    const log = readFileSync(path.join(h.store.runDir(runId), 'logs', 'handoff.log'), 'utf8');
    expect(log).toContain('"type":"result"');
    expect(h.engine.entries(runId).map((e) => e.type)).toEqual(
      expect.arrayContaining(['handoff.launch', 'handoff.result']),
    );
  });

  it('kills a runaway agent at the tool-call ceiling and refuses unfinished runs', async () => {
    const { h, runId } = await publishedRun('runaway', { toolCalls: 12 });
    const out = await h.engine.launchHandoff(runId);
    expect(out.tripped).toMatch(/^tool calls \d+ > 12$/);
    expect(out.ticketState).toBe('TAGGED_TO_RELEASE');
    const spend = await publishedRun('spend', { usd: 1 });
    expect((await spend.h.engine.launchHandoff(spend.runId)).tripped).toBe('cost $99 > $1');
    const unfinished = spend.h.engine.startFromSpec(spend.h.engine.approvedSpec(spend.runId), {
      kind: 'scaffold',
      surface: 'test',
    });
    await expect(spend.h.engine.prepareHandoff(unfinished)).rejects.toThrow('is not finished');
  });
});
