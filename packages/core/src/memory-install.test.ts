import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitOps } from '@incubator/git';
import { ParkError, nodeExec } from '@incubator/runtime';
import {
  HOOK_LINE,
  MAX_STUBS,
  SESSION_END_COMMAND,
  checksReport,
  copySkills,
  installMemoryProtected,
  mergeSessionEnd,
  preCommitHook,
} from './memory-install.js';

const SEED = path.resolve(import.meta.dirname, '../../../assets/memory-seed');
/**
 * The seed's session-end hook, with the carriage return that Windows python3 puts at the end of the transcript path
 * stripped. The unpatched hook captures nothing on Windows when python3 is installed (a seed defect, reported to its
 * owner; the seed is never edited here), so these tests run the Incubator's code against the hook working as meant.
 */
function sessionEndHook(): string {
  const text = readFileSync(path.join(SEED, 'hooks', 'session-end'), 'utf8');
  const guard = '[ -n "${sid:-}" ] && [ -f "${src:-}" ] || exit 0';
  if (!text.includes(guard))
    throw new Error('the seed session-end hook changed: update this test helper');
  // why: a function replacer, because `$'` in a replacement string means "the text after the match".
  return text.replace(guard, () => `src="\${src%$'\\r'}"\n${guard}`);
}

const tmp = (name: string) => mkdtempSync(path.join(os.tmpdir(), `${name} `));

