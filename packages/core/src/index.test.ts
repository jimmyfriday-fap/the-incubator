import { PolicyError } from '@incubator/runtime';
import { describe, expect, it } from 'vitest';
import { ExitCode, INCUBATOR_VERSION, exitCodeFor } from './index.js';

describe('core re-exports the exit-code contract', () => {
  it('exposes the codes', () => {
    expect(ExitCode).toEqual({ Ok: 0, ToolError: 1, Policy: 2, Interrupted: 130 });
    expect(exitCodeFor(new PolicyError('x'))).toBe(2);
    expect(INCUBATOR_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
