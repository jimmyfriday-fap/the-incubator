const BOM = '﻿';

/**
 * Canonical text form for rendered files: no BOM, LF line endings, no trailing whitespace
 * (except Markdown two-space hard breaks), exactly one trailing LF. Empty stays empty.
 */
export function normalizeText(input: string, opts: { markdown?: boolean } = {}): string {
  let text = input.startsWith(BOM) ? input.slice(1) : input;
  text = text.replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map((line) => {
    if (opts.markdown && /[^ \t][ \t]{2,}$/.test(line)) return line.replace(/[ \t]+$/, '  ');
    return line.replace(/[ \t]+$/, '');
  });
  const body = lines.join('\n').replace(/\n+$/, '');
  return body.length === 0 ? '' : `${body}\n`;
}

/** Heuristic used when the manifest does not say: NUL byte in the first 8 KiB means binary. */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}
