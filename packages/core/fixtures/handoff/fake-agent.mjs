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

const phase = /^PHASE: (scaffold|bootstrap)$/m.exec(prompt)?.[1];
if (phase) {
  // A new build's memory sessions (plan 075), whatever the coding mode is: the scaffold makes a minimal store
  // and commits it before any code; the bootstrap fills it and commits only the memory paths, leaving the
  // owner's build work alone. FAKE_MEMORY_BUILD: agents (also edits AGENTS.md), unverified (the report's
  // verification fails), nothing (commits nothing).
  const quirk = process.env.FAKE_MEMORY_BUILD ?? '';
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
  const git = (...args) => execFileSync('git', args, { env, stdio: 'pipe' });
  if (!process.argv.includes('--add-dir')) {
    process.stderr.write('memory build needs --add-dir\n');
    process.exit(3);
  }
  const today = /^TODAY: (.+)$/m.exec(prompt)?.[1] ?? '2026-01-01';
  const stated = /```text\n([\s\S]*?)\n```/.exec(prompt)?.[1]?.split('.')[0]?.trim() ?? 'nothing';
  let result;
  if (quirk !== 'nothing') {
    const paths = [];
    const put = (p, text) => {
      mkdirSync(path.dirname(p), { recursive: true });
      writeFileSync(p, text);
      paths.push(p);
    };
    if (phase === 'scaffold') {
      put(path.join('.memory', 'INDEX.md'), '# Memory index\n');
      put(path.join('.memory', 'memory.conf'), 'commit_policy=direct\n');
      put(
        path.join('.memory', 'context', 'platform', 'decisions.md'),
        `- [${today}] [bootstrap] ${stated}. (src: solution description)\n`,
      );
      put(path.join('.claude', 'skills', 'write-memory', 'SKILL.md'), '---\nname: write-memory\n---\n');
      put('CLAUDE.md', 'Read .memory/INDEX.md before starting.\n');
    } else {
      put(path.join('.memory', 'context', 'platform', 'architecture.md'), `- [${today}] [bootstrap] A small service. (src: src/agent-work.txt)\n`);
    }
    if (quirk === 'agents') put('AGENTS.md', 'changed by the fake memory agent\n');
    git('add', '--', ...paths);
    git(
      'commit',
      '-q',
      '-m',
      `mem(platform): ${phase === 'scaffold' ? 'scaffold memory infrastructure' : 'bootstrap repo memory'}\n\nActor: bootstrap\nSession: manual`,
    );
  }
  assistant(1);
  result =
    phase === 'scaffold'
      ? 'Scaffold done: 1 decision lines.'
      : [
          'Filled the store.',
          '',
          '## Memory bootstrap report',
          '',
          '- Commit policy: `direct`',
          `- Verification 1–7: ${quirk === 'unverified' ? '1–5 passed, 6 failed' : 'all passed'}`,
          '- Isolation terms kept: none; dropped: none',
        ].join('\n');
  emit({ type: 'result', subtype: 'success', total_cost_usd: 0.1, result });
} else if (mode === 'slow') {
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
  // FAKE_AGENT_TRIP=N (plan 046): the first N launches keep calling tools until a run limit stops them.
  if (n <= Number(process.env.FAKE_AGENT_TRIP ?? 0)) {
    const tick = () => {
      assistant(5);
      setTimeout(tick, 5);
    };
    tick();
  } else {
    assistant(1);
    emit({ type: 'result', subtype: 'success', total_cost_usd: 0.42, result: `Finished step ${n}.` });
  }
} else if (mode === 'memory' || mode === 'memory-agents' || mode === 'memory-unverified') {
  // An Add memory run's agent (plan 071): installs a minimal store as the seed's playbook would, commits it
  // (on memory/bootstrap under the pr policy) and ends with the playbook's report. memory-agents also edits
  // AGENTS.md (a broken rule); memory-unverified reports a failed verification step. It refuses to run
  // without the seed directory and the effort, so a test proves the engine passed both.
  if (!process.argv.includes('--add-dir') || !process.argv.includes('--effort')) {
    process.stderr.write('memory mode needs --add-dir and --effort\n');
    process.exit(3);
  }
  // As in the parts mode: git hook variables would pin git to the REAL repository; drop them.
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
  const git = (...args) => execFileSync('git', args, { env, stdio: 'pipe' });
  const policy = /COMMIT_POLICY: direct/.test(prompt) ? 'direct' : 'pr';
  if (policy === 'pr') git('checkout', '-q', '-b', 'memory/bootstrap');
  mkdirSync('.memory', { recursive: true });
  writeFileSync(path.join('.memory', 'INDEX.md'), '# Memory index\n');
  writeFileSync(path.join('.memory', 'memory.conf'), `store = .memory/\ncommit_policy = ${policy}\n`);
  writeFileSync('CLAUDE.md', 'Read .memory/INDEX.md before starting.\n');
  if (mode === 'memory-agents') writeFileSync('AGENTS.md', 'changed by the fake memory agent\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'chore(memory): bootstrap the memory store');
  assistant(1);
  emit({
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.42,
    result: [
      'Installed the memory store.',
      '',
      '## Memory bootstrap report',
      '',
      `- Commit policy: \`${policy}\``,
      `- Verification 1–7: ${mode === 'memory-unverified' ? '1–5 passed, 6 failed (a refused command)' : 'all passed'}`,
      '- Isolation terms kept: none; dropped: none',
    ].join('\n'),
  });
} else if (mode === 'runaway') {
  const tick = () => {
    assistant(5);
    setTimeout(tick, 5);
  };
  tick();
} else {
  assistant(1);
  assistant(0);
  // FAKE_AGENT_SAVE_PROMPT=1: keep the prompt this coding launch was given, for tests that read it.
  if (process.env.FAKE_AGENT_SAVE_PROMPT === '1') {
    mkdirSync(path.join('.incubator', 'state'), { recursive: true });
    writeFileSync(path.join('.incubator', 'state', 'coding-prompt.txt'), prompt);
  }
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
