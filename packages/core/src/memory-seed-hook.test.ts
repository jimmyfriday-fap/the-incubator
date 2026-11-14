import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeExec } from '@incubator/runtime';

/**
 * The seed's session-end hook must never copy a raw transcript into a memory store: tool output holds secrets, IP
 * addresses and emails. It redacts through bin/redact-transcript.mjs, and with no node or no redactor it copies nothing.
 * It must also capture a session that was started in a git worktree (the worktree has no untracked .memory-link and a
 * relative store path that does not resolve).
 */
const SEED = path.resolve(import.meta.dirname, '../../../assets/memory-seed');
const HOOK = path.join(SEED, 'hooks', 'session-end');
const REDACTOR = path.join(SEED, 'bin', 'redact-transcript.mjs');

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `${name} `));
const git = (cwd: string, ...args: string[]) =>
  nodeExec.run('git', args, { cwd, timeoutMs: 30_000 }).then((r) => r.stdout.trim());

// why: assembled at run time so this file never holds a token-shaped string for a secret scanner to flag.
const TOKEN = ['gh', 'p_', 'A'.repeat(36)].join('');
const EMAIL = 'someone@gmail.com';

function transcript(dir: string): string {
  const file = path.join(dir, 'session.jsonl');
  const lines = [
    { type: 'user', message: { content: 'deploy it' } },
    { type: 'tool_result', content: `token ${TOKEN}\ncontact ${EMAIL} today` },
  ];
  writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  return file;
}

// why: inside the pre-push and pre-commit hooks git exports these, and Exec strips them only for a `git` child. The hook
// is a bash child that runs git itself, so it would otherwise act on the hooked repository, not on the scratch one.
const GIT_REPOSITORY_ENV = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_PREFIX',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_IMPLICIT_WORK_TREE',
];
const NO_GIT_ENV = Object.fromEntries(GIT_REPOSITORY_ENV.map((k) => [k, undefined]));

async function runHook(projectDir: string, src: string, env: Record<string, string> = {}) {
  return nodeExec.run('bash', [HOOK], {
    cwd: projectDir,
    timeoutMs: 60_000,
    env: { ...NO_GIT_ENV, CLAUDE_PROJECT_DIR: projectDir, ...env },
    stdin: JSON.stringify({ session_id: 'sess-1', transcript_path: src }),
  });
}

function copies(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root);
  return out;
}

function repoModeRepo(withRedactor: boolean): string {
  const dir = tmp('seed hook repo');
  mkdirSync(path.join(dir, '.memory', 'context'), { recursive: true });
  mkdirSync(path.join(dir, '.memory', 'bin'), { recursive: true });
  if (withRedactor) {
    copyFileSync(REDACTOR, path.join(dir, '.memory', 'bin', 'redact-transcript.mjs'));
    chmodSync(path.join(dir, '.memory', 'bin', 'redact-transcript.mjs'), 0o755);
  }
  return dir;
}

describe('the seed session-end hook', () => {
  it('copies a redacted transcript in repo mode', async () => {
    const dir = repoModeRepo(true);
    const r = await runHook(dir, transcript(tmp('seed hook src')));
    expect(r.code).toBe(0);
    const [copy] = copies(path.join(dir, '.memory', 'transcripts'));
    expect(copy).toBeDefined();
    const text = readFileSync(copy!, 'utf8');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(EMAIL);
    expect(text).toContain('[REDACTED:provider-token]');
    expect(text).toContain('[REDACTED:email]');
    for (const line of text.trim().split('\n')) expect(() => void JSON.parse(line)).not.toThrow();
  });

  it('copies nothing, and says so, when the redactor is missing: never a raw copy', async () => {
    const dir = repoModeRepo(false);
    const r = await runHook(dir, transcript(tmp('seed hook src')));
    expect(r.code).toBe(0);
    expect(copies(path.join(dir, '.memory'))).toEqual([]);
    expect(r.stderr).toContain('redact-transcript.mjs');
  });

  it('captures a session started in a git worktree of a store-mode member', async () => {
    const base = tmp('seed hook system');
    const store = path.join(base, 'store');
    mkdirSync(path.join(store, 'context'), { recursive: true });
    mkdirSync(path.join(store, 'bin'), { recursive: true });
    copyFileSync(REDACTOR, path.join(store, 'bin', 'redact-transcript.mjs'));
    const member = path.join(base, 'api');
    mkdirSync(member, { recursive: true });
    await git(member, 'init', '-q', '-b', 'main');
    writeFileSync(path.join(member, '.memory-link'), 'system=shop\nrepo=api\npath=../store\n');
    writeFileSync(path.join(member, 'README.md'), '# api\n');
    await git(member, 'add', '-A');
    await git(
      member,
      '-c',
      'user.name=T',
      '-c',
      'user.email=t@example.invalid',
      'commit',
      '-q',
      '-m',
      'i',
    );
    const wt = path.join(base, 'work', 'api-wt');
    await git(member, 'worktree', 'add', '-q', wt, '-b', 'feature');
    const r = await runHook(wt, transcript(tmp('seed hook src')), { MEMORY_STORE_DIR: '' });
    expect(r.code).toBe(0);
    const [copy] = copies(path.join(store, 'transcripts', 'api'));
    expect(copy).toBeDefined();
    expect(readFileSync(copy!, 'utf8')).not.toContain(TOKEN);
  });

  it('ships the redactor with its own selftest passing', async () => {
    const r = await nodeExec.run('node', [REDACTOR, '--selftest'], { timeoutMs: 30_000 });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('selftest: ok');
  });
});
