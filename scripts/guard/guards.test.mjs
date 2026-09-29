// Unit tests for the guard toolkit. Each guard is exercised against a throwaway repo tree.
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findAbsolutePaths } from './abs-path.mjs';
import { findBoms } from './bom.mjs';
import { evaluateNeeds } from './ci-gate.mjs';
import { checkPins, updatePins } from './contracts-pin.mjs';
import { checkBoundaries } from './deps-boundary.mjs';
import { checkDrift, expandId } from './drift.mjs';
import { findIsolationIssues } from './isolation.mjs';
import { checkLanes } from './lane-contract.mjs';
import { globToRegExp, parseArgs } from './lib/common.mjs';
import { parseEnrichOutput } from './lib/enrich-contract.mjs';
import { gitleaksFindings, semgrepFindings, trivyFindings } from './lib/findings.mjs';
import { regionBody, scanMarkers } from './lib/markers.mjs';
import { parseCmdShim } from './lib/proc.mjs';
import { evaluateAssertion, getPath, validateScenario } from './lib/scenario.mjs';
import { lintPlan, lintPlans } from './plan-lint.mjs';
import { gate, validateRegister } from './policy-gate.mjs';
import { checkQuarantine } from './quarantine.mjs';
import { checkSyntax } from './syntax.mjs';
import { countTests } from './tests-collected.mjs';
import { validateResults } from './validate-scan-results.mjs';
import { lintWorkflow } from './workflow-lint.mjs';

function repo(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'guard-'));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

describe('common helpers', () => {
  it('parses flags and positionals', () => {
    expect(parseArgs(['--a', 'x', '--b=y', '--update', 'f1', '--quiet', 'f2'])).toEqual({
      flags: { a: 'x', b: 'y', update: true, quiet: true },
      positional: ['f1', 'f2'],
    });
  });
  it('matches globs', () => {
    expect(globToRegExp('schemas/*.json').test('schemas/a.json')).toBe(true);
    expect(globToRegExp('schemas/*.json').test('schemas/x/a.json')).toBe(false);
    expect(globToRegExp('tests/**/*.json').test('tests/a.json')).toBe(true);
    expect(globToRegExp('tests/**/*.json').test('tests/a/b/c.json')).toBe(true);
    expect(globToRegExp('*.{ts,js}').test('a.js')).toBe(true);
    expect(globToRegExp('a?c').test('abc')).toBe(true);
  });
  it('parses cmd shims like the runtime does', () => {
    expect(parseCmdShim('"%~dp0\\..\\x\\bin\\x.js" %*', 'C:\\r\\node_modules\\.bin\\x.cmd')).toBe(
      'C:\\r\\node_modules\\x\\bin\\x.js',
    );
    expect(parseCmdShim('echo', 'C:\\x.cmd')).toBeNull();
  });
});

describe('bom and abs-path', () => {
  it('flags BOMs only', () => {
    const root = repo({ 'a.txt': '\uFEFFhi', 'b.txt': 'hi' });
    expect(findBoms(root, ['a.txt', 'b.txt', 'missing.txt'])).toEqual([
      'a.txt: starts with a UTF-8 BOM',
    ]);
  });
  it('flags machine paths and honours the allow marker', () => {
    const root = repo({
      'a.json': '{"p": "C:\\\\Users\\\\bob\\\\x"}\n',
      'b.md': 'see /home/alice/project/file\n',
      'c.md': 'see /Users/alice/project/file // abs-path-lint: allow\n',
      'd.txt': 'share \\\\server\\share\\x\n',
      'e.ts': "const rel = './home/x'; const url = 'https://example.com/home/x/';\n",
    });
    const out = findAbsolutePaths(root, ['a.json', 'b.md', 'c.md', 'd.txt', 'e.ts']);
    expect(out.map((f) => f.split(':')[0])).toEqual(['a.json', 'b.md', 'd.txt']);
    expect(findAbsolutePaths(root, ['a.json'], ['*.json'])).toEqual([]);
  });
});

