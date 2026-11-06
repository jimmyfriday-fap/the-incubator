import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { GitOps } from '@incubator/git';
import { ParkError, type Exec } from '@incubator/runtime';
import { installedPolicy } from './memory.js';

/**
 * The parts of an Add memory install that Claude Code will not let a headless agent write: `.claude/skills/`,
 * `.claude/settings.json` and the git pre-commit hook are protected paths, and an allow rule cannot pre-approve
 * them (AC1, 2026-11-06). The agent does the rest; after it stops, the Incubator makes these parts itself and runs
 * the playbook's verification steps that need them (4, 5 and 6). ADR-031 amendment.
 */

/** The SessionEnd command the playbook's step D2 wires. */
export const SESSION_END_COMMAND = '"$CLAUDE_PROJECT_DIR"/.memory/hooks/session-end';

/** The line the playbook's step D3 puts in the git pre-commit hook. */
export const HOOK_LINE = '"$(git rev-parse --show-toplevel)/.memory/hooks/pre-commit"';

/** The skills the seed ships, installed into every repo. */
export const SEED_SKILLS = ['write-memory', 'dream', 'memory-bootstrap'] as const;

/** The bootstrap skill's cap on skill stubs. */
export const MAX_STUBS = 5;

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merges the SessionEnd hook into `.claude/settings.json` without touching any other key; adding it twice
 * changes nothing. `json` is the file's text, or null when there is none.
 */
export function mergeSessionEnd(json: string | null): string {
  let root: Record<string, unknown> = {};
  if (json !== null && json.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ParkError(
        'memory_settings_invalid',
        '.claude/settings.json is not valid JSON, so the memory hook cannot be merged into it: fix the file and resume',
      );
    }
    if (!isObject(parsed))
      throw new ParkError(
        'memory_settings_invalid',
        '.claude/settings.json is not a JSON object, so the memory hook cannot be merged into it: fix the file and resume',
      );
    root = parsed;
  }
  if (root['hooks'] !== undefined && !isObject(root['hooks']))
    throw new ParkError(
      'memory_settings_invalid',
      '"hooks" in .claude/settings.json is not an object, so the memory hook cannot be merged into it: fix the file and resume',
    );
  const hooks = root['hooks'] ?? {};
  if (hooks['SessionEnd'] !== undefined && !Array.isArray(hooks['SessionEnd']))
    throw new ParkError(
      'memory_settings_invalid',
      '"hooks.SessionEnd" in .claude/settings.json is not a list, so the memory hook cannot be merged into it: fix the file and resume',
    );
  const sessionEnd = [...((hooks['SessionEnd'] as unknown[] | undefined) ?? [])];
  const present = sessionEnd.some(
    (entry) =>
      isObject(entry) &&
      Array.isArray(entry['hooks']) &&
      entry['hooks'].some((h) => isObject(h) && h['command'] === SESSION_END_COMMAND),
  );
  if (!present) sessionEnd.push({ hooks: [{ type: 'command', command: SESSION_END_COMMAND }] });
  return `${JSON.stringify({ ...root, hooks: { ...hooks, SessionEnd: sessionEnd } }, null, 2)}\n`;
}

/** The git pre-commit hook: a new one that runs the memory hook, or the existing one with the memory line appended once. */
export function preCommitHook(existing: string | null): string {
  if (existing === null || existing.trim() === '')
    return `#!/usr/bin/env bash\nexec ${HOOK_LINE}\n`;
  if (existing.includes('.memory/hooks/pre-commit')) return existing;
  return `${existing.endsWith('\n') ? existing : `${existing}\n`}${HOOK_LINE} || exit 1\n`;
}

/**
 * Copies the seed's three skills into `.claude/skills/`, then the bootstrap's skill stubs (each
 * `STUBS/<kebab-name>/SKILL.md`). Returns the names installed. A bad stub parks the run: nothing else was touched.
 */
