import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_COOKIE, themeSourceAfterChange, themeSourceFor } from './window.js';

const read = (rel: string) => readFileSync(path.join(import.meta.dirname, rel), 'utf8');

type Change = [name: string, value: string, cause: string, removed: boolean];
/** Where the title bar ends up after the changes, starting from the computer's setting. */
const follow = (changes: Change[]) =>
  changes.reduce<string>((s, c) => themeSourceAfterChange(...c) ?? s, 'system');

describe('the title bar follows the theme (plan 033)', () => {
  it('maps the page cookie to the window theme', () => {
    expect(themeSourceFor('dark')).toBe('dark');
    expect(themeSourceFor('light')).toBe('light');
    for (const other of ['', 'system', 'blue', undefined])
      expect(themeSourceFor(other)).toBe('system');
  });

  it('reads the cookie the page writes', () => {
    expect(THEME_COOKIE).toBe('incubator_theme');
    expect(read('../../web/src/ui/theme.ts')).toContain(`const COOKIE = '${THEME_COOKIE}';`);
  });

  it('follows the changes Chromium reports (recorded from Electron 44)', () => {
    const C = THEME_COOKIE;
    expect(follow([[C, 'light', 'inserted', false]])).toBe('light');
    // Light to dark: the old cookie is reported removed by the overwrite, then the new one added.
    expect(
      follow([
        [C, 'light', 'inserted', false],
        [C, 'light', 'overwrite', true],
        [C, 'dark', 'inserted', false],
      ]),
    ).toBe('dark');
    // Dark to the computer's setting: the page overwrites the cookie with an expired one.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        [C, 'dark', 'expired-overwrite', true],
      ]),
    ).toBe('system');
    // A reload writes the same value again.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        [C, 'dark', 'overwrite', true],
        [C, 'dark', 'inserted-no-value-change-overwrite', false],
      ]),
    ).toBe('dark');
    // Other cookies (the session) leave it alone.
    expect(
      follow([
        [C, 'dark', 'inserted', false],
        ['inc_session', 'tok', 'inserted', false],
        ['inc_session', 'tok', 'explicit', true],
      ]),
    ).toBe('dark');
  });

  it('is set at start and whenever the cookie changes', () => {
    const main = read('main.ts');
    expect(main).toContain('.get({ name: THEME_COOKIE })');
    expect(main).toContain("session.defaultSession.cookies.on('changed',");
    expect(main).toContain('themeSourceAfterChange(cookie.name, cookie.value, cause, removed)');
    expect(main.match(/nativeTheme\.themeSource = /g)).toHaveLength(2);
    // Before the window exists, so it opens in the right colours.
    expect(main.indexOf('nativeTheme.themeSource = ')).toBeLessThan(
      main.indexOf('const main = new BrowserWindow({'),
    );
  });
});
