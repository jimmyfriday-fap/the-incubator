import { describe, expect, it } from 'vitest';
import { isValidRepoName } from './index.js';

describe('isValidRepoName', () => {
  it('accepts GitHub-safe names', () => {
    expect(isValidRepoName('the-incubator')).toBe(true);
    expect(isValidRepoName('a.b_c-1')).toBe(true);
  });
  it.each(['', '.', '..', 'a b', 'a/b', 'x.git', 'a'.repeat(101), 'semi;colon'])(
    'rejects %j',
    (n) => {
      expect(isValidRepoName(n)).toBe(false);
    },
  );
});
