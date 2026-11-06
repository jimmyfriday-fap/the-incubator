#!/usr/bin/env node
// A stand-in agent CLI for handoff tests: reads the prompt on stdin and emits Claude-style
// stream-json. FAKE_AGENT_MODE=complete moves the active ticket to READY_FOR_TEST (like the Stop
// hook); slow works slowly and never ends by itself (for stopping it); edit does the same and also writes src/agent-work.txt and a result text, like a real coding
// run; idle stops without touching a file; runaway keeps calling tools until it is killed; spend
// reports a large cost; steps works like an update run's agent (plan 043).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
} else if (mode === 'memory' || mode === 'memory-agents' || mode === 'memory-unverified' || mode === 'memory-weak-hook') {
  // An Add memory run's agent (plan 071): installs a minimal store as the seed's playbook would, commits it
  // (on memory/bootstrap under the pr policy) and ends with the playbook's report. memory-agents also edits
  // AGENTS.md (a broken rule); memory-unverified reports a failed verification step; memory-weak-hook leaves a pre-commit hook that accepts anything. It refuses to run
  // without the seed directory, the effort and a tool list without PowerShell, so a test proves the engine passed all.
  const toolsAt = process.argv.indexOf('--tools');
  if (
    !process.argv.includes('--add-dir') ||
    !process.argv.includes('--effort') ||
    toolsAt < 0 ||
    /PowerShell/i.test(process.argv[toolsAt + 1] ?? '') ||
    process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL !== '0'
  ) {
    process.stderr.write('memory mode needs --add-dir, --effort and --tools without PowerShell\n');
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
  // A real (small) store: the seed's own scripts, so the Incubator's checks of steps 4 to 6 have something to run.
  const seed = /^SEED: (.+)$/m.exec(prompt)?.[1]?.trim();
  const stubs = /^STUBS: (.+)$/m.exec(prompt)?.[1]?.trim();
  if (!seed || !stubs) {
    process.stderr.write('memory mode needs SEED and STUBS in the prompt\n');
    process.exit(3);
  }
  mkdirSync(path.join('.memory', 'bin'), { recursive: true });
  mkdirSync(path.join('.memory', 'hooks'), { recursive: true });
  copyFileSync(path.join(seed, 'bin', 'memory'), path.join('.memory', 'bin', 'memory'));
  if (mode === 'memory-weak-hook')
    writeFileSync(path.join('.memory', 'hooks', 'pre-commit'), '#!/usr/bin/env bash\nexit 0\n');
  else copyFileSync(path.join(seed, 'hooks', 'pre-commit'), path.join('.memory', 'hooks', 'pre-commit'));
  // The seed's session-end hook, with the carriage return Windows python3 adds to the transcript path stripped
  // (the unpatched hook captures nothing there; a seed defect its owner fixes).
  const guard = '[ -n "${sid:-}" ] && [ -f "${src:-}" ] || exit 0';
  writeFileSync(
    path.join('.memory', 'hooks', 'session-end'),
    readFileSync(path.join(seed, 'hooks', 'session-end'), 'utf8').replace(guard, () => `src="\${src%$'\\r'}"\n${guard}`),
  );
  copyFileSync(path.join(seed, 'templates', 'gitignore'), path.join('.memory', '.gitignore'));
  const page = (name, tier, desc) =>
    `---\nname: ${name}\ntier: ${tier}\ndescription: ${desc}\nlast_verified: 2026-11-03\n---\n- [2026-11-03] [bootstrap] A fact the fake agent found (src: README.md)\n`;
  mkdirSync(path.join('.memory', 'context', 'platform'), { recursive: true });
  writeFileSync(path.join('.memory', 'context', 'platform', 'conventions.md'), page('conventions', 'platform', 'How code is written here'));
  mkdirSync(path.join('.memory', 'context', 'projects', 'shop'), { recursive: true });
  writeFileSync(path.join('.memory', 'context', 'projects', 'shop', 'failures.md'), page('shop-failures', 'project', 'What went wrong in shop'));
  writeFileSync(path.join('.memory', 'memory.conf'), `store = .memory/\ncommit_policy = ${policy}\n`);
  // A skill stub goes outside the repo; the Incubator copies it into .claude/skills/.
  mkdirSync(path.join(stubs, 'ship-release'), { recursive: true });
  writeFileSync(
    path.join(stubs, 'ship-release', 'SKILL.md'),
    '---\nname: ship-release\ndescription: Ships a release. Use when asked to release.\n---\nStatus: stub from bootstrap; confirm with the owner on first real use.\n',
  );
  // The playbook's step C regenerates the index with the seed's bash script. That is slow on Windows, and the
  // Incubator regenerates it after installing the skills, so this stand-in writes a plain placeholder.
  writeFileSync(path.join('.memory', 'INDEX.md'), '# Memory index\n');
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
      `- Verification 1–7: ${mode === 'memory-unverified' ? '1–5 passed, 6 failed (a refused command)' : 'all passed (4–6 left to the Incubator)'}`,
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
