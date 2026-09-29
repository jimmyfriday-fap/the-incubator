import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createArchive, extractArchive, type PacksArchive } from './packs-archive.js';

const templates = path.resolve(import.meta.dirname, '../../../packages/templates');

describe('packs archive', () => {
  it('round-trips every pack file byte for byte, dotfiles included', () => {
    const archive = createArchive(templates);
    expect(archive.files.some((f) => f.path.includes('/.github/workflows/'))).toBe(true);
    expect(archive.files.some((f) => f.path.endsWith('/.gitignore'))).toBe(true);
    const cache = mkdtempSync(path.join(os.tmpdir(), 'packs-cache-'));
    const dir = extractArchive(archive, cache);
    expect(dir).toBe(path.join(cache, archive.sha256, 'packs'));
    expect(existsSync(path.join(dir, 'base', 'pack.json'))).toBe(true);
    for (const f of archive.files)
      expect(readFileSync(path.join(cache, archive.sha256, f.path))).toEqual(
        readFileSync(path.join(templates, f.path)),
      );
    // Reused on the next start; stale extractions are removed.
    writeFileSync(path.join(cache, archive.sha256, 'marker'), 'x');
    expect(extractArchive(archive, cache)).toBe(dir);
    expect(existsSync(path.join(cache, archive.sha256, 'marker'))).toBe(true);
    const changed: PacksArchive = { ...archive, sha256: 'f'.repeat(64) };
    extractArchive(changed, cache);
    expect(readdirSync(cache)).toEqual(['f'.repeat(64)]);
  });

  it('refuses paths that escape the target and unknown formats', () => {
    const cache = mkdtempSync(path.join(os.tmpdir(), 'packs-cache-'));
    const evil: PacksArchive = {
      version: 1,
      sha256: 'a'.repeat(64),
      files: [{ path: '../../escape.txt', data: '' }],
    };
    expect(() => extractArchive(evil, cache)).toThrow(/escapes/);
    expect(() => extractArchive({ ...evil, version: 2 as 1 }, cache)).toThrow(/unsupported/);
  });
});
