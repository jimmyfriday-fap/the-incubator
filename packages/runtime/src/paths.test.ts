import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FixedClock } from './clock.js';
import { PolicyError } from './errors.js';
import { RUN_ID_PATTERN, dateStamp, newRunId } from './ids.js';
import { incubatorHome, resolveInside, toPosix } from './paths.js';

describe('incubatorHome', () => {
  it('honours INCUBATOR_HOME and falls back to ~/.incubator', () => {
    expect(incubatorHome({ INCUBATOR_HOME: 'rel/home' })).toBe(path.resolve('rel/home'));
    expect(incubatorHome({})).toMatch(/\.incubator$/);
  });
});

describe('resolveInside', () => {
  const root = path.resolve('some-root');
  it('resolves relative paths under root', () => {
    expect(resolveInside(root, 'a/b.txt')).toBe(path.join(root, 'a', 'b.txt'));
    expect(resolveInside(root, 'a\\b.txt')).toBe(path.join(root, 'a', 'b.txt'));
    expect(resolveInside(root, 'a/../c')).toBe(path.join(root, 'c'));
  });
  it.each(['../x', 'a/../../x', '/etc/passwd', 'C:\\Windows', 'c:x', '\\\\server\\share', 'a\0b'])(
    'rejects %j',
    (p) => {
      expect(() => resolveInside(root, p)).toThrow(PolicyError);
    },
  );
  it('converts to posix separators', () => {
    expect(toPosix(['a', 'b', 'c'].join(path.sep))).toBe('a/b/c');
  });
});

describe('run ids', () => {
  it('formats UTC date, time and a base32 suffix', () => {
    const clock = new FixedClock('2026-03-04T05:06:07Z');
    const id = newRunId(clock, () => new Uint8Array([0, 1, 2, 31, 32, 63]));
    expect(id).toBe('20260304-050607-abc7a7');
    expect(id).toMatch(RUN_ID_PATTERN);
    expect(newRunId(clock)).toMatch(RUN_ID_PATTERN);
    expect(dateStamp(clock)).toBe('20260304');
    clock.advance(86_400_000);
    expect(dateStamp(clock)).toBe('20260305');
  });
});