export function copySkills(seed: string, repo: string, stubs: string): string[] {
  const names: string[] = [];
  const found: string[] = [];
  if (existsSync(stubs)) {
    for (const entry of readdirSync(stubs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!KEBAB.test(entry.name) || (SEED_SKILLS as readonly string[]).includes(entry.name))
        throw new ParkError(
          'memory_stub_invalid',
          `the agent wrote a skill stub named "${entry.name}": names are kebab-case and must not reuse a seed skill`,
        );
      if (!existsSync(path.join(stubs, entry.name, 'SKILL.md')))
        throw new ParkError(
          'memory_stub_invalid',
          `the skill stub "${entry.name}" has no SKILL.md`,
        );
      found.push(entry.name);
    }
  }
  if (found.length > MAX_STUBS)
    throw new ParkError(
      'memory_stub_invalid',
      `the agent wrote ${found.length} skill stubs, but the bootstrap allows at most ${MAX_STUBS}`,
    );
  const skills = path.join(repo, '.claude', 'skills');
  for (const name of SEED_SKILLS) {
    cpSync(path.join(seed, 'skills', name), path.join(skills, name), { recursive: true });
    names.push(name);
  }
  for (const name of found) {
    mkdirSync(path.join(skills, name), { recursive: true });
    cpSync(path.join(stubs, name, 'SKILL.md'), path.join(skills, name, 'SKILL.md'));
    names.push(name);
  }
  return names;
}

/** One thing the Incubator did or checked after the agent stopped. */
export interface InstallCheck {
  /** Short label: skills, settings, git-hook, index, commit, or the playbook's verification step. */
  step: string;
  status: 'passed' | 'failed' | 'skipped' | 'warning';
  detail: string;
}

export interface InstallProtectedResult {
  /** The commit holding the skills and settings; null when nothing needed committing. */
  commit: string | null;
  checks: InstallCheck[];
}

export interface InstallProtectedOptions {
  exec: Exec;
  git: GitOps;
  /** The repository (the run's folder). */
  dir: string;
  /** The session's copy of the seed. */
  seed: string;
  /** Where the agent wrote its skill stubs. */
  stubs: string;
  signal?: AbortSignal;
  /** Run the playbook's verification steps 4 to 6 (default true). Tests that are not about them turn it off: they run the seed's bash scripts and a real git hook. */
  selfTests?: boolean;
}

const TIMEOUT = 120_000;

/** A path relative to `base`, with forward slashes. */
function rel(base: string, p: string): string {
  return path.relative(base, p).split(path.sep).join('/');
}

/**
 * Makes the protected parts of the install, commits them, then runs the playbook's verification steps 4 to 6.
 * Everything runs as argv arrays (`shell: false`). The seed's own scripts are bash scripts, so they run through a
 * throwaway git alias: git runs an `!` alias with its own sh, which works the same on Windows, where a bare `bash`
 * on PATH may be WSL's.
 */
