import { describe, expect, it } from 'vitest';
import {
  folderName,
  memoryBody,
  parentOf,
  parseTerms,
  termsText,
  validSystem,
} from './memoryForm.js';

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

  it('builds a store-mode body with the run folder first (plan 076)', () => {
    const body = memoryBody({
      system: 'shop',
      terms: '',
      policy: 'auto',
      model: '',
      effort: '',
      dir: '/w/api',
      members: [{ dir: '/w/web', name: 'web' }],
      storePolicy: 'direct',
      storeRemote: ' https://example.invalid/shop-memory.git ',
    });
    expect(body.members).toEqual([
      { dir: '/w/api', name: 'api' },
      { dir: '/w/web', name: 'web' },
    ]);
    expect(body.storeCommitPolicy).toBe('direct');
    expect(body.storeRemote).toBe('https://example.invalid/shop-memory.git');
    // Without other members the body is a repo-mode body.
    expect(
      memoryBody({
        system: 'shop',
        terms: '',
        policy: 'auto',
        model: '',
        effort: '',
        dir: '/w/api',
      }),
    ).not.toHaveProperty('members');
  });

  it('reads folder names and parents with either separator', () => {
    expect(folderName('Sites\\api\\')).toBe('api');
    expect(folderName('/w/web')).toBe('web');
    expect(parentOf('Sites\\api')).toBe('Sites');
    expect(parentOf('/w/web/')).toBe('/w');
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
