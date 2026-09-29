import { exec } from 'node:child_process';

export function list(dir: string): void {
  exec(`ls ${dir}`);
}