describe('mergeSessionEnd', () => {
  const entry = { hooks: [{ type: 'command', command: SESSION_END_COMMAND }] };

  it('makes a new settings file when there is none', () => {
    expect(JSON.parse(mergeSessionEnd(null))).toEqual({ hooks: { SessionEnd: [entry] } });
    expect(JSON.parse(mergeSessionEnd('  '))).toEqual({ hooks: { SessionEnd: [entry] } });
  });

  it('keeps every other key and appends to an existing SessionEnd list', () => {
    const before = JSON.stringify({
      permissions: { allow: ['Read'] },
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'x' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'mine' }] }],
      },
    });
    const after = JSON.parse(mergeSessionEnd(before)) as {
      permissions: unknown;
      hooks: { Stop: unknown[]; SessionEnd: unknown[] };
    };
    expect(after.permissions).toEqual({ allow: ['Read'] });
    expect(after.hooks.Stop).toHaveLength(1);
    expect(after.hooks.SessionEnd).toEqual([
      { hooks: [{ type: 'command', command: 'mine' }] },
      entry,
    ]);
  });

  it('adds nothing the second time', () => {
    const once = mergeSessionEnd(null);
    expect(mergeSessionEnd(once)).toBe(once);
  });

  it('parks, with a reason, on a settings file it cannot merge into', () => {
    for (const bad of ['{ nope', '[]', '{"hooks": 3}', '{"hooks": {"SessionEnd": {}}}']) {
      try {
        mergeSessionEnd(bad);
        throw new Error(`no park for ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ParkError);
        expect((e as ParkError).reason).toBe('memory_settings_invalid');
      }
    }
  });
});

describe('preCommitHook', () => {
  it('makes a hook that runs the memory hook when there is none', () => {
    expect(preCommitHook(null)).toBe(`#!/usr/bin/env bash\nexec ${HOOK_LINE}\n`);
  });

  it('appends the memory line to an existing hook, once', () => {
    const existing = '#!/bin/sh\nlefthook run pre-commit';
    const once = preCommitHook(existing);
    expect(once).toBe(`#!/bin/sh\nlefthook run pre-commit\n${HOOK_LINE} || exit 1\n`);
    expect(preCommitHook(once)).toBe(once);
  });
});

describe('copySkills', () => {
  const seedWithSkills = () => {
    const seed = tmp('seed');
    for (const n of ['write-memory', 'dream', 'memory-bootstrap']) {
      mkdirSync(path.join(seed, 'skills', n), { recursive: true });
      writeFileSync(path.join(seed, 'skills', n, 'SKILL.md'), `---\nname: ${n}\n---\n`);
    }
    return seed;
  };
  const stub = (stubs: string, name: string, withFile = true) => {
    mkdirSync(path.join(stubs, name), { recursive: true });
    if (withFile) writeFileSync(path.join(stubs, name, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  };

  it('installs the three seed skills and the stubs', () => {
    const repo = tmp('repo');
    const stubs = tmp('stubs');
    stub(stubs, 'ship-release');
    expect(copySkills(seedWithSkills(), repo, stubs)).toEqual([
      'write-memory',
      'dream',
      'memory-bootstrap',
      'ship-release',
    ]);
    for (const n of ['write-memory', 'dream', 'memory-bootstrap', 'ship-release'])
      expect(existsSync(path.join(repo, '.claude', 'skills', n, 'SKILL.md'))).toBe(true);
  });

  it('works with no stubs at all, and when the stubs folder is missing', () => {
    expect(copySkills(seedWithSkills(), tmp('repo'), tmp('stubs'))).toHaveLength(3);
    expect(copySkills(seedWithSkills(), tmp('repo'), path.join(tmp('x'), 'missing'))).toHaveLength(
      3,
    );
  });

  it('refuses a stub that is badly named, reuses a seed skill, has no SKILL.md or is the sixth', () => {
    const attempt = (prepare: (stubs: string) => void): string => {
      const repo = tmp('repo');
      const stubs = tmp('stubs');
      prepare(stubs);
      try {
        copySkills(seedWithSkills(), repo, stubs);
      } catch (e) {
        expect(existsSync(path.join(repo, '.claude'))).toBe(false);
        return (e as ParkError).reason;
      }
      return 'no error';
    };
    expect(attempt((s) => stub(s, 'Not_Kebab'))).toBe('memory_stub_invalid');
    expect(attempt((s) => stub(s, 'dream'))).toBe('memory_stub_invalid');
    expect(attempt((s) => stub(s, 'empty', false))).toBe('memory_stub_invalid');
    expect(
      attempt((s) => {
        for (let i = 0; i <= MAX_STUBS; i++) stub(s, `stub-${i}`);
      }),
    ).toBe('memory_stub_invalid');
  });
});

describe('installMemoryProtected', () => {
  const git = createGitOps(nodeExec);
  const g = (dir: string, ...args: string[]) =>
    nodeExec.run('git', args, { cwd: dir, timeoutMs: 30_000 }).then((r) => r.stdout.trim());

  beforeEach(() => {
    // Hermetic git: no machine-wide identity or hooks.
    const cfg = path.join(tmp('install gitcfg'), 'gitconfig');
    writeFileSync(cfg, '');
    vi.stubEnv('GIT_CONFIG_GLOBAL', cfg);
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A repo with what the agent leaves behind: a small store with the seed's scripts, committed. */
  async function afterAgent(policy: 'pr' | 'direct' = 'direct') {
    const dir = tmp('repo');
    await g(dir, 'init', '-q', '-b', 'main');
    await g(dir, 'config', 'user.name', 'Owner Person');
    await g(dir, 'config', 'user.email', 'owner@example.invalid');
    writeFileSync(path.join(dir, 'README.md'), '# shop\n');
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', 'initial');
    if (policy === 'pr') await g(dir, 'checkout', '-q', '-b', 'memory/bootstrap');
    const mem = path.join(dir, '.memory');
    mkdirSync(path.join(mem, 'bin'), { recursive: true });
    mkdirSync(path.join(mem, 'hooks'), { recursive: true });
    copyFileSync(path.join(SEED, 'bin', 'memory'), path.join(mem, 'bin', 'memory'));
    copyFileSync(path.join(SEED, 'hooks', 'pre-commit'), path.join(mem, 'hooks', 'pre-commit'));
    writeFileSync(path.join(mem, 'hooks', 'session-end'), sessionEndHook());
    // The playbook has the real agent run `chmod +x` on these three; Linux and macOS refuse to run them without it.
    for (const script of [
      ['bin', 'memory'],
      ['hooks', 'pre-commit'],
      ['hooks', 'session-end'],
    ])
      chmodSync(path.join(mem, ...(script as [string, string])), 0o755);
    copyFileSync(path.join(SEED, 'templates', 'gitignore'), path.join(mem, '.gitignore'));
    const page = (name: string, tier: string) =>
      `---\nname: ${name}\ntier: ${tier}\ndescription: ${name}\nlast_verified: 2026-11-03\n---\n- [2026-11-03] [bootstrap] A fact (src: README.md)\n`;
    mkdirSync(path.join(mem, 'context', 'platform'), { recursive: true });
    writeFileSync(
      path.join(mem, 'context', 'platform', 'conventions.md'),
      page('conventions', 'platform'),
    );
    mkdirSync(path.join(mem, 'context', 'projects', 'shop'), { recursive: true });
    writeFileSync(
      path.join(mem, 'context', 'projects', 'shop', 'failures.md'),
      page('failures', 'project'),
    );
    writeFileSync(path.join(mem, 'memory.conf'), `commit_policy=${policy}\n`);
    mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
    await g(dir, '-c', 'alias.mem=!.memory/bin/memory index', 'mem');
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', 'chore(memory): bootstrap');
    const stubs = tmp('stubs');
    mkdirSync(path.join(stubs, 'ship-release'));
    writeFileSync(
      path.join(stubs, 'ship-release', 'SKILL.md'),
      '---\nname: ship-release\ndescription: Ships a release.\n---\nStatus: stub from bootstrap.\n',
    );
    return { dir, stubs };
  }

  it('installs the protected files, commits them, and passes the playbook checks 4 to 6', async () => {
    const { dir, stubs } = await afterAgent('pr');
    const before = await g(dir, 'rev-list', '--count', 'HEAD');
    const r = await installMemoryProtected({ exec: nodeExec, git, dir, seed: SEED, stubs });
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    expect(r.checks.map((c) => `${c.step}:${c.status}`)).toEqual([
      'skills:passed',
      'settings:passed',
      'git-hook:passed',
      'index:passed',
      'commit:passed',
      'E4:passed',
      'E5:passed',
      'E6:passed',
    ]);
    expect(r.commit).toBe(await g(dir, 'rev-parse', 'HEAD'));
    // Exactly one commit more, holding the skills, the settings and the regenerated index.
    expect(await g(dir, 'rev-list', '--count', 'HEAD')).toBe(String(Number(before) + 1));
    const files = (await g(dir, 'show', '--name-only', '--format=', 'HEAD')).split('\n').sort();
    expect(files).toEqual([
      '.claude/settings.json',
      '.claude/skills/dream/SKILL.md',
      '.claude/skills/memory-bootstrap/SKILL.md',
      '.claude/skills/ship-release/SKILL.md',
      '.claude/skills/write-memory/SKILL.md',
      '.memory/INDEX.md',
    ]);
    expect(readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8')).toContain(
      '.memory/hooks/pre-commit',
    );
    // The self-tests leave nothing behind.
    expect(await g(dir, 'status', '--porcelain')).toBe('');
    expect(
      readFileSync(path.join(dir, '.memory/context/projects/shop/failures.md'), 'utf8'),
    ).not.toContain('not a dated line');
    expect(existsSync(path.join(dir, '.memory', 'transcripts', 'README.md'))).toBe(false);
    expect(checksReport(r.checks)).toContain('- E4: passed');
  });

  it('warns, and does not block, when the SessionEnd hook runs but captures nothing; fails when it errors', async () => {
    const hook = (body: string) => `#!/usr/bin/env bash\n${body}\n`;
    const withHook = async (body: string) => {
      const { dir, stubs } = await afterAgent('direct');
      writeFileSync(path.join(dir, '.memory', 'hooks', 'session-end'), hook(body));
      await g(dir, 'add', '-A');
      await g(dir, 'commit', '-q', '-m', 'change the session-end hook');
      const r = await installMemoryProtected({ exec: nodeExec, git, dir, seed: SEED, stubs });
      return r.checks.find((c) => c.step === 'E6')!;
    };
    // Exits 0 and captures nothing, as the seed hook does on Windows when python3 ends the path with \r.
    const silent = await withHook('cat >/dev/null; exit 0');
    expect(silent.status).toBe('warning');
    expect(silent.detail).toContain('will not be captured until the seed hook is fixed');
    expect((await withHook('cat >/dev/null; echo broken >&2; exit 4')).status).toBe('failed');
  });

  it('fails step 4 and undoes its own test commit when the hook lets a bad line through', async () => {
    const { dir, stubs } = await afterAgent('direct');
    // A hook that accepts everything: the wiring exists, the guard does not.
    writeFileSync(
      path.join(dir, '.memory', 'hooks', 'pre-commit'),
      '#!/usr/bin/env bash\nexit 0\n',
    );
    await g(dir, 'add', '-A');
    await g(dir, 'commit', '-q', '-m', 'weaken the hook');
    const r = await installMemoryProtected({ exec: nodeExec, git, dir, seed: SEED, stubs });
    expect(r.checks.find((c) => c.step === 'E4')?.status).toBe('failed');
    // HEAD is the install commit, not the test commit, and the tree is clean.
    expect(r.commit).toBe(await g(dir, 'rev-parse', 'HEAD'));
    expect(await g(dir, 'status', '--porcelain')).toBe('');
    expect(
      readFileSync(path.join(dir, '.memory/context/projects/shop/failures.md'), 'utf8'),
    ).not.toContain('not a dated line');
  });

  it('adds the memory line to a hook the repository already has', async () => {
    const { dir, stubs } = await afterAgent('direct');
    mkdirSync(path.join(dir, '.git', 'hooks'), { recursive: true });
    writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho theirs\n');
    const r = await installMemoryProtected({ exec: nodeExec, git, dir, seed: SEED, stubs });
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    const hook = readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook.startsWith('#!/bin/sh\necho theirs\n')).toBe(true);
    expect(hook).toContain(`${HOOK_LINE} || exit 1`);
  });

  it('leaves a hook that lives inside the repository to the owner, and says so', async () => {
    const { dir, stubs } = await afterAgent('direct');
    await g(dir, 'config', 'core.hooksPath', '.githooks');
    const r = await installMemoryProtected({ exec: nodeExec, git, dir, seed: SEED, stubs });
    expect(r.checks.find((c) => c.step === 'git-hook')?.status).toBe('skipped');
    expect(r.checks.find((c) => c.step === 'E4')?.status).toBe('skipped');
    expect(r.checks.filter((c) => c.status === 'failed')).toEqual([]);
    expect(existsSync(path.join(dir, '.githooks'))).toBe(false);
  });
});
