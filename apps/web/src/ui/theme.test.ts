import { describe, expect, it } from 'vitest';
import { nextTheme, parseTheme, themeFromCookie } from './theme.js';

describe('the theme choice (plan 030)', () => {
  it('reads only light or dark from storage, else the computer setting', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('purple')).toBe('system');
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme(undefined)).toBe('system');
  });

  it('finds the choice among other cookies', () => {
    expect(themeFromCookie('inc_session=abc; incubator_theme=dark')).toBe('dark');
    expect(themeFromCookie('incubator_theme=light')).toBe('light');
    expect(themeFromCookie('incubator_theme=')).toBe('system');
    expect(themeFromCookie('other_incubator_theme=dark')).toBe('system');
    expect(themeFromCookie('')).toBe('system');
  });

  it('cycles from the computer setting to light, then dark, then back', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
