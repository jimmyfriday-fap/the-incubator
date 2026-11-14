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

/** The SessionEnd command the system playbook's step D3 wires in a member (plan 079 WI-1). */
export const MEMBER_SESSION_END_COMMAND = '"$CLAUDE_PROJECT_DIR"/.claude/hooks/memory-session-end';

/** Keeps a member's hook script LF on every checkout: bash cannot run it with CRLF line ends (hand-built store, 2026-11-07). */
export const HOOKS_GITATTRIBUTES = '* text eol=lf\n';

/** The line the system playbook's step B5 puts in the store's git pre-commit hook. */
export const STORE_HOOK_LINE = '"$(git rev-parse --show-toplevel)/hooks/pre-commit"';

const MEMBER_COMMIT_MESSAGE =
  'mem(link): install memory hook and settings (Incubator)\n\nThe agent cannot write .claude/, so the Incubator installed the SessionEnd hook, its settings and the store path for this machine.';

const lastLine = (s: string): string => s.trim().split('\n').slice(-1)[0] ?? '';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Merges the SessionEnd hook into `.claude/settings.json` without touching any other key; adding it twice
 * changes nothing. `json` is the file's text, or null when there is none.
 */
export function mergeSessionEnd(
  json: string | null,
  command: string = SESSION_END_COMMAND,
): string {
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
      entry['hooks'].some((h) => isObject(h) && h['command'] === command),
  );
  if (!present) sessionEnd.push({ hooks: [{ type: 'command', command }] });
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
    // The seed hook exits 0 on any problem by design, so a silent no-op is a warning, not a failure. The usual cause is
    // a missing node or a missing redactor: the hook copies nothing rather than a raw transcript.
    add(
      'E6',
      'warning',
      'the SessionEnd hook ran but captured no transcript: it copies nothing when node or .memory/bin/redact-transcript.mjs is missing (copy bin/redact-transcript.mjs from the seed), because a raw copy would hold secrets',
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

/**
 * The store's git pre-commit hook (system playbook step B5): a new one that runs the store's own hook, or the
 * existing one with the line appended once (plan 079 WI-1).
 */
export function storePreCommitHook(existing: string | null): string {
  if (existing === null || existing.trim() === '')
    return `#!/usr/bin/env bash\nexec ${STORE_HOOK_LINE}\n`;
  if (existing.includes(STORE_HOOK_LINE)) return existing;
  return `${existing.endsWith('\n') ? existing : `${existing}\n`}${STORE_HOOK_LINE} || exit 1\n`;
}

/**
 * Merges this machine's path to the store into a member's `.claude/settings.local.json` (system playbook step D4)
 * without touching any other key; adding it twice changes nothing. `json` is the file's text, or null when there is none.
 */
export function mergeStoreAccess(json: string | null, store: string): string {
  let root: Record<string, unknown> = {};
  if (json !== null && json.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new ParkError(
        'memory_settings_invalid',
        '.claude/settings.local.json is not valid JSON, so the store path cannot be merged into it: fix the file and resume',
      );
    }
    if (!isObject(parsed))
      throw new ParkError(
        'memory_settings_invalid',
        '.claude/settings.local.json is not a JSON object, so the store path cannot be merged into it: fix the file and resume',
      );
    root = parsed;
  }
  for (const key of ['env', 'permissions'])
    if (root[key] !== undefined && !isObject(root[key]))
      throw new ParkError(
        'memory_settings_invalid',
        `"${key}" in .claude/settings.local.json is not an object, so the store path cannot be merged into it: fix the file and resume`,
      );
  const env = isObject(root['env']) ? root['env'] : {};
  const permissions = isObject(root['permissions']) ? root['permissions'] : {};
  if (
    permissions['additionalDirectories'] !== undefined &&
    !Array.isArray(permissions['additionalDirectories'])
  )
    throw new ParkError(
      'memory_settings_invalid',
      '"permissions.additionalDirectories" in .claude/settings.local.json is not a list, so the store path cannot be merged into it: fix the file and resume',
    );
  const dirs = [...((permissions['additionalDirectories'] as unknown[] | undefined) ?? [])];
  if (!dirs.includes(store)) dirs.push(store);
  return `${JSON.stringify(
    {
      ...root,
      env: { ...env, MEMORY_STORE_DIR: store },
      permissions: { ...permissions, additionalDirectories: dirs },
    },
    null,
    2,
  )}\n`;
}

