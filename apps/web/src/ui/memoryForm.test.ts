import { describe, expect, it } from 'vitest';
import { memoryBody, parseTerms, termsText, validSystem } from './memoryForm.js';

describe('the Add memory form helpers (plan 071)', () => {
  it('reads isolation terms one per line or comma-separated, without blanks or repeats', () => {
    expect(parseTerms(' alpha, beta\n\nalpha\n  gamma  ')).toEqual(['alpha', 'beta', 'gamma']);
    expect(parseTerms('')).toEqual([]);
  });

  it('shows terms one per line', () => {
    expect(termsText(['alpha', 'beta'])).toBe('alpha\nbeta');
  });

  it('accepts only kebab-case system names', () => {
    expect(validSystem('rolling-schedule')).toBe(true);
    expect(validSystem('Rolling Schedule')).toBe(false);
    expect(validSystem('-lead')).toBe(false);
    expect(validSystem('')).toBe(false);
  });

  it('builds the request body, leaving out an empty model or effort', () => {
    expect(
      memoryBody({ system: ' shop ', terms: 'a,b', policy: 'pr', model: '  ', effort: '' }),
    ).toEqual({ system: 'shop', isolationTerms: ['a', 'b'], commitPolicy: 'pr' });
    expect(
      memoryBody({
        system: 'shop',
        terms: '',
        policy: 'auto',
        model: ' claude-opus-5-5 ',
        effort: 'high',
      }),
    ).toEqual({
      system: 'shop',
      isolationTerms: [],
      commitPolicy: 'auto',
      model: 'claude-opus-5-5',
      effort: 'high',
    });
  });
});
