import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_CHECKS,
  externalTools,
  isCanonicalRepo,
  normalizeChecks,
  validateChecks,
} from './checks.js';

const ok = (c: string) => validateChecks([c]);

describe('check commands (ADR-025)', () => {
  it('accepts the plain commands repositories use', () => {
    for (const c of [
      'flutter analyze',
      'flutter test',
      'dart test',
      'npm run test',
      'pnpm run lint',
      'pytest',
      'cargo test',
      'go test ./...',
      'dotnet test',
      './gradlew test',
      'mvn test',
      'bundle exec rspec',
      'mix test',
      'make test',
      'pnpm run test --filter=@scope/pkg',
    ])
      expect(ok(c), c).toEqual([]);
    expect(validateChecks([])).toEqual([]);
  });

  it('refuses anything that could run something else', () => {
    const cases: [string, RegExp][] = [
      ['flutter test; rm -rf .', /not allowed/],
      ['flutter test && flutter build', /not allowed/],
      ['npm run test | tee out', /not allowed/],
      ['npm run test > out.txt', /not allowed/],
      ['echo $(whoami)', /not allowed/],
      ['echo `id`', /not allowed/],
      ['flutter test "my dir"', /not allowed/],
      ['flutter test,Bash(rm:*)', /not allowed/],
      ['flutter test:*)', /not allowed/],
      ['bash', /can run anything/],
      ['sh run.sh', /can run anything/],
      ['pwsh.exe script', /can run anything/],
      ['git commit -m x', /can run anything/],
      ['sudo make test', /can run anything/],
      ['env X=1 make test', /can run anything/],
      ['curl example.com', /can run anything/],
      ['flutter', /needs its subcommand/],
      ['npm', /needs its subcommand/],
      ['node --test', /needs its subcommand/],
      ['python -m pytest', /needs its subcommand/],
      ['node script.js -e x', /inline code/],
      ['../bin/tool test', /may not leave the repository/],
      ['tool ../../etc', /may not leave the repository/],
      ['/usr/bin/flutter test', /not an absolute path/],
      ['C:/tools/flutter test', /not allowed|absolute path/],
      ['-rf x', /cannot start with/],
      [' flutter test', /single spaces/],
      ['flutter  test', /single spaces/],
      ['a'.repeat(121), /longer than/],
      ['x 1 2 3 4 5 6 7 8', /more than 8 words/],
    ];
    for (const [c, why] of cases) {
      const issues = ok(c);
      expect(issues.length, c).toBeGreaterThan(0);
      expect(issues[0]!.message, c).toMatch(why);
      expect(issues[0]!.path).toBe('/commands/0');
    }
    expect(validateChecks(['flutter test', 'flutter test'])[0]!.message).toContain('listed twice');
    const many = Array.from({ length: MAX_CHECKS + 1 }, (_, i) => `make t${i}`);
    expect(validateChecks(many).map((i) => i.code)).toContain('check_count');
  });

  it('normalizes what the owner typed before it is validated', () => {
    expect(normalizeChecks(['  flutter   test ', '', '   ', 'dart\tanalyze'])).toEqual([
      'flutter test',
      'dart analyze',
    ]);
  });

  it('builds the whole tool list: edit tools, the approved commands, read-only git', () => {
    expect(externalTools([])).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git status:*)',
      'Bash(git diff:*)',
    ]);
    expect(externalTools(['flutter test'])).toContain('Bash(flutter test:*)');
    // No entry can widen the list: a comma or a parenthesis never survives validation.
    for (const t of externalTools(['flutter analyze', 'go test ./...']))
      expect(t).toMatch(/^[A-Za-z]+$|^Bash\([A-Za-z0-9_@%+=./ -]+:\*\)$/);
  });

  it('knows an Incubator-built repository by its gate', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'canonical repo '));
    expect(isCanonicalRepo(dir)).toBe(false);
    mkdirSync(path.join(dir, '.incubator'));
    mkdirSync(path.join(dir, 'scripts'));
    writeFileSync(path.join(dir, '.incubator', 'lock.json'), '{}');
    writeFileSync(path.join(dir, 'scripts', 'check.mjs'), '');
    expect(isCanonicalRepo(dir)).toBe(false);
    writeFileSync(path.join(dir, '.incubator', 'agent-profile.json'), '{}');
    expect(isCanonicalRepo(dir)).toBe(true);
  });
});
