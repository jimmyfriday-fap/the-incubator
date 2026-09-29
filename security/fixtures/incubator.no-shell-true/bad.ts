import { spawn } from 'node:child_process';

export function run(cmd: string): void {
  spawn(cmd, [], { shell: true });
}
