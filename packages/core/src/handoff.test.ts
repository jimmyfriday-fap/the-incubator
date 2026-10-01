import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { nodeExec } from '@incubator/runtime';
import type { Capabilities } from '@incubator/llm';
import {
  CeilingMonitor,
  buildHandoffArgv,
  cleanAgentText,
  HANDOFF_ALLOWED_TOOLS,
  type HandoffProgress,
} from './handoff.js';
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
    // The owner decides on commits (ADR-023): nothing that changes history or the index.
    expect(
      HANDOFF_ALLOWED_TOOLS.some((t) => /git (commit|add|checkout|reset|rebase|merge)/.test(t)),
    ).toBe(false);
    expect(HANDOFF_ALLOWED_TOOLS).toEqual(
      expect.arrayContaining(['Bash(git status:*)', 'Bash(git diff:*)']),
    );
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

  it('keeps what the agent said: the result text, else its last message, cleaned and capped', () => {
    const line = (e: unknown) => `${JSON.stringify(e)}\n`;
    const text = (t: string) => ({
      type: 'assistant',
      message: { content: [{ type: 'text', text: t }] },
    });
    const m = new CeilingMonitor({ turns: 9, toolCalls: 9, minutes: 1, usd: 9 }, false);
    m.feed(
      line(text('first')) +
        line(text('second')) +
        line({ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }),
    );
    expect([m.lastText, m.resultText]).toEqual(['second', null]);
    m.feed(line({ type: 'result', result: 'All done.' }));
    expect(m.resultText).toBe('All done.');
    expect(cleanAgentText('a\u0000b\u202e\r\nc  \n')).toBe('a b\nc');
    expect(cleanAgentText('   ')).toBeNull();
    expect(cleanAgentText(null)).toBeNull();
    expect(cleanAgentText('x'.repeat(50), 10)).toHaveLength(10);
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

  it('reports progress as the agent works and returns its summary', async () => {
    const { h, runId } = await publishedRun('edit');
    const seen: HandoffProgress[] = [];
    const out = await h.engine.launchHandoff(runId, { onProgress: (p) => seen.push(p) });
    expect(out.summary).toBe('Added src/agent-work.txt and ran the quick checks; all green.');
    // Chunks may batch turns, so assert the shape rather than the exact number of reports.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((p) => p.turns)).toEqual([...seen.map((p) => p.turns)].sort((a, b) => a - b));
    expect(seen.every((p) => p.turns > 0)).toBe(true);
    expect(seen.at(-1)?.turns).toBe(2);
    expect(seen.at(-1)).toMatchObject({ toolCalls: 1, snippet: 'working' });
    const prep = await h.engine.prepareHandoff(runId);
    // The agent's edit is in the working tree, uncommitted: the owner has not been asked yet.
    const status = await nodeExec.run('git', ['status', '--porcelain'], {
      cwd: prep.plan.cwd,
      timeoutMs: 10_000,
    });
    expect(status.stdout).toContain('src/agent-work.txt');
    const log = await nodeExec.run('git', ['log', '--format=%s'], {
      cwd: prep.plan.cwd,
      timeoutMs: 10_000,
    });
    expect(log.stdout).not.toContain('agent');
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
