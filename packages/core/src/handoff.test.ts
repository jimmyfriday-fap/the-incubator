import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { completeSpec } from '@incubator/spec';
import { nodeExec } from '@incubator/runtime';
import type { Capabilities } from '@incubator/llm';
import {
  CeilingMonitor,
  buildHandoffArgv,
  cleanAgentText,
  continuationText,
  handoffPrompt,
  HANDOFF_ALLOWED_TOOLS,
  remainingTickets,
  type HandoffProgress,
} from './handoff.js';
import { loadPrompt } from './prompts.js';
import type { EngineDeps } from './engine.js';
import { MAX_CODE_PARTS, agentReport, partMessage } from './finish.js';
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

async function publishedRun(
  mode: string,
  ceilings?: Record<string, number>,
  extra: {
    config?: EngineDeps['config'];
    probe?: (adapter: string) => Capabilities;
  } = {},
) {
  process.env['FAKE_AGENT_MODE'] = mode;
  const h = fakePublishEngine({
    handoff: {
      exec: nodeExec,
      probe: (adapter) => Promise.resolve(extra.probe ? extra.probe(adapter) : agentCaps),
    },
    ...(extra.config ? { config: extra.config } : {}),
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

  it('asks the agent for the chosen model when its CLI has a flag, and parks when it has none', () => {
    const flags = {
      printMode: ['-p'],
      streamJson: ['--output-format', 'stream-json'],
      model: '--model',
    };
    const ceilings = { turns: 30, toolCalls: 100, minutes: 20, usd: 5 };
    expect(buildHandoffArgv(caps(flags), ceilings, undefined, 'claude-sonnet-5-5')).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--model',
      'claude-sonnet-5-5',
    ]);
    // No model chosen: nothing is added.
    expect(buildHandoffArgv(caps(flags), ceilings)).not.toContain('--model');
    // A CLI with no model flag cannot honour the choice, so the run parks rather than ignore it.
    expect(() =>
      buildHandoffArgv(
        caps({ printMode: ['-p'], streamJson: ['--x'] }),
        ceilings,
        undefined,
        'opus',
      ),
    ).toThrow(/no flag for choosing a model/);
    // A model id reaches argv, so only a plain token is accepted.
    for (const bad of ['opus; rm -rf', '--evil', '', 'a b', '$(x)', 'x'.repeat(81)])
      expect(() => buildHandoffArgv(caps(flags), ceilings, undefined, bad), bad).toThrow(
        /not a model id/,
      );
  });

  it('reads the model from the init event of the stream, cleaned', () => {
    const m = new CeilingMonitor({ turns: 9, toolCalls: 9, minutes: 1, usd: 9 }, false);
    expect(m.model).toBeNull();
    m.feed(`${JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-sonnet-5-5' })}
`);
    expect(m.model).toBe('claude-sonnet-5-5');
    const other = new CeilingMonitor({ turns: 9, toolCalls: 9, minutes: 1, usd: 9 }, false);
    other.feed(`${JSON.stringify({ type: 'system', subtype: 'other', model: 'x' })}
`);
    other.feed(`${JSON.stringify({ type: 'system', subtype: 'init', model: 7 })}
`);
    expect(other.model).toBeNull();
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

  it('counts one turn per reply when a reply arrives as several events (plan 035)', () => {
    const m = new CeilingMonitor({ turns: 2, toolCalls: 99, minutes: 1, usd: 9 }, false);
    const block = (id: string, type: 'text' | 'tool_use') =>
      `${JSON.stringify({ type: 'assistant', message: { id, content: [type === 'text' ? { type, text: 'x' } : { type }] } })}\n`;
    m.feed(block('msg_1', 'text') + block('msg_1', 'tool_use') + block('msg_1', 'tool_use'));
    expect([m.turns, m.toolCalls]).toEqual([1, 2]);
    expect(m.feed(block('msg_2', 'tool_use') + block('msg_2', 'tool_use'))).toBeNull();
    expect([m.turns, m.toolCalls]).toEqual([2, 4]);
    expect(m.feed(block('msg_3', 'text'))).toBe('turns 3 > 2');
  });

  it('replays the shape of a real run that was stopped too early: 61 events, 27 replies (plan 035)', () => {
    const m = new CeilingMonitor({ turns: 60, toolCalls: 400, minutes: 45, usd: 10 }, false);
    let events = 0;
    for (let i = 0; i < 27; i++)
      for (let j = 0; j < (i < 7 ? 3 : 2); j++) {
        events++;
        m.feed(
          `${JSON.stringify({ type: 'assistant', message: { id: `msg_${i}`, content: [{ type: j === 0 ? 'text' : 'tool_use', text: 'x' }] } })}\n`,
        );
      }
    expect(events).toBe(61);
    expect(m.turns).toBe(27);
    expect(m.tripped).toBeNull();
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

  it('passes the chosen coding model, records the one that ran, and lists the models used', async () => {
    const withModel = caps({ ...agentCaps.flags, model: '--model' });
    const { h, runId } = await publishedRun('complete', undefined, {
      config: () => ({ agents: { model: 'claude-sonnet-5-5' } }),
      probe: () => withModel,
    });
    const out = await h.engine.launchHandoff(runId);
    expect(out.model).toBe('fake-agent-model');
    const launch = h.engine.entries(runId).findLast((e) => e.type === 'handoff.launch')!;
    expect(launch['model']).toBe('claude-sonnet-5-5');
    expect(launch['argv']).toEqual(expect.arrayContaining(['--model', 'claude-sonnet-5-5']));
    expect(h.engine.models(runId)).toEqual([
      { job: 'coding', tool: 'claude', model: 'fake-agent-model', calls: 1, costUsd: 0.42 },
    ]);
  });

  it('parks instead of ignoring a coding model its CLI cannot take, and picks the agent from the settings', async () => {
    const probed: string[] = [];
    const { h, runId } = await publishedRun('complete', undefined, {
      config: () => ({ agents: { primary: 'copilot', model: 'gpt-5' } }),
      probe: (adapter) => {
        probed.push(adapter);
        return agentCaps;
      },
    });
    await expect(h.engine.prepareHandoff(runId)).rejects.toMatchObject({
      reason: 'model_unsupported',
    });
    expect(probed.at(-1)).toBe('copilot-cli');
    // Asked for explicitly (the CLI's --agent), the owner's choice does not override it.
    await expect(h.engine.prepareHandoff(runId, { agent: 'cursor' })).rejects.toMatchObject({
      reason: 'model_unsupported',
    });
    expect(probed.at(-1)).toBe('cursor-cli');
  });

  it('stops the agent when asked, keeps what it wrote, and does not call it a ceiling', async () => {
    const { h, runId } = await publishedRun('slow');
    const stop = new AbortController();
    // Stop once the agent has started working (its first message comes after it wrote its file).
    const out = await h.engine.launchHandoff(runId, {
      signal: stop.signal,
      onEvent: (chunk) => {
        if (chunk.includes('"type":"assistant"')) stop.abort();
      },
    });
    expect(out).toMatchObject({ stopped: true, tripped: null });
    expect(agentReport(out).verdict).toBe('stopped');
    const prep = await h.engine.prepareHandoff(runId);
    expect(existsSync(path.join(prep.plan.cwd, 'src', 'agent-partial.txt'))).toBe(true);
    // A ceiling is still a ceiling, and a run that ends by itself is neither.
    const done = await publishedRun('complete');
    const finished = await done.h.engine.launchHandoff(done.runId);
    expect(finished.stopped).toBe(false);
    expect(agentReport(finished).verdict).toBe('ready');
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

describe('handoff on a repository the Incubator did not build (ADR-025)', () => {
  const flags = {
    printMode: ['-p'],
    streamJson: ['--output-format', 'stream-json'],
    allowedTools: '--allowedTools',
  };
  const ceilings = { turns: 10, toolCalls: 10, minutes: 1, usd: 1 };

  it('passes the given tool list instead of the Incubator gate, and keeps the default otherwise', () => {
    const argv = buildHandoffArgv(caps(flags), ceilings, ['Read', 'Bash(flutter test:*)']);
    expect(argv.slice(-2)).toEqual(['--allowedTools', 'Read,Bash(flutter test:*)']);
    expect(buildHandoffArgv(caps(flags), ceilings).slice(-1)).toEqual([
      HANDOFF_ALLOWED_TOOLS.join(','),
    ]);
  });

  it('tells a continuing part what the earlier parts committed (plan 036)', () => {
    const p = loadPrompt('handoff-continue');
    expect(p.name).toBe('handoff-continue');
    expect(p.version).toBe('1.1.0');
    expect(MAX_CODE_PARTS).toBe(5);
    const text = continuationText({
      part: 3,
      max: MAX_CODE_PARTS,
      base: 'a'.repeat(40),
      earlier: [
        { part: 1, sha: 'b'.repeat(40), tripped: 'turns 151 > 150' },
        { part: 2, sha: 'c'.repeat(40), tripped: null },
      ],
    });
    expect(text.startsWith('## Continuing: part 3 of up to 5\n\n')).toBe(true);
    expect(text).toContain('leave your work as uncommitted changes');
    expect(text).toContain(`Earlier parts, committed on this branch since ${'a'.repeat(12)}:`);
    expect(text).toContain(`- part 1: commit ${'b'.repeat(12)} (stopped at turns 151 > 150)\n`);
    expect(text).toContain(`- part 2: commit ${'c'.repeat(12)}\n`);
    const msg = partMessage(
      { title: 'build Tallyho', part: 2, tripped: 'tool calls 401 > 400' },
      'r1',
    );
    expect(msg).toBe(
      'chore: part 2 of up to 5: build Tallyho\n\nThe coding agent stopped at a run limit (tool calls 401 > 400); the next part continues from here.\n\nIncubator-Run: r1\nIncubator-Part: code-2\n',
    );
    // A checkpoint is never taken for the owner's finish commit.
    expect(msg).not.toContain('Incubator-Part: finish');
  });

  it('tells the first part of a continued run where the earlier session ended (plan 037)', () => {
    const text = continuationText({
      part: 1,
      max: MAX_CODE_PARTS,
      base: 'd'.repeat(40),
      earlier: [],
      before: { sha: 'd'.repeat(40), since: 'e'.repeat(40), tripped: 'turns 151 > 150' },
    });
    expect(text.startsWith('## Continuing: part 1 of up to 5\n\n')).toBe(true);
    expect(text).toContain(
      `The earlier coding session's work is committed on this branch since ${'e'.repeat(12)}; it ends at commit ${'d'.repeat(12)} (it stopped at turns 151 > 150).`,
    );
    expect(text).not.toContain('Earlier parts, committed on this branch');
  });

  it('lists the tickets not marked ready, counts a broken ticket file as not done, and tells the next part what is left (plan 042)', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'tickets '));
    const dir = path.join(repo, '.incubator', 'tickets');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, 'E-a.json'),
      JSON.stringify({ id: 'E-a', state: 'READY_FOR_TEST' }),
    );
    writeFileSync(
      path.join(dir, 'E-b.json'),
      JSON.stringify({ id: 'E-b', state: 'TAGGED_TO_RELEASE', remediations: ['x'] }),
    );
    expect(remainingTickets(repo, ['E-a', 'E-b', 'E-c'])).toEqual(['E-b', 'E-c']);
    writeFileSync(path.join(dir, 'E-d.json'), '{ not json');
    expect(remainingTickets(repo, ['E-a', 'E-d'])).toEqual(['E-d']);
    const text = continuationText({
      part: 2,
      max: 5,
      base: null,
      earlier: [],
      remaining: [{ id: 'E-b', summary: 'Export as CSV' }],
      failing: [{ command: 'flutter test', tail: '2 tests failed\nsee above' }],
    });
    expect(text).toContain(
      'These requests are not done yet: their tickets are not marked READY_FOR_TEST.\n\n- E-b: Export as CSV',
    );
    expect(text).toContain(
      'When you stopped, the Incubator ran the approved commands and these failed:\n\n- flutter test:\n    2 tests failed\n    see above',
    );
    expect(loadPrompt('handoff-external').body).toContain(
      'set that ticket\'s `"state"` to `"READY_FOR_TEST"`',
    );
  });

  it('ships the external prompt versioned and byte-pinned', () => {
    const p = loadPrompt('handoff-external');
    expect(p.name).toBe('handoff-external');
    expect(p.version).toBe('1.1.0');
    expect(p.body).toMatchSnapshot();
  });

  it('spells out the approved commands, or that there are none, and keeps the canonical prompt apart', () => {
    const plan = '# Plan\n\n**Step 1:** do it';
    const approved = handoffPrompt(plan, { checks: ['flutter analyze', 'flutter test'] });
    expect(approved).toContain('an existing repository that the Incubator did not generate');
    expect(approved).toContain(
      '## Approved check commands\n\n- `flutter analyze`\n- `flutter test`\n\n## Executor plan\n\n# Plan',
    );
    for (const own of ['scripts/check.mjs', 'TODO(scaffold)', 'Stop hook'])
      expect(approved).not.toContain(own);
    expect(approved).toContain('Do not run `git commit`');
    const none = handoffPrompt(plan, { checks: [] });
    expect(none).toContain('## Approved check commands\n\n(none: run no commands)');
    const canonical = handoffPrompt(plan);
    expect(canonical).toContain('node scripts/check.mjs quick');
    expect(canonical).not.toContain('Approved check commands');
  });
});
