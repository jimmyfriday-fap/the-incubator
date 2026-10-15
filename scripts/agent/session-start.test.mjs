// Unit tests for the generated repository's SessionStart install choice (plan 056).
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCommand } from './session-start.mjs';

function repo(...files) {
  const root = mkdtempSync(path.join(tmpdir(), 'session start '));
  for (const f of files) writeFileSync(path.join(root, f), '');
  return root;
}

describe('the session installs dependencies before the agent starts (plan 056)', () => {
  it('uses the lockfile when there is one', () => {
    expect(installCommand(repo('pnpm-lock.yaml', 'package.json'))).toEqual([
      'pnpm',
      ['install', '--frozen-lockfile'],
    ]);
    expect(installCommand(repo('composer.lock', 'composer.json'))).toEqual([
      'composer',
      ['install', '--no-interaction'],
    ]);
    expect(installCommand(repo('uv.lock', 'pyproject.toml'))).toEqual(['uv', ['sync', '--frozen']]);
  });

  it('installs from the manifest when a freshly built repository has no lockfile yet', () => {
    expect(installCommand(repo('composer.json'))?.[0]).toBe('composer');
    expect(installCommand(repo('pyproject.toml'))).toEqual(['uv', ['sync']]);
    expect(installCommand(repo('package.json'))).toEqual(['pnpm', ['install']]);
  });

  it('installs nothing when there is no manifest', () => {
    expect(installCommand(repo())).toBeNull();
  });
});