describe('isolation', () => {
  it('flags escaping imports, includes, sys.path, links and symlinks', () => {
    const root = repo({
      // The absolute specifier is split so this test file does not trip the isolation guard itself.
      'src/a.ts':
        "import x from '../../outside.js';\nimport y from './ok.js';\nconst z = require(" +
        "'/abs/path');\n",
      'src/ok.ts': 'export {};\n',
      'src/p.php': "<?php require_once __DIR__ . '/../../vendor/x.php'; include 'lib/ok.php';\n",
      'src/s.py': "import sys\nsys.path.append('../..')\n",
      'CLAUDE.md': '[x](../elsewhere/CLAUDE.md) [ok](docs/a.md) [web](https://x.dev)\n',
    });
    symlinkSync(tmpdir(), path.join(root, 'escape-link'));
    const out = findIsolationIssues(root, [
      'src/a.ts',
      'src/ok.ts',
      'src/p.php',
      'src/s.py',
      'CLAUDE.md',
      'escape-link',
    ]);
    expect(out).toHaveLength(6);
    expect(out.join('\n')).toMatch(/outside\.js/);
    expect(out.join('\n')).toMatch(/absolute import/);
    expect(out.join('\n')).toMatch(/symlink escapes/);
  });
});

describe('deps-boundary', () => {
  it('rejects undeclared edges, undeclared imports and cycles', () => {
    const root = repo({
      'config/deps-boundary.json': JSON.stringify({
        packages: { 'p/a': ['p/b'], 'p/b': ['p/a'], 'p/c': [] },
      }),
      'p/a/package.json': JSON.stringify({ name: '@s/a', dependencies: { '@s/b': '1' } }),
      'p/b/package.json': JSON.stringify({ name: '@s/b', dependencies: { '@s/a': '1' } }),
      'p/c/package.json': JSON.stringify({ name: '@s/c', dependencies: { '@s/a': '1' } }),
      'p/c/src/x.ts': "import { a } from '@s/a';\nimport { b } from '@s/b';\n",
    });
    const out = checkBoundaries(root).join('\n');
    expect(out).toMatch(/cycle/);
    expect(out).toMatch(/@s\/c: depends on @s\/a/);
    expect(out).toMatch(/imports @s\/b without declaring/);
  });
});

describe('contracts-pin', () => {
  it('pins, verifies and detects edits', () => {
    const root = repo({
      'config/contracts.json': JSON.stringify({ pinned: ['schemas/*.json'] }),
      'schemas/a.json': '{}\n',
    });
    expect(checkPins(root)).toEqual([
      'schemas/a.json: contract file is not pinned (run the contracts:pin human-only action)',
    ]);
    expect(updatePins(root)).toBe(1);
    expect(checkPins(root)).toEqual([]);
    writeFileSync(path.join(root, 'schemas/a.json'), '{"x":1}\n');
    expect(checkPins(root)).toEqual(['schemas/a.json: content does not match its pin']);
  });
});

const GOOD_PLAN = `# Plan
## Executor preamble
Do it.
## Touched files and markers
| File | Marker |
|---|---|
| a | b |
## Acceptance commands
\`\`\`
pnpm check
\`\`\`
\`\`\`
exit 0
\`\`\`
## Drift and hallucination guardrails
| Trap | Why | Mechanical check |
|---|---|---|
| t | w | c |
## Review rounds
| Round | Status |
|---|---|
| 1 | CLOSED |
`;

describe('plan-lint', () => {
  it('accepts a complete plan', () => {
    expect(lintPlan('docs/plans/001-x.md', GOOD_PLAN)).toEqual([]);
  });
  it('reports missing sections, bad tables and root plans', () => {
    expect(lintPlan('p.md', '# nothing')).toHaveLength(5);
    const bad = GOOD_PLAN.replace('| 1 | CLOSED |', '| 1 | open |').replace(
      'Mechanical check',
      'Check',
    );
    expect(lintPlan('p.md', bad).join('\n')).toMatch(/FIX-FIRST or CLOSED[\s\S]*|Mechanical check/);
    const root = repo({
      'plan-x.md': 'x',
      'docs/plans/bad name.md': GOOD_PLAN,
      'docs/plans/README.md': 'x',
    });
    const out = lintPlans(root, ['plan-x.md', 'docs/plans/bad name.md', 'docs/plans/README.md']);
    expect(out).toEqual([
      'plan-x.md: plans belong in docs/plans/, not the repo root',
      'docs/plans/bad name.md: plan files are named NNN-kebab-slug.md',
    ]);
  });
});

