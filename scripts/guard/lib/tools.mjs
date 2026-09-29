// Locates hash-pinned tools fetched into .tools/ (see scripts/tools-fetch.mjs), falling back to PATH.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { which } from './proc.mjs';

export function toolCommand(root, name) {
  const win = process.platform === 'win32';
  const candidates =
    {
      semgrep: [
        path.join(root, '.tools', 'venv', win ? 'Scripts' : 'bin', win ? 'semgrep.exe' : 'semgrep'),
      ],
      gitleaks: [path.join(root, '.tools', 'gitleaks', win ? 'gitleaks.exe' : 'gitleaks')],
      actionlint: [path.join(root, '.tools', 'actionlint', win ? 'actionlint.exe' : 'actionlint')],
    }[name] ?? [];
  for (const c of candidates) if (existsSync(c)) return [c, []];
  return which(name);
}