export interface InstallSystemOptions {
  exec: Exec;
  git: GitOps;
  /** The session's copy of the seed (only `hooks/session-end` is read). */
  seed: string;
  /** The store repository's folder. */
  store: string;
  /** The members to install, each a repository folder. */
  members: readonly { name: string; dir: string }[];
  /** Install the store's git hook and run its self-test (default true). Add member leaves it to the store run. */
  storeHook?: boolean;
  signal?: AbortSignal;
  /** Run the playbook's verification steps 5 and 6 (default true). */
  selfTests?: boolean;
}

/**
 * The parts of a store-mode install that Claude Code will not let a headless agent write (plan 079 WI-1): per member
 * the SessionEnd hook, `.claude/settings.json`, this machine's store path in `.claude/settings.local.json` (D3, D4),
 * one commit per member; in the store the git pre-commit hook (B5). Then the playbook's verification steps 5 (the store
 * hook rejects a bad line) and 6 (each member's hook captures a transcript, and git ignores it). Safe to run again.
 */
export async function installMemorySystemProtected(
  o: InstallSystemOptions,
): Promise<InstallProtectedResult> {
  const { exec, git } = o;
  const checks: InstallCheck[] = [];
  const add = (step: string, status: InstallCheck['status'], detail: string): void => {
    checks.push({ step, status, detail });
  };
  const run = (
    cwd: string,
    args: string[],
    extra: { env?: Record<string, string>; stdin?: string } = {},
  ) =>
    exec.run('git', args, {
      timeoutMs: TIMEOUT,
      cwd,
      env: { GIT_TERMINAL_PROMPT: '0', ...(extra.env ?? {}) },
      ...(extra.stdin !== undefined ? { stdin: extra.stdin } : {}),
      ...(o.signal ? { signal: o.signal } : {}),
    });
  const storePath = o.store.replace(/\\/g, '/');
  let commit: string | null = null;

  // 1. Each member: hook, settings, this machine's store path, one commit (never the local settings).
  for (const m of o.members) {
    const hookFile = path.join(m.dir, '.claude', 'hooks', 'memory-session-end');
    mkdirSync(path.dirname(hookFile), { recursive: true });
    cpSync(path.join(o.seed, 'hooks', 'session-end'), hookFile);
    chmodSync(hookFile, 0o755);
    writeFileSync(path.join(m.dir, '.claude', 'hooks', '.gitattributes'), HOOKS_GITATTRIBUTES);
    const settingsFile = path.join(m.dir, '.claude', 'settings.json');
    writeFileSync(
      settingsFile,
      mergeSessionEnd(
        existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null,
        MEMBER_SESSION_END_COMMAND,
      ),
    );
    const localFile = path.join(m.dir, '.claude', 'settings.local.json');
    writeFileSync(
      localFile,
      mergeStoreAccess(existsSync(localFile) ? readFileSync(localFile, 'utf8') : null, storePath),
    );
    const staged = [
      '.claude/hooks/.gitattributes',
      '.claude/hooks/memory-session-end',
      '.claude/settings.json',
    ];
    // A repository whose .gitignore is an allowlist hides these files. Add the exact "!" lines, and the folders above
    // them (git cannot re-include a file under an excluded folder), then check again (plan 079 WI-2).
    const hidden: string[] = [];
    for (const p of staged)
      if ((await run(m.dir, ['check-ignore', '-q', p])).code === 0) hidden.push(p);
    if (hidden.length) {
      const ignoreFile = path.join(m.dir, '.gitignore');
      const text = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : '';
      const want: string[] = [];
      for (const p of hidden) {
        const parts = p.split('/');
        for (let i = 1; i < parts.length; i++) want.push(`!/${parts.slice(0, i).join('/')}/`);
        want.push(`!/${p}`);
      }
      writeFileSync(
        ignoreFile,
        `${text === '' || text.endsWith('\n') ? text : `${text}\n`}${[...new Set(want)].join('\n')}\n`,
      );
      staged.push('.gitignore');
      const still: string[] = [];
      for (const p of hidden)
        if ((await run(m.dir, ['check-ignore', '-q', p])).code === 0) still.push(p);
      if (still.length) {
        add(
          `${m.name}:unignore`,
          'failed',
          `still ignored after adding "!" lines to .gitignore: ${still.join(', ')}`,
        );
        continue;
      }
    }
    if ((await run(m.dir, ['check-ignore', '-q', '.claude/settings.local.json'])).code !== 0) {
      const ignoreFile = path.join(m.dir, '.gitignore');
      const text = existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8') : '';
      writeFileSync(
        ignoreFile,
        `${text === '' || text.endsWith('\n') ? text : `${text}\n`}.claude/settings.local.json\n`,
      );
      if (!staged.includes('.gitignore')) staged.push('.gitignore');
    }
    add(
      `${m.name}:files`,
      'passed',
      'SessionEnd hook, settings and the store path for this machine installed',
    );
    const added = await run(m.dir, ['add', '--', ...staged]);
    if (added.code !== 0) {
      add(`${m.name}:commit`, 'failed', `git add failed: ${lastLine(added.stderr)}`);
      continue;
    }
    await run(m.dir, ['update-index', '--chmod=+x', '--', '.claude/hooks/memory-session-end']);
    if ((await run(m.dir, ['diff', '--cached', '--quiet'])).code === 0) {
      add(`${m.name}:commit`, 'skipped', 'nothing new to commit');
      continue;
    }
    try {
      commit = await git.commit(m.dir, MEMBER_COMMIT_MESSAGE, {});
      add(`${m.name}:commit`, 'passed', `committed ${commit.slice(0, 7)}`);
    } catch (e) {
      add(`${m.name}:commit`, 'failed', e instanceof Error ? e.message : String(e));
    }
  }

  // 2. The store's git hook (playbook B5), then step 5: it must reject a line that is not dated.
  if (o.storeHook !== false) {
    const memoryHook = path.join(o.store, 'hooks', 'pre-commit');
    if (!existsSync(memoryHook)) {
      add(
        'store-hook',
        'failed',
        'the store has no hooks/pre-commit (playbook step B4), so the git hook would have nothing to run',
      );
    } else {
      const hooksOut = (await run(o.store, ['rev-parse', '--git-path', 'hooks'])).stdout.trim();
      const hooksDir = path.resolve(o.store, hooksOut || path.join('.git', 'hooks'));
      const hookFile = path.join(hooksDir, 'pre-commit');
      const inside = rel(o.store, hooksDir);
      const hookInRepo =
        !inside.startsWith('..') && inside !== '.git' && !inside.startsWith('.git/');
      let hookInstalled = false;
      if (hookInRepo) {
        add(
          'store-hook',
          'skipped',
          `core.hooksPath points inside the store (${inside}): add ${STORE_HOOK_LINE} || exit 1 to ${inside}/pre-commit yourself`,
        );
      } else {
        mkdirSync(hooksDir, { recursive: true });
        writeFileSync(
          hookFile,
          storePreCommitHook(existsSync(hookFile) ? readFileSync(hookFile, 'utf8') : null),
        );
        chmodSync(hookFile, 0o755);
        hookInstalled = true;
        add(
          'store-hook',
          'passed',
          `pre-commit hook installed in the store at ${rel(o.store, hookFile)}`,
        );
      }
      if (o.selfTests === false) {
        add('E5', 'skipped', 'self-tests turned off');
      } else if (!hookInstalled) {
        add('E5', 'skipped', 'no pre-commit hook was installed');
      } else {
        const projects = path.join(o.store, 'context', 'projects');
        const target = existsSync(projects)
          ? readdirSync(projects)
              .map((n) => path.join(projects, n, 'failures.md'))
              .find((f) => existsSync(f))
          : undefined;
        if (!target) {
          add(
            'E5',
            'failed',
            'no context/projects/<repo>/failures.md in the store to test the hook with',
          );
        } else {
          const original = readFileSync(target);
          const relTarget = rel(o.store, target);
          try {
            writeFileSync(target, Buffer.concat([original, Buffer.from('\n- not a dated line\n')]));
            await run(o.store, ['add', '--', relTarget]);
            const tried = await run(o.store, [
              '-c',
              'commit.gpgsign=false',
              'commit',
              '-q',
              '-m',
              'hook self-test',
            ]);
            if (tried.code === 0) {
              // The hook let it through: undo our own commit before anything else happens.
              await run(o.store, ['reset', '-q', '--soft', 'HEAD~1']);
              add('E5', 'failed', 'the store pre-commit hook accepted a line that is not dated');
            } else if (/memory/i.test(`${tried.stdout}${tried.stderr}`)) {
              add('E5', 'passed', 'the store pre-commit hook rejected a line that is not dated');
            } else {
              add(
                'E5',
                'failed',
                `the commit failed, but not from the memory hook: ${lastLine(tried.stderr)}`,
              );
            }
          } finally {
            await run(o.store, ['reset', '-q', '--', relTarget]);
            writeFileSync(target, original);
          }
        }
      }
    }
  }

  // 3. Step 6, per member: the SessionEnd hook captures a transcript into the store, and git ignores it.
  const transcriptRoot = path.join(o.store, 'transcripts');
  const captured = (): string[] => {
    const files: string[] = [];
    if (!existsSync(transcriptRoot)) return files;
    for (const repo of readdirSync(transcriptRoot, { withFileTypes: true })) {
      if (!repo.isDirectory()) continue;
      for (const day of readdirSync(path.join(transcriptRoot, repo.name), {
        withFileTypes: true,
      })) {
        const f = path.join(transcriptRoot, repo.name, day.name, 'selftest.jsonl');
        if (day.isDirectory() && existsSync(f) && statSync(f).isFile()) files.push(f);
      }
    }
    return files;
  };
  for (const m of o.members) {
    if (o.selfTests === false) {
      add(`E6:${m.name}`, 'skipped', 'self-tests turned off');
      continue;
    }
    const ran = await run(
      m.dir,
      ['-c', 'alias.memscript=!.claude/hooks/memory-session-end', 'memscript'],
      {
        env: { CLAUDE_PROJECT_DIR: m.dir, MEMORY_STORE_DIR: storePath },
        stdin: JSON.stringify({ session_id: 'selftest', transcript_path: '.memory-link' }),
      },
    );
    const found = captured();
    const leaked = found.length
      ? (await git.status(o.store)).filter((e) => e.path.includes('selftest.jsonl'))
      : [];
    for (const f of found) rmSync(f, { force: true });
    if (found.length === 0 && ran.code !== 0) {
      add(
        `E6:${m.name}`,
        'failed',
        `the SessionEnd hook failed (exit ${ran.code}): ${lastLine(ran.stderr)}`,
      );
    } else if (found.length === 0) {
      // The seed hook exits 0 on any problem by design, so a silent no-op is a warning, not a failure. The usual cause
      // is a store with no bin/redact-transcript.mjs (or no node): the hook copies nothing rather than a raw transcript.
      add(
        `E6:${m.name}`,
        'warning',
        'the SessionEnd hook ran but captured no transcript: it copies nothing when node or bin/redact-transcript.mjs in the store is missing (copy bin/redact-transcript.mjs from the seed into the store), because a raw copy would hold secrets',
      );
    } else if (leaked.length) {
      add(`E6:${m.name}`, 'failed', 'the captured transcript is not ignored by git');
    } else {
      add(
        `E6:${m.name}`,
        'passed',
        'the SessionEnd hook captured a transcript, and git ignores it',
      );
    }
  }

  return { commit, checks };
}
