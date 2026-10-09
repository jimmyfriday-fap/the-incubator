import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoStatus } from '../api-types.js';
import { REMOTE_RECHECK_MS, recheckOnFocus } from './recheck.js';

const status = (commits: number | null): RepoStatus => ({
  moved: false,
  recorded: 'a'.repeat(40),
  current: 'a'.repeat(40),
  branch: 'main',
  commits,
});

describe('the repository re-check on focus (plan 034)', () => {
  it('always asks again for a folder run, and before the first answer', () => {
    expect(recheckOnFocus(null, 1000, 1001)).toBe(true);
    expect(recheckOnFocus(status(0), 1000, 1001)).toBe(true);
    expect(recheckOnFocus(status(3), 1000, 1001)).toBe(true);
  });

  it('asks GitHub at most once a minute', () => {
    expect(REMOTE_RECHECK_MS).toBe(60_000);
    expect(recheckOnFocus(status(null), 1000, 1000 + REMOTE_RECHECK_MS - 1)).toBe(false);
    expect(recheckOnFocus(status(null), 1000, 1000 + REMOTE_RECHECK_MS)).toBe(true);
  });

  it('is what the run page uses', () => {
    const view = readFileSync(path.join(import.meta.dirname, 'views', 'RunView.tsx'), 'utf8');
    expect(view).toContain(
      'if (recheckOnFocus(lastRepo.current, askedAt.current, Date.now())) setLooked((n) => n + 1);',
    );
    expect(view).toContain('askedAt.current = Date.now();');
    expect(view).toContain('lastRepo.current = s;');
    expect(view).toContain('lastRepo.current = null;');
  });
});
