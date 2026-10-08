import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeTree } from './fs-remove.js';

describe('removeTree', () => {
  it('removes a tree that holds read-only files, as git leaves its pack files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'inc-rm-'));
    const pack = path.join(root, 'workspace', 'repo', '.git', 'objects', 'pack');
    mkdirSync(pack, { recursive: true });
    for (const f of ['a.pack', 'a.idx']) {
      writeFileSync(path.join(pack, f), 'x');
      chmodSync(path.join(pack, f), 0o444);
    }
    removeTree(path.join(root, 'workspace'));
    expect(existsSync(path.join(root, 'workspace'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('does nothing for a directory that is not there', () => {
    expect(() => removeTree(path.join(tmpdir(), 'inc-rm-missing-xyz'))).not.toThrow();
  });
});