describe('enrich contract and lanes', () => {
  it('parses verdicts and steps', () => {
    const ok = parseEnrichOutput(
      'VERDICT: REAL_FIX\n\n**Step 1:** a\n- Target: x\n\n**Step 2:** b\n- Target: y\n',
    );
    expect(ok.ok).toBe(true);
    expect(ok.steps.map((s) => s.targets)).toEqual([['x'], ['y']]);
    expect(parseEnrichOutput('VERDICT: NOT_A_BUG\n').ok).toBe(true);
    expect(parseEnrichOutput('VERDICT: MAYBE\n').errors).toContain('unknown verdict MAYBE');
    expect(parseEnrichOutput('no verdict').ok).toBe(false);
    expect(parseEnrichOutput('VERDICT: REAL_FIX\n**Step 2:** x\n').errors.join()).toMatch(
      /numbered 1..N[\s\S]*no "- Target:"/,
    );
    expect(parseEnrichOutput('VERDICT: REAL_FIX\n').errors).toContain(
      'REAL_FIX needs at least one **Step N:** block',
    );
  });
  it('checks lane templates', () => {
    const root = repo({
      '.incubator/lanes/index.json': JSON.stringify({ lanes: ['a'] }),
      '.incubator/lanes/a/enrich.md': 'hello',
    });
    const out = checkLanes(root).join('\n');
    expect(out).toMatch(/codegen\.md: missing/);
    expect(out).toMatch(/VERDICT/);
    expect(out).toMatch(/enrich-example/);
  });
});

