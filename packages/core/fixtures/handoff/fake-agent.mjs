#!/usr/bin/env node
// A stand-in agent CLI for handoff tests: reads the prompt on stdin and emits Claude-style
// stream-json. FAKE_AGENT_MODE=complete moves the active ticket to READY_FOR_TEST (like the Stop
// hook); slow works slowly and never ends by itself (for stopping it); edit does the same and also writes src/agent-work.txt and a result text, like a real coding
// run; idle stops without touching a file; runaway keeps calling tools until it is killed; spend
// reports a large cost; steps works like an update run's agent (plan 043).
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
  // Inside a git hook (the pre-push gate) git exports variables that pin it to the hooked repository, and
  // this node process inherits them: without dropping them the switch below moved the REAL repository to a
  // branch called "elsewhere". Exec drops them only for direct git children; this agent is a node child.
  if (process.env.FAKE_AGENT_SWITCH === '1') {
    const env = { ...process.env };
    for (const k of [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_COMMON_DIR',
      'GIT_PREFIX',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_IMPLICIT_WORK_TREE',
    ])
      delete env[k];
    execFileSync('git', ['switch', '-q', '-c', 'elsewhere'], { env, stdio: 'pipe' });
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
} else if (mode === 'steps') {
  // An update run's agent (plan 043). Each launch saves the prompt it was given, writes the next
  // src/step-N.txt (only for the first FAKE_AGENT_WRITES launches), and marks the next FAKE_AGENT_MARKS
  // unmarked tickets READY_FOR_TEST, in the order of FAKE_AGENT_TICKETS, as the external prompt asks.
  const marks = Number(process.env.FAKE_AGENT_MARKS ?? 1);
  const writes = Number(process.env.FAKE_AGENT_WRITES ?? 99);
  mkdirSync(path.join('.incubator', 'state'), { recursive: true });
  let n = 1;
  while (existsSync(path.join('.incubator', 'state', `prompt-${n}.txt`))) n++;
  writeFileSync(path.join('.incubator', 'state', `prompt-${n}.txt`), prompt);
  if (n <= writes) {
    mkdirSync('src', { recursive: true });
    writeFileSync(path.join('src', `step-${n}.txt`), `step ${n}\n`);
  }
  let left = marks;
  for (const id of (process.env.FAKE_AGENT_TICKETS ?? '').split(',').filter(Boolean)) {
    const file = path.join('.incubator', 'tickets', `${id}.json`);
    const t = JSON.parse(readFileSync(file, 'utf8'));
    if (left <= 0 || t.state === 'READY_FOR_TEST') continue;
    left--;
    writeFileSync(file, `${JSON.stringify({ ...t, state: 'READY_FOR_TEST' }, null, 2)}\n`);
  }
  assistant(1);
  emit({ type: 'result', subtype: 'success', total_cost_usd: 0.42, result: `Finished step ${n}.` });
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
