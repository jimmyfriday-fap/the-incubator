import { describe, expect, it } from 'vitest';
import { INCUBATOR_SPEC_VERSION, isSupportedSpecVersion } from './index.js';

describe('spec version', () => {
  it('accepts only the current version', () => {
    expect(isSupportedSpecVersion(INCUBATOR_SPEC_VERSION)).toBe(true);
    expect(isSupportedSpecVersion('0.9')).toBe(false);
    expect(isSupportedSpecVersion(1)).toBe(false);
  });
});