describe('workflow-lint', () => {
  it('enforces pins, permissions, why-comments and triage shape', () => {
    const wf = `name: x
on: push
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@${'a'.repeat(40)}
      - if: always()
        run: echo hi
      - name: CI failure triage
        run: echo triage
      - run: |
          echo multi
`;
    const out = lintWorkflow('w.yml', wf).join('\n');
    expect(out).toMatch(/missing top-level permissions/);
    expect(out).toMatch(/not pinned/);
    expect(out).toMatch(/# vX\.Y\.Z/);
    expect(out).toMatch(/conditional step needs/);
    expect(out).toMatch(/triage steps must/);
    expect(out).toMatch(/multi-line run step needs/);
    const good = `name: x
permissions:
  contents: read
jobs:
  a:
    steps:
      - uses: actions/checkout@${'b'.repeat(40)} # v1.0.0
      # why: explained
      - name: CI failure triage
        if: failure()
        continue-on-error: true
        run: echo triage
`;
    expect(lintWorkflow('w.yml', good)).toEqual([]);
  });
});

describe('scenario lib', () => {
  it('reads paths and evaluates every op', () => {
    const out = { a: { b: [{ c: 'hello' }] }, n: 3, arr: [1, 2] };
    expect(getPath(out, 'a.b[0].c')).toBe('hello');
    expect(getPath(out, '$')).toBe(out);
    expect(getPath(out, 'x.y.z')).toBeUndefined();
    const ok = [
      { path: 'n', op: 'eq', value: 3 },
      { path: 'n', op: 'neq', value: 4 },
      { path: 'a.b[0].c', op: 'contains', value: 'ell' },
      { path: 'arr', op: 'contains', value: 2 },
      { path: 'a.b[0].c', op: 'matches', value: '^h' },
      { path: 'n', op: 'exists' },
      { path: 'zz', op: 'absent' },
      { path: 'n', op: 'gte', value: 3 },
      { path: 'n', op: 'lte', value: 3 },
      { path: 'arr', op: 'length', value: 2 },
    ];
    for (const a of ok) expect(evaluateAssertion(out, a)).toBeNull();
    const bad = [
      { path: 'n', op: 'eq', value: 4 },
      { path: 'n', op: 'neq', value: 3 },
      { path: 'n', op: 'contains', value: 1 },
      { path: 'arr', op: 'contains', value: 9 },
      { path: 'a.b[0].c', op: 'contains', value: 'zz' },
      { path: 'n', op: 'matches', value: 'x' },
      { path: 'zz', op: 'exists' },
      { path: 'n', op: 'absent' },
      { path: 'n', op: 'gte', value: 4 },
      { path: 'n', op: 'lte', value: 2 },
      { path: 'arr', op: 'length', value: 3 },
      { path: 'n', op: 'bogus' },
    ];
    for (const a of bad) expect(evaluateAssertion(out, a)).not.toBeNull();
  });
  it('validates scenario structure', () => {
    expect(validateScenario(null)).toEqual(['scenario must be an object']);
    const errs = validateScenario({
      id: 'Bad Id',
      tags: [],
      seed: {},
      context: [],
      mocks: { ai: 1 },
      stages: [{ assertions: [{ op: 'x' }] }],
    });
    expect(errs.length).toBeGreaterThanOrEqual(6);
  });
});

describe('quarantine', () => {
  it('requires owner, expiry and uniqueness', () => {
    const today = '2026-06-01';
    expect(checkQuarantine({ entries: [] }, today)).toEqual([]);
    expect(checkQuarantine({}, today)).toHaveLength(1);
    const e = { testId: 't', owner: 'o', reason: 'r', issue: 'i', expires: '2026-07-01' };
    expect(checkQuarantine({ entries: [e] }, today)).toEqual([]);
    const out = checkQuarantine(
      {
        entries: [e, { ...e, owner: '', expires: '2026-01-01' }, { testId: 'u', expires: 'soon' }],
      },
      today,
    ).join('\n');
    expect(out).toMatch(/owner is required/);
    expect(out).toMatch(/expired/);
    expect(out).toMatch(/duplicate/);
    expect(out).toMatch(/YYYY-MM-DD/);
  });
});

describe('markers and drift', () => {
  it('scans marker regions', () => {
    const text = '# <scaffold:a>\nx\n# </scaffold:a>\n// <scaffold:b>\n// </scaffold:b>\n';
    expect(scanMarkers(text).errors).toEqual([]);
    expect(regionBody(text, 'a')).toBe('x');
    expect(regionBody(text, 'missing')).toBeNull();
    const bad = '# <scaffold:a>\n# <scaffold:b>\n# </scaffold:c>\n';
    expect(scanMarkers(bad).errors.length).toBeGreaterThanOrEqual(3);
    expect(
      scanMarkers('# <scaffold:a>\n# </scaffold:a>\n# <scaffold:a>\n# </scaffold:a>\n').errors[0],
    ).toMatch(/duplicate/);
  });
  it('compares agent files and registries', () => {
    const body = (t) =>
      `<!-- <scaffold:agent-instructions> -->\n${t}\n<!-- </scaffold:agent-instructions> -->\n`;
    const root = repo({
      'config/drift.json': JSON.stringify({
        agentFiles: ['A.md', 'B.md', 'C.md', 'D.md'],
        registries: [
          {
            name: 'features',
            file: 'f.json',
            list: 'features',
            key: 'id',
            expect: ['s/{id}.json'],
            reverse: '^s/([^/]+)\\.json$',
          },
        ],
      }),
      'A.md': body('same'),
      'B.md': body('different'),
      'C.md': 'no region',
      'f.json': JSON.stringify({ features: [{ id: 'one' }, { id: 'two' }] }),
      's/one.json': '{}',
      's/orphan.json': '{}',
    });
    const out = checkDrift(root, ['A.md', 'B.md', 'C.md', 's/one.json', 's/orphan.json']).join(
      '\n',
    );
    expect(out).toMatch(/D\.md: agent instruction file is missing/);
    expect(out).toMatch(/C\.md: missing the agent-instructions/);
    expect(out).toMatch(/bodies differ/);
    expect(out).toMatch(/"two" expects s\/two\.json/);
    expect(out).toMatch(/"orphan" exists in code/);
  });
});

describe('tests-collected, ci-gate', () => {
  it('counts tests in vitest and junit reports', () => {
    expect(countTests('{"numTotalTests": 5}', 'vitest-json')).toBe(5);
    expect(countTests('<testsuites tests="7"></testsuites>', 'junit')).toBe(7);
    expect(countTests('<testsuite tests="2"/><testsuite tests="3"/>', 'junit')).toBe(0);
    // PHPUnit nests suites; each test case counts once.
    const nested =
      '<testsuites><testsuite name="all" tests="2"><testsuite name="unit" tests="2">' +
      '<testcase name="a"/><testcase name="b"></testcase></testsuite></testsuite></testsuites>';
    expect(countTests(nested, 'junit')).toBe(2);
    expect(() => countTests('', 'tap')).toThrow(/unknown/);
  });
  it('fails unless every needed job succeeded', () => {
    expect(evaluateNeeds({ a: { result: 'success' } })).toEqual([]);
    expect(evaluateNeeds({ a: { result: 'failure' }, b: { result: 'skipped' } })).toEqual([
      'a: failure',
      'b: skipped',
    ]);
    expect(evaluateNeeds({ b: { result: 'skipped' } }, ['b'])).toEqual([]);
  });
});

describe('security: findings, register, gate', () => {
  const root = repo({ 'src/x.ts': 'line1\n  eval( input )\n' });
  const semgrep = {
    results: [
      {
        check_id: 'r1',
        path: 'src/x.ts',
        start: { line: 2 },
        end: { line: 2 },
        extra: { severity: 'ERROR', message: 'm' },
      },
    ],
    errors: [],
  };
  it('fingerprints findings stably across line shifts', () => {
    const a = semgrepFindings(root, semgrep)[0];
    writeFileSync(path.join(root, 'src/x.ts'), 'new line\nline1\n eval(   input )\n');
    const b = semgrepFindings(root, {
      ...semgrep,
      results: [{ ...semgrep.results[0], start: { line: 3 }, end: { line: 3 } }],
    })[0];
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.severity).toBe('HIGH');
  });
  it('normalizes trivy and gitleaks', () => {
    const t = trivyFindings({
      Results: [
        {
          Target: 'pnpm-lock.yaml',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-1', PkgName: 'p', InstalledVersion: '1', Severity: 'CRITICAL' },
          ],
        },
        {
          Target: 'Dockerfile',
          Misconfigurations: [{ ID: 'DS1', Severity: 'LOW' }],
          Secrets: [{ RuleID: 's', Severity: 'HIGH' }],
        },
      ],
    });
    expect(t.map((f) => f.severity)).toEqual(['CRITICAL', 'LOW', 'HIGH']);
    expect(gitleaksFindings([{ RuleID: 'aws', File: 'a', Fingerprint: 'fp' }])[0].fingerprint).toBe(
      'fp',
    );
    expect(gitleaksFindings({})).toEqual([]);
  });
  it('validates the register and gates by threshold', () => {
    const today = '2026-06-01';
    const findings = [
      {
        tool: 'x',
        ruleId: 'high',
        severity: 'HIGH',
        fingerprint: 'f1',
        path: 'a',
        line: 1,
        message: '',
      },
      {
        tool: 'x',
        ruleId: 'accepted',
        severity: 'CRITICAL',
        fingerprint: 'f2',
        path: 'a',
        line: 1,
        message: '',
      },
      {
        tool: 'x',
        ruleId: 'low',
        severity: 'LOW',
        fingerprint: 'f3',
        path: 'a',
        line: 1,
        message: '',
      },
    ];
    const register = {
      entries: [
        { fingerprint: 'f2', ruleId: 'accepted', reason: 'r', owner: 'o', expires: '2027-01-01' },
        { fingerprint: 'f9', ruleId: 'old', reason: 'r', owner: 'o', expires: '2020-01-01' },
        { fingerprint: 'f8' },
      ],
    };
    const v = validateRegister(register, today);
    expect(v.problems).toHaveLength(2);
    const res = gate({
      findings,
      suppressions: [{ path: 'b', line: 3, ruleId: 'r', fingerprint: 'inline:b:r' }],
      register,
      threshold: 'HIGH',
      today,
    });
    expect(res.blocking.map((f) => f.ruleId)).toEqual([
      'high',
      'incubator.unregistered-suppression',
    ]);
    expect(res.accepted.map((f) => f.ruleId)).toEqual(['accepted']);
  });
  it('validates scan result shapes', () => {
    const dir = repo({
      'semgrep.json': JSON.stringify({ results: [], errors: [] }),
      'trivy.json': JSON.stringify({ SchemaVersion: 2, Results: [] }),
      'gitleaks.json': '[{"RuleID":"x"}]',
    });
    expect(validateResults(dir, ['semgrep', 'trivy'])).toEqual([]);
    expect(validateResults(dir, ['gitleaks', 'missing'])).toEqual([
      'gitleaks: unexpected report shape',
      `missing: ${path.join(dir, 'missing.json')} is missing`,
    ]);
  });
});

