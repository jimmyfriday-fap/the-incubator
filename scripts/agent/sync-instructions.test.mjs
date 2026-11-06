// The CLAUDE.md memory region survives `pnpm agent:sync` (plan 072).
import { describe, expect, it } from 'vitest';
import { memoryRegion, render } from './sync-instructions.mjs';

const BLOCK =
  '<!-- <scaffold:' +
  'memory> -->\n## Memory\n\nRead the index first.\n<!-- </scaffold:' +
  'memory> -->';

describe('memoryRegion', () => {
  it('returns the region at the top of the file followed by one blank line', () => {
    expect(memoryRegion(`${BLOCK}\n\nrest of the file\n`)).toBe(`${BLOCK}\n\n`);
  });

  it('accepts CRLF input and returns LF text', () => {
    const crlf = `${BLOCK}\n\nrest\n`.replace(/\n/g, '\r\n');
    expect(memoryRegion(crlf)).toBe(`${BLOCK}\n\n`);
  });

  it('returns nothing when the file does not start with the region', () => {
    expect(memoryRegion(`intro\n${BLOCK}\n`)).toBe('');
    expect(memoryRegion(null)).toBe('');
    expect(memoryRegion('')).toBe('');
  });

  it('returns nothing when the region is never closed', () => {
    expect(memoryRegion('<!-- <scaffold:' + 'memory> -->\nunfinished\n')).toBe('');
  });

  it('keeps the region above the generated body', () => {
    const out = `${memoryRegion(`${BLOCK}\n\nold\n`)}${render('# Title\n\nBody\n')('')}`;
    expect(out.startsWith(`${BLOCK}\n\n<!-- Generated from`)).toBe(true);
    expect(out).toContain('<!-- <scaffold:agent-instructions> -->');
  });
});
