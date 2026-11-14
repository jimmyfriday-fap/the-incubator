import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MEMBER_NAME,
  MEMORY_ALLOWED_TOOLS,
  MEMORY_AVAILABLE_TOOLS,
  allowedMemoryPath,
  checkMemoryInput,
  checkTerms,
  copySeed,
  installedPolicy,
  kebab,
  memoryConsumptionLine,
  memoryPrompt,
  memorySeedDir,
  olderSeed,
  parseMemoryReport,
  prefillIsolationTerms,
  repoNameFromRemote,
  seedVersion,
} from './memory.js';
import type { PortfolioProject } from './portfolio.js';
import { loadPrompt } from './prompts.js';

const tmp = (prefix: string) => mkdtempSync(path.join(os.tmpdir(), prefix));

const REPORT = [
  'Installed the memory store.',
  '',
  '## Memory bootstrap report',
  '',
  '- Commit policy: `pr` (branch memory/bootstrap)',
  '- Verification 1–7: all passed',
  '- Isolation terms kept: alpha, beta; dropped (used by this repo): gamma',
].join('\n');

describe('the memory seed (plan 071)', () => {
  it('is found through INCUBATOR_MEMORY_SEED_DIR, else in assets/memory-seed', () => {
    expect(memorySeedDir({ INCUBATOR_MEMORY_SEED_DIR: 'staged-seed' })).toBe(
      path.resolve('staged-seed'),
    );
    expect(existsSync(path.join(memorySeedDir({}), 'playbooks', 'deploy-repo.md'))).toBe(true);
    expect(seedVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('refuses a missing seed and a version that is not semver', () => {
    expect(() => seedVersion(tmp('no-seed-'))).toThrow(/no memory seed/);
    const bad = tmp('bad-seed-');
    writeFileSync(path.join(bad, 'VERSION'), 'v1\n');
    expect(() => seedVersion(bad)).toThrow(/is not a version/);
  });

  it('compares seed versions numerically', () => {
    expect(olderSeed('1.2.3', '1.10.0')).toBe(true);
    expect(olderSeed('2.0.0', '1.9.9')).toBe(false);
    expect(olderSeed('1.0.0', '1.0.0')).toBe(false);
  });

  it('copies the seed for one run and returns its version', () => {
    const to = path.join(tmp('seed-copy-'), 'memory-seed');
    expect(copySeed(to)).toBe(seedVersion());
    expect(existsSync(path.join(to, 'playbooks', 'deploy-repo.md'))).toBe(true);
  });
});

describe('the owner choices (plan 071)', () => {
  it('turns a name into a kebab-case system name', () => {
    expect(kebab('Rolling Schedule')).toBe('rolling-schedule');
    expect(kebab('  --A__b--  ')).toBe('a-b');
  });

  it('trims and deduplicates isolation terms, and refuses anything that is not a code identifier', () => {
    expect(checkTerms(['  foo ', 'foo', '', 'bar.baz'])).toEqual(['foo', 'bar.baz']);
    expect(() => checkTerms(['has space'])).toThrow(/not a code identifier/);
    expect(() => checkTerms(Array.from({ length: 201 }, (_, i) => `t${i}`))).toThrow(/at most 200/);
  });

  it('checks a whole memory input', () => {
    expect(
      checkMemoryInput({
        system: 'shop',
        isolationTerms: [' ab ', 'ab'],
        commitPolicy: 'pr',
      }),
    ).toEqual({ system: 'shop', isolationTerms: ['ab'], commitPolicy: 'pr' });
    expect(() =>
      checkMemoryInput({ system: 'Rolling Schedule', isolationTerms: [], commitPolicy: 'pr' }),
    ).toThrow(/kebab-case/);
    expect(() =>
      checkMemoryInput({
        system: 'shop',
        isolationTerms: [],
        commitPolicy: 'merge' as never,
      }),
    ).toThrow(/auto, pr or direct/);
    expect(() =>
      checkMemoryInput({
        system: 'shop',
        isolationTerms: [],
        commitPolicy: 'pr',
        effort: 'huge',
      }),
    ).toThrow(/effort is one of/);
  });

  it('prefills isolation terms from other solutions only, skipping the same system', () => {
    const p = (id: string, extra: Partial<PortfolioProject>) =>
      ({ id, ...extra }) as PortfolioProject;
    const projects = [
      p('a', { identifiers: ['alpha'] }),
      p('b', { identifiers: ['zeta', 'beta', 'has space'] }),
      p('c', {
        identifiers: ['gamma'],
        memory: {
          mode: 'repo',
          system: 'shop',
          store: '.memory/',
          seedVersion: '1.0.0',
          commitPolicy: 'pr',
          installedAt: '2026-11-01',
          report: '',
        },
      }),
      p('d', { identifiers: ['beta'] }),
    ];
    expect(prefillIsolationTerms(projects, ['a'], 'shop')).toEqual(['beta', 'zeta']);
  });
});

describe('the memory session (plan 071)', () => {
  it('never allows a push, gh or the network', () => {
    expect(MEMORY_ALLOWED_TOOLS.filter((t) => /push|\bgh\b|curl|wget|npm|pnpm/.test(t))).toEqual(
      [],
    );
    expect(MEMORY_ALLOWED_TOOLS).toContain('Bash(git checkout -b memory/bootstrap)');
    expect(MEMORY_ALLOWED_TOOLS).toContain('Bash(git commit:*)');
    // The playbook's step D3 reads core.hooksPath; that read-only form must be allowed (AC1, 2026-11-06).
    expect(MEMORY_ALLOWED_TOOLS).toContain('Bash(git config core.hooksPath)');
  });

  it('leaves the session no PowerShell and no tool the allow list does not name', () => {
    // --allowedTools only pre-approves; the Windows PowerShell tool is gone only if --tools excludes it.
    expect(MEMORY_AVAILABLE_TOOLS).toEqual(['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash']);
    expect(MEMORY_AVAILABLE_TOOLS.some((t) => /powershell/i.test(t))).toBe(false);
    const named = new Set(MEMORY_ALLOWED_TOOLS.map((t) => t.replace(/\(.*$/, '')));
    for (const t of named) expect(MEMORY_AVAILABLE_TOOLS as readonly string[]).toContain(t);
  });

  it('builds the prompt from the wrapper and the playbook inputs, with forward slashes', () => {
    const prompt = memoryPrompt({
      target: 'work\\shop',
      seed: 'runs\\r1\\memory-seed',
      stubs: 'runs\\r1\\memory-stubs',
      terms: [],
      policy: 'pr',
      today: '2026-11-03',
    });
    expect(prompt.startsWith(loadPrompt('memory-repo').body)).toBe(true);
    expect(prompt).toContain('Follow `runs/r1/memory-seed/playbooks/deploy-repo.md`');
    expect(prompt).toContain('TARGET: work/shop');
    expect(prompt).toContain('SEED: runs/r1/memory-seed');
    expect(prompt).toContain('STUBS: runs/r1/memory-stubs');
    expect(prompt).toContain('ISOLATION_TERMS: (none)');
    expect(prompt).toContain('COMMIT_POLICY: pr');
    expect(prompt).toContain('TODAY: 2026-11-03');
    expect(
      memoryPrompt({
        target: 't',
        seed: 's',
        stubs: 'u',
        terms: ['a', 'b'],
        policy: 'direct',
        today: 'x',
      }),
    ).toContain('ISOLATION_TERMS: a, b');
  });

  it('reads the playbook report back', () => {
    expect(parseMemoryReport(null)).toBeNull();
    expect(parseMemoryReport('no report here')).toBeNull();
    const r = parseMemoryReport(REPORT)!;
    expect(r.text.startsWith('## Memory bootstrap report')).toBe(true);
    expect(r.policy).toBe('pr');
    expect(r.verificationPassed).toBe(true);
    expect(r.kept).toEqual(['alpha', 'beta']);
    expect(r.dropped).toEqual(['gamma']);
  });

  it('treats a failed verification step and Windows line endings correctly', () => {
    const failed = REPORT.replace('all passed', '1–5 passed, 6 failed').replace(/\n/g, '\r\n');
    const r = parseMemoryReport(failed)!;
    expect(r.verificationPassed).toBe(false);
    expect(r.text.includes('\r')).toBe(false);
    const none = parseMemoryReport('## Memory bootstrap report\n- Isolation terms kept: none\n')!;
    expect(none.kept).toEqual([]);
    expect(none.dropped).toEqual([]);
    expect(none.policy).toBeNull();
  });

  it('accepts steps the agent ran as passed when it leaves the hook steps to the Incubator, but not a failure', () => {
    const left = REPORT.replace(
      'all passed',
      'checks 1, 2, 3 and 7 passed. Checks 4, 5 and 6 are left to the Incubator.',
    );
    expect(parseMemoryReport(left)!.verificationPassed).toBe(true);
    const leftAndFailed = REPORT.replace(
      'all passed',
      'check 2 failed. Checks 4, 5 and 6 are left to the Incubator.',
    );
    expect(parseMemoryReport(leftAndFailed)!.verificationPassed).toBe(false);
    const unsaid = REPORT.replace('all passed', 'checks 1 and 2 passed.');
    expect(parseMemoryReport(unsaid)!.verificationPassed).toBe(false);
  });

  it('allows only the memory install paths', () => {
    for (const ok of [
      '.memory/INDEX.md',
      '.memory\\memory.conf',
      '.claude/skills/write-memory/SKILL.md',
      '.claude/settings.json',
      'CLAUDE.md',
    ])
      expect(allowedMemoryPath(ok), ok).toBe(true);
    for (const no of ['AGENTS.md', 'src/index.ts', '.claude/agents/x.md'])
      expect(allowedMemoryPath(no), no).toBe(false);
  });

  it('reads the commit policy the install wrote', () => {
    const repo = tmp('memory-conf-');
    expect(installedPolicy(repo)).toBeNull();
    mkdirSync(path.join(repo, '.memory'));
    writeFileSync(
      path.join(repo, '.memory', 'memory.conf'),
      'store = .memory/\ncommit_policy = direct\n',
    );
    expect(installedPolicy(repo)).toBe('direct');
    writeFileSync(path.join(repo, '.memory', 'memory.conf'), 'commit_policy = maybe\n');
    expect(installedPolicy(repo)).toBeNull();
  });

  it('points later runs at the store index', () => {
    const line = memoryConsumptionLine('.memory/');
    expect(line).toContain('`.memory/`');
    expect(line).toContain('INDEX.md');
    expect(line).toContain('write-memory');
    // Capped: the index, then at most two files, so a coding session does not read the whole store.
    expect(line).toContain('at most the two files whose description matches this step');
  });
});

describe('repoNameFromRemote (plan 079 WI-2)', () => {
  it('takes the last segment of an https or ssh remote and drops .git', () => {
    expect(repoNameFromRemote('git@github.com:o/site.cloud.git')).toBe('site.cloud');
    expect(repoNameFromRemote('https://github.com/o/backshack-workspace.git')).toBe(
      'backshack-workspace',
    );
    expect(repoNameFromRemote('https://github.com/o/x/')).toBe('x');
    expect(repoNameFromRemote('ssh://git@host/o/r.git')).toBe('r');
    expect(repoNameFromRemote(null)).toBeNull();
    expect(repoNameFromRemote('')).toBeNull();
    expect(repoNameFromRemote('justaname')).toBeNull();
  });

  it('accepts dotted repository names and refuses spaces and a leading dot', () => {
    expect(MEMBER_NAME.test('site.cloud')).toBe(true);
    expect(MEMBER_NAME.test('backshack-workspace')).toBe(true);
    expect(MEMBER_NAME.test('Local Sites')).toBe(false);
    expect(MEMBER_NAME.test('.hidden')).toBe(false);
    expect(MEMBER_NAME.test('a/b')).toBe(false);
  });
});
