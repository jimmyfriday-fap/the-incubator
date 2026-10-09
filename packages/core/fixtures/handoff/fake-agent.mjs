#!/usr/bin/env node
// A stand-in agent CLI for handoff tests: reads the prompt on stdin and emits Claude-style
// stream-json. FAKE_AGENT_MODE=complete moves the active ticket to READY_FOR_TEST (like the Stop
// hook); slow works slowly and never ends by itself (for stopping it); edit does the same and also writes src/agent-work.txt and a result text, like a real coding
// run; idle stops without touching a file; runaway keeps calling tools until it is killed; spend
// reports a large cost.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_AGENT_MODE ?? 'complete';
const prompt = readFileSync(0, 'utf8');
const emit = (e) => process.stdout.write(`${JSON.stringify(e)}\n`);
emit({
  type: 'system',
  subtype: 'init',
  model: process.env.FAKE_AGENT_MODEL ?? 'fake-agent-model',
  argv: process.argv.slice(2),
  promptChars: prompt.length,
});
const assistant = (tools) =>
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'working' }, ...Array.from({ length: tools }, () => ({ type: 'tool_use', name: 'Edit' }))] } });

if (mode === 'slow') {
  // Works slowly and never finishes by itself: for tests that stop the agent. Writes a file first, as a
  // real agent would have, so a stopped run has something in the folder.
  mkdirSync('src', { recursive: true });
  writeFileSync(path.join('src', 'agent-partial.txt'), 'half done\n');
  const tick = () => {
    assistant(0);
    setTimeout(tick, 200);
  };
  tick();
} else if (mode === 'parts') {
  // Works in parts (plan 036): each launch writes the next src/part-N.txt (only the first FAKE_AGENT_WRITES of
  // them) and notes whether its prompt asked it to continue. Launches before FAKE_AGENT_PARTS keep calling
  // tools until a ceiling stops them; that launch finishes the plan.
  const parts = Number(process.env.FAKE_AGENT_PARTS ?? 3);
  const writes = Number(process.env.FAKE_AGENT_WRITES ?? 99);
  let n = 1;
  while (existsSync(path.join('src', `part-${n}.txt`))) n++;
  // FAKE_AGENT_SWITCH=1: the agent (or the owner) moves the folder to another branch before the limit trips.
  // Retried, and the error shown in the hand-off log: under a heavily loaded machine git can briefly fail to
  // take a lock on .git, and a crash here made "never commits on a branch other than the run's own" flaky.
  if (process.env.FAKE_AGENT_SWITCH === '1') {
    for (let i = 1; ; i++) {
      try {
        execFileSync('git', ['switch', '-q', '-c', 'elsewhere'], { stdio: 'pipe' });
        break;
      } catch (e) {
        process.stderr.write(`git switch failed (try ${i}): ${String(e.stderr ?? e)}\n`);
        if (i >= 5) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
      }
    }
  }
  if (n <= writes) {
    mkdirSync('src', { recursive: true });
    writeFileSync(
      path.join('src', `part-${n}.txt`),
      `part ${n}; continuing: ${prompt.includes('## Continuing: part ')}\n`,
    );
  }
  if (n < parts) {
    const tick = () => {
      assistant(5);
      setTimeout(tick, 5);
    };
    tick();
  } else {
    assistant(1);
    const id = readFileSync(path.join('.incubator', 'state', 'active-ticket'), 'utf8').trim();
    const file = path.join('.incubator', 'tickets', `${id}.json`);
    const t = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
    emit({ type: 'result', subtype: 'success', total_cost_usd: Number(process.env.FAKE_AGENT_COST ?? 0.42), result: `Finished the plan in part ${n}.` });
  }
} else if (mode === 'runaway') {
  const tick = () => {
    assistant(5);
    setTimeout(tick, 5);
  };
  tick();
} else {
  assistant(1);
  assistant(0);
  if (mode === 'edit') {
    mkdirSync('src', { recursive: true });
    writeFileSync(path.join('src', 'agent-work.txt'), 'written by the fake agent\n');
  }
  if (mode === 'complete' || mode === 'edit') {
    const id = readFileSync(path.join('.incubator', 'state', 'active-ticket'), 'utf8').trim();
    const file = path.join('.incubator', 'tickets', `${id}.json`);
    const t = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
  }
  emit({
    type: 'result',
    subtype: 'success',
    total_cost_usd: mode === 'spend' ? 99 : 0.42,
    ...(mode === 'edit' ? { result: 'Added src/agent-work.txt and ran the quick checks; all green.' } : {}),
  });
}
