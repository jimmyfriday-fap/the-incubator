import { describe, expect, it } from 'vitest';
import { isLlmAdapterId } from './index.js';

describe('adapter ids', () => {
  it('recognises the five adapters', () => {
    expect(isLlmAdapterId('claude-cli')).toBe(true);
    expect(isLlmAdapterId('fake')).toBe(true);
    expect(isLlmAdapterId('gpt')).toBe(false);
  });
});