describe('language layouts', () => {
  it('expands registry id placeholders for each language', () => {
    expect(expandId('tests/adapters/{id}.ts', 'reorder-alerts')).toBe(
      'tests/adapters/reorder-alerts.ts',
    );
    expect(expandId('tests/adapters/{id_snake}.py', 'reorder-alerts')).toBe(
      'tests/adapters/reorder_alerts.py',
    );
    expect(expandId('tests/Adapters/{id_pascal}Adapter.php', 'guest-list')).toBe(
      'tests/Adapters/GuestListAdapter.php',
    );
    expect(expandId('{id_camel}', 'guest-list')).toBe('guestList');
  });

  it('checks Python syntax without writing .pyc files', async () => {
    const root = repo({
      'ok.py': 'x = 1\n',
      'pkg/bad.py': 'def broken(:\n',
      'm.mjs': 'export const a = 1;\n',
    });
    const { findings, missingTools } = await checkSyntax(root, ['ok.py', 'pkg/bad.py', 'm.mjs']);
    if (missingTools.includes('python')) return;
    expect(findings).toEqual([expect.stringMatching(/^pkg\/bad\.py:1: /)]);
    expect(existsSync(path.join(root, '__pycache__'))).toBe(false);
    expect(existsSync(path.join(root, 'pkg/__pycache__'))).toBe(false);
  });
});
