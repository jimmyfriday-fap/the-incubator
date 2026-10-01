import type { Exec } from '@incubator/runtime';
import { describe, expect, it } from 'vitest';
import { createFolderPicker, encodePowerShell } from './folder-picker.js';

function fakeExec(
  result: { code: number; stdout: string },
  installed: string[] = [],
): { exec: Exec; calls: { bin: string; args: readonly string[] }[] } {
  const calls: { bin: string; args: readonly string[] }[] = [];
  const exec: Exec = {
    run: (bin, args) => {
      calls.push({ bin, args });
      return Promise.resolve({ ...result, signal: null, stderr: '', timedOut: false });
    },
    which: (name) =>
      Promise.resolve(installed.includes(name) ? { path: name, kind: 'native' as const } : null),
  };
  return { exec, calls };
}

describe('folder picker', () => {
  it('Windows: PowerShell with an encoded constant script, no shell; cancel is null', async () => {
    const ok = fakeExec({ code: 0, stdout: 'my projects\\app' });
    const pick = (await createFolderPicker(ok.exec, 'win32'))!;
    expect(await pick('existing')).toBe('my projects\\app');
    expect(ok.calls[0]!.bin).toBe('powershell.exe');
    expect(ok.calls[0]!.args).toEqual(
      expect.arrayContaining(['-NoProfile', '-STA', '-EncodedCommand']),
    );
    const encoded = ok.calls[0]!.args.at(-1)!;
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toContain('FolderBrowserDialog');
    expect(encodePowerShell('a')).toBe(Buffer.from('a', 'utf16le').toString('base64'));
    const cancelled = (await createFolderPicker(fakeExec({ code: 0, stdout: '' }).exec, 'win32'))!;
    expect(await cancelled('new')).toBeNull();
  });

  it('macOS: osascript; the trailing slash is dropped; exit 1 is cancel', async () => {
    const ok = fakeExec({ code: 0, stdout: 'my projects/app/\n' });
    const pick = (await createFolderPicker(ok.exec, 'darwin'))!;
    expect(await pick('new')).toBe('my projects/app');
    expect(ok.calls[0]!.bin).toBe('osascript');
    const cancel = (await createFolderPicker(fakeExec({ code: 1, stdout: '' }).exec, 'darwin'))!;
    expect(await cancel('new')).toBeNull();
  });

  it('Linux: zenity, then kdialog, otherwise no picker', async () => {
    const z = fakeExec({ code: 0, stdout: 'my projects/app\n' }, ['zenity', 'kdialog']);
    expect(await (await createFolderPicker(z.exec, 'linux'))!('existing')).toBe('my projects/app');
    expect(z.calls[0]!.bin).toBe('zenity');
    const k = fakeExec({ code: 0, stdout: 'my projects/app\n' }, ['kdialog']);
    expect(await (await createFolderPicker(k.exec, 'linux'))!('existing')).toBe('my projects/app');
    expect(k.calls[0]!.bin).toBe('kdialog');
    expect(
      await createFolderPicker(fakeExec({ code: 0, stdout: '' }).exec, 'linux'),
    ).toBeUndefined();
  });
});
