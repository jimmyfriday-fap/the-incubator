import { execFile } from 'node:child_process';

export function list(dir: string): void {
  execFile('ls', [dir]);
}
