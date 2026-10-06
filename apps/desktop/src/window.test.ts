import { describe, expect, it } from 'vitest';
import {
  externalAllowed,
  historyActionForCommand,
  historyActionForKey,
  leantimeHosts,
  navigationAllowed,
  secureWebPreferences,
} from './window.js';

describe('secureWebPreferences', () => {
  it('locks the renderer down', () => {
    expect(secureWebPreferences()).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    });
  });
});

describe('navigation lockdown', () => {
  const origin = 'http://127.0.0.1:4100';
  it('keeps in-app navigation on the local origin', () => {
    expect(navigationAllowed('http://127.0.0.1:4100/runs/x', origin)).toBe(true);
    expect(navigationAllowed('http://127.0.0.1:4101/', origin)).toBe(false);
    expect(navigationAllowed('http://localhost:4100/', origin)).toBe(false);
    expect(navigationAllowed('file:///etc/passwd', origin)).toBe(false);
    expect(navigationAllowed('not a url', origin)).toBe(false);
  });

  it('opens only https GitHub and spec-named Leantime links externally', () => {
    expect(externalAllowed('https://github.com/octo/app/pull/1')).toBe(true);
    expect(externalAllowed('http://github.com/octo/app')).toBe(false);
    expect(externalAllowed('https://github.com.evil.example/x')).toBe(false);
    expect(externalAllowed('https://user:pw@github.com/x')).toBe(false);
    expect(externalAllowed('javascript:alert(1)')).toBe(false);
    expect(externalAllowed('https://pm.example.org/tickets', ['PM.example.org'])).toBe(true);
    expect(externalAllowed('https://other.example.org/', ['pm.example.org'])).toBe(false);
    expect(externalAllowed('%%%')).toBe(false);
  });

  it('collects https Leantime hosts from specs', () => {
    expect(
      leantimeHosts([
        { tracker: { leantime: { baseUrl: 'https://PM.example.org/' } } },
        { tracker: { leantime: { baseUrl: 'http://insecure.example.org' } } },
        { tracker: { leantime: { baseUrl: 'nope' } } },
        { tracker: { type: 'local' } },
        null,
      ]),
    ).toEqual(['pm.example.org']);
  });
});

describe('history shortcuts', () => {
  const key = (
    k: string,
    mods: Partial<Record<'alt' | 'control' | 'meta' | 'shift', boolean>> = {},
  ) => ({
    type: 'keyDown',
    key: k,
    alt: false,
    control: false,
    meta: false,
    shift: false,
    ...mods,
  });
  it('maps Alt+Arrow on Windows and Linux, and Cmd+bracket on macOS', () => {
    expect(historyActionForKey(key('ArrowLeft', { alt: true }), 'win32')).toBe('back');
    expect(historyActionForKey(key('ArrowRight', { alt: true }), 'linux')).toBe('forward');
    expect(historyActionForKey(key('[', { meta: true }), 'darwin')).toBe('back');
    expect(historyActionForKey(key(']', { meta: true }), 'darwin')).toBe('forward');
  });
  it('ignores other keys, other modifiers, key releases and the wrong platform', () => {
    expect(historyActionForKey(key('ArrowLeft'), 'win32')).toBeNull();
    expect(historyActionForKey(key('ArrowLeft', { alt: true, control: true }), 'win32')).toBeNull();
    expect(historyActionForKey(key('ArrowLeft', { alt: true, shift: true }), 'win32')).toBeNull();
    expect(
      historyActionForKey({ ...key('ArrowLeft', { alt: true }), type: 'keyUp' }, 'win32'),
    ).toBeNull();
    expect(historyActionForKey(key('ArrowLeft', { alt: true }), 'darwin')).toBeNull();
    expect(historyActionForKey(key('[', { meta: true }), 'win32')).toBeNull();
    expect(historyActionForKey(key('x', { meta: true }), 'darwin')).toBeNull();
    expect(historyActionForKey(key('x', { alt: true }), 'win32')).toBeNull();
  });
  it('maps the mouse back and forward buttons', () => {
    expect(historyActionForCommand('browser-backward')).toBe('back');
    expect(historyActionForCommand('browser-forward')).toBe('forward');
    expect(historyActionForCommand('browser-home')).toBeNull();
  });
});