export async function installMemoryProtected(
  o: InstallProtectedOptions,
): Promise<InstallProtectedResult> {
  const { exec, git, dir } = o;
  const checks: InstallCheck[] = [];
  const add = (step: string, status: InstallCheck['status'], detail: string): void => {
    checks.push({ step, status, detail });
  };
  const run = (args: string[], extra: { env?: Record<string, string>; stdin?: string } = {}) =>
    exec.run('git', args, {
      timeoutMs: TIMEOUT,
      cwd: dir,
      env: { GIT_TERMINAL_PROMPT: '0', ...(extra.env ?? {}) },
      ...(extra.stdin !== undefined ? { stdin: extra.stdin } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    });
  const script = (command: string, extra: { env?: Record<string, string>; stdin?: string } = {}) =>
    run(['-c', `alias.memscript=!${command}`, 'memscript'], extra);

  // 1. Skills, settings, hook.
  const skills = copySkills(o.seed, dir, o.stubs);
  add('skills', 'passed', `installed ${skills.join(', ')}`);

  const settingsFile = path.join(dir, '.claude', 'settings.json');
  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(
    settingsFile,
    mergeSessionEnd(existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null),
  );
  add('settings', 'passed', 'SessionEnd hook merged into .claude/settings.json');

  const hooksOut = (await run(['rev-parse', '--git-path', 'hooks'])).stdout.trim();
  const hooksDir = path.resolve(dir, hooksOut || path.join('.git', 'hooks'));
  const hookFile = path.join(hooksDir, 'pre-commit');
  const inside = rel(dir, hooksDir);
  const hookInRepo = !inside.startsWith('..') && inside !== '.git' && !inside.startsWith('.git/');
  let hookInstalled = false;
  if (hookInRepo) {
    add(
      'git-hook',
      'skipped',
      `core.hooksPath points inside the repository (${inside}): add ${HOOK_LINE} || exit 1 to ${inside}/pre-commit yourself`,
    );
  } else {
    mkdirSync(hooksDir, { recursive: true });
    writeFileSync(
      hookFile,
      preCommitHook(existsSync(hookFile) ? readFileSync(hookFile, 'utf8') : null),
    );
    chmodSync(hookFile, 0o755);
    hookInstalled = true;
    add('git-hook', 'passed', `pre-commit hook installed at ${rel(dir, hookFile)}`);
  }

  // 2. The index lists the skills now present.
  const index = await script('.memory/bin/memory index');
  if (index.code === 0) add('index', 'passed', '.memory/bin/memory index');
  else
    add(
      'index',
      'failed',
      `.memory/bin/memory index exited ${index.code}: ${index.stderr.trim().split('\n').slice(-1)[0] ?? ''}`,
    );

  // 3. One commit for what the agent could not write.
  let commit: string | null = null;
  const staged = await run(['add', '--', '.claude', '.memory/INDEX.md']);
  if (staged.code !== 0) {
    add(
      'commit',
      'failed',
      `git add failed: ${staged.stderr.trim().split('\n').slice(-1)[0] ?? ''}`,
    );
  } else if ((await run(['diff', '--cached', '--quiet'])).code === 0) {
    add('commit', 'skipped', 'nothing new to commit');
  } else {
    try {
      commit = await git.commit(
        dir,
        'mem(platform): install memory skills and hooks (Incubator)\n\nThe agent cannot write .claude/ or .git/, so the Incubator installed the skills, the SessionEnd hook and the pre-commit hook.',
        {},
      );
      add('commit', 'passed', `committed ${commit.slice(0, 7)}`);
    } catch (e) {
      add('commit', 'failed', e instanceof Error ? e.message : String(e));
    }
  }

  // 4. Playbook step E4: the hook must reject a line that is not dated.
  if (o.selfTests === false) {
    add('E4', 'skipped', 'self-tests turned off');
  } else if (!hookInstalled) {
    add('E4', 'skipped', 'no pre-commit hook was installed');
  } else {
    const projects = path.join(dir, '.memory', 'context', 'projects');
    const target = existsSync(projects)
      ? readdirSync(projects)
          .map((n) => path.join(projects, n, 'failures.md'))
          .find((f) => existsSync(f))
      : undefined;
    if (!target) {
      add('E4', 'failed', 'no .memory/context/projects/<repo>/failures.md to test the hook with');
    } else {
      const original = readFileSync(target);
      const relTarget = rel(dir, target);
      try {
        writeFileSync(target, Buffer.concat([original, Buffer.from('\n- not a dated line\n')]));
        await run(['add', '--', relTarget]);
        const tried = await run([
          '-c',
          'commit.gpgsign=false',
          'commit',
          '-q',
          '-m',
          'hook self-test',
        ]);
        if (tried.code === 0) {
          // The hook let it through: undo our own commit before anything else happens.
          await run(['reset', '-q', '--soft', 'HEAD~1']);
          add('E4', 'failed', 'the pre-commit hook accepted a line that is not dated');
        } else if (/memory/i.test(`${tried.stdout}${tried.stderr}`)) {
          add('E4', 'passed', 'the pre-commit hook rejected a line that is not dated');
        } else {
          add(
            'E4',
            'failed',
            `the commit failed, but not from the memory hook: ${tried.stderr.trim().split('\n').slice(-1)[0] ?? ''}`,
          );
        }
      } finally {
        await run(['reset', '-q', '--', relTarget]);
        writeFileSync(target, original);
      }
    }
  }

  // 5. Playbook step E5: the hook is wired and the policy guard matches the policy.
  const policy = installedPolicy(dir);
  const memoryHook = path.join(dir, '.memory', 'hooks', 'pre-commit');
  if (o.selfTests === false) {
    add('E5', 'skipped', 'self-tests turned off');
  } else if (!hookInstalled) {
    add('E5', 'skipped', 'no pre-commit hook was installed');
  } else if (!readFileSync(hookFile, 'utf8').includes('.memory/hooks/pre-commit')) {
    add('E5', 'failed', 'the installed pre-commit hook does not run .memory/hooks/pre-commit');
  } else if (!existsSync(memoryHook)) {
    add('E5', 'failed', '.memory/hooks/pre-commit is missing');
  } else if (policy === 'pr' && !/main\|master/.test(readFileSync(memoryHook, 'utf8'))) {
    add('E5', 'failed', 'the pr policy needs the main/master guard, and the hook has none');
  } else {
    add('E5', 'passed', `hook wired; ${policy ?? 'no'} policy guard as the policy requires`);
  }

  // 6. Playbook step E6: the SessionEnd hook captures a transcript, and git ignores it.
  const transcriptRoot = path.join(dir, '.memory', 'transcripts');
  const probe = async (transcriptPath: string) => {
    const ran = await script('.memory/hooks/session-end', {
      env: { CLAUDE_PROJECT_DIR: dir },
      stdin: JSON.stringify({ session_id: 'selftest', transcript_path: transcriptPath }),
    });
    const captured = existsSync(transcriptRoot)
      ? readdirSync(transcriptRoot)
          .map((d) => path.join(transcriptRoot, d, 'selftest.jsonl'))
          .filter((f) => existsSync(f) && statSync(f).isFile())
      : [];
    const leaked = captured.length
      ? (await git.status(dir)).filter((e) => e.path.includes('selftest.jsonl'))
      : [];
    for (const f of captured) rmSync(f, { force: true });
    const err = ran.stderr.trim().split('\n').slice(-1)[0] ?? '';
    return { code: ran.code, captured: captured.length, leaked: leaked.length, err };
  };
  // INDEX.md is the source file because the index step above has just made sure it exists.
  const result = o.selfTests === false ? null : await probe('.memory/INDEX.md');
  if (result === null) {
    add('E6', 'skipped', 'self-tests turned off');
  } else if (result.captured === 0 && result.code !== 0) {
    add('E6', 'failed', `the SessionEnd hook failed (exit ${result.code}): ${result.err}`);
  } else if (result.captured === 0) {
    // The seed hook exits 0 on any problem by design, so a silent no-op is a warning, not a failure: on Windows,
    // python3 ends the transcript path with a carriage return and the hook then captures nothing (a seed defect).
    add(
      'E6',
      'warning',
      'the SessionEnd hook ran but captured no transcript: transcripts will not be captured until the seed hook is fixed (on Windows, python3 ends the transcript path with a carriage return, which defeats it)',
    );
  } else if (result.leaked) {
    add('E6', 'failed', 'the captured transcript is not ignored by git');
  } else {
    add('E6', 'passed', 'the SessionEnd hook captured a transcript, and git ignores it');
  }

  return { commit, checks };
}

/** The checks as lines for the report the owner reads. */
export function checksReport(checks: readonly InstallCheck[]): string {
  return [
    '## Incubator checks (playbook steps 4–6 and the protected files)',
    ...checks.map((c) => `- ${c.step}: ${c.status}${c.detail ? ` (${c.detail})` : ''}`),
  ].join('\n');
}
