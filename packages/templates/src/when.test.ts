import { describe, expect, it } from 'vitest';
import { ToolError } from '@incubator/runtime';
import { evaluateWhen } from './when.js';

const ctx = {
  stack: { pack: 'node-web', database: 'postgres' },
  testing: { home: 'in-repo', e2e: 'playwright', profiles: ['quick', 'full'] },
  platform: 'web',
  n: 3,
};

describe('evaluateWhen', () => {
  it.each([
    ["stack.pack == 'node-web'", true],
    ["stack.pack != 'node-web'", false],
    ["stack.pack == 'node-web' && testing.home == 'paired-repo'", false],
    ["stack.pack == 'node-lib' || testing.home == 'in-repo'", true],
    ["!(testing.home == 'paired-repo')", true],
    ["!!(platform == 'web')", true],
    ["platform in ['web', 'service']", true],
    ["platform in ['cli']", false],
    ["'quick' in testing.profiles", true],
    ["'chaos' in testing.profiles", false],
    ['n == 3', true],
    ['n == -3', false],
    ['true', true],
    ['false || false', false],
    ['missing.path', false],
    ["missing.path == 'x'", false],
    ["'a' in stack.pack", false],
  ])('%s → %s', (src, want) => {
    expect(evaluateWhen(src, ctx)).toBe(want);
  });

  it.each([
    "stack.pack == 'node-web",
    'stack.pack ==',
    "stack.pack == 'a' 'b'",
    'stack.pack = 1',
    '(true',
    '',
    "platform in ['web'",
  ])('rejects malformed condition %j', (src) => {
    expect(() => evaluateWhen(src, ctx)).toThrow(ToolError);
  });

  it('never evaluates code', () => {
    expect(() => evaluateWhen('process.exit(1)', ctx)).toThrow(ToolError);
    expect(evaluateWhen('constructor.name', {})).toBe(false);
    expect(evaluateWhen('constructor', {})).toBe(false);
    expect(evaluateWhen('stack.__proto__', ctx)).toBe(false);
  });
});
