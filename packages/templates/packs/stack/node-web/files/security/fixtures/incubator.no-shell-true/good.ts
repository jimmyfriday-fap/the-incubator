import { spawn } from 'node:child_process';

export function run(cmd: string, args: string[]): void {
  spawn(cmd, args, { shell: false, windowsHide: true });
}
