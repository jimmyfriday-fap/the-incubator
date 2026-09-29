import { describe, expect, it } from 'vitest';
import {
  InterruptedError,
  ParkError,
  PolicyError,
  ToolError,
  exitCodeFor,
  formatError,
} from './errors.js';
import { ExitCode } from './exit.js';

describe('exit-code contract', () => {
  it('maps each error class to its exit code', () => {
    expect(exitCodeFor(new ToolError('x'))).toBe(ExitCode.ToolError);
    expect(exitCodeFor(new PolicyError('x'))).toBe(ExitCode.Policy);
    expect(exitCodeFor(new ParkError('llm_schema', 'x'))).toBe(ExitCode.Policy);
    expect(exitCodeFor(new InterruptedError())).toBe(ExitCode.Interrupted);
  });

  it('treats unknown throwables as the tool breaking', () => {
    expect(exitCodeFor(new Error('boom'))).toBe(1);
    expect(exitCodeFor('string')).toBe(1);
  });

  it('keeps codes, reasons and evidence', () => {
    const e = new ParkError('gate', 'verify failed', { step: 'verify' });
    expect(e.code).toBe('parked');
    expect(e.reason).toBe('gate');
    expect(e.evidence).toEqual({ step: 'verify' });
    expect(e.name).toBe('ParkError');
    expect(formatError(e)).toBe('ParkError [parked]: verify failed');
    expect(formatError(new Error('plain'))).toBe('Error: plain');
    expect(formatError(42)).toBe('42');
    expect(formatError(new ToolError('t', { code: 'c' }), true)).toContain('ToolError [c]: t');
  });
});
