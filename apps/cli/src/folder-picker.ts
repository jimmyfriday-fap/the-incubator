import type { Exec } from '@incubator/runtime';

export type FolderPurpose = 'new' | 'existing';

const TIMEOUT = 10 * 60_000;

/** The Windows dialog, as one constant script: nothing the owner or the page typed is ever in it. */
const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  '$owner = New-Object System.Windows.Forms.Form',
  '$owner.TopMost = $true',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.ShowNewFolderButton = $true',
  'if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
].join('\n');

/** PowerShell's -EncodedCommand takes the script as base64 of UTF-16LE. */
export function encodePowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

const TITLES: Record<FolderPurpose, string> = {
  new: 'Choose the folder for the new repository',
  existing: 'Choose the folder that contains your local repository',
};

/** What the owner chose, from a dialog's stdout: one line, no trailing newline; empty means none. */
function chosen(stdout: string): string | null {
  const line = stdout.replace(/\r?\n$/, '');
  return line.trim() ? line : null;
}

/**
 * The operating system's own folder dialog for `incubator ui` (ADR-022). Every picker is spawned with
 * argv only (no shell) and a constant script; cancelling returns null. Returns undefined when this
 * machine has no dialog we can drive, so the page falls back to a pasted path.
 */
export async function createFolderPicker(
  exec: Exec,
  platform: NodeJS.Platform = process.platform,
): Promise<((purpose: FolderPurpose) => Promise<string | null>) | undefined> {
  if (platform === 'win32') {
    return async () => {
      const r = await exec.run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-EncodedCommand',
          encodePowerShell(WINDOWS_SCRIPT),
        ],
        { timeoutMs: TIMEOUT },
      );
      return r.code === 0 ? chosen(r.stdout) : null;
    };
  }
  if (platform === 'darwin') {
    return async (purpose) => {
      // why: the prompt is chosen from two constants, never built from input.
      const script = `POSIX path of (choose folder with prompt "${TITLES[purpose]}")`;
      const r = await exec.run('osascript', ['-e', script], { timeoutMs: TIMEOUT });
      // exit 1 is the owner pressing Cancel
      const p = r.code === 0 ? chosen(r.stdout) : null;
      return p && p.length > 1 ? p.replace(/\/$/, '') : p;
    };
  }
  if (await exec.which('zenity'))
    return async (purpose) => {
      const r = await exec.run(
        'zenity',
        ['--file-selection', '--directory', `--title=${TITLES[purpose]}`],
        { timeoutMs: TIMEOUT },
      );
      return r.code === 0 ? chosen(r.stdout) : null;
    };
  if (await exec.which('kdialog'))
    return async (purpose) => {
      const r = await exec.run(
        'kdialog',
        ['--title', TITLES[purpose], '--getexistingdirectory', '.'],
        {
          timeoutMs: TIMEOUT,
        },
      );
      return r.code === 0 ? chosen(r.stdout) : null;
    };
  return undefined;
}
