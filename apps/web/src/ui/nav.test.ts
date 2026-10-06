import { describe, expect, it } from 'vitest';
import { areaOf, historyState } from './nav.js';

describe('navigation helpers', () => {
  it('reports back and forward from the navigation state, and allows both when it is unknown', () => {
    expect(historyState({ canGoBack: false, canGoForward: true })).toEqual({
      canBack: false,
      canForward: true,
    });
    expect(historyState({ canGoBack: true, canGoForward: false })).toEqual({
      canBack: true,
      canForward: false,
    });
    expect(historyState(undefined)).toEqual({ canBack: true, canForward: true });
  });

  it('keeps a run or a project page under its own tab', () => {
    expect(areaOf('/')).toBe('home');
    expect(areaOf('/runs')).toBe('runs');
    expect(areaOf('/runs/20261006-031254-63n6jg')).toBe('runs');
    expect(areaOf('/projects')).toBe('projects');
    expect(areaOf('/projects/abc')).toBe('projects');
    expect(areaOf('/settings')).toBe('settings');
    expect(areaOf('/elsewhere')).toBe('home');
  });
});
