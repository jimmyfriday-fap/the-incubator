#!/usr/bin/env node
// Fails on any text file starting with a UTF-8 byte-order mark.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isBinary, isMain, report, runGuard, selectFiles } from './lib/common.mjs';

export function findBoms(root, files) {
  const findings = [];
  for (const f of files) {
    let buf;
    try {
      buf = readFileSync(path.join(root, f));
    } catch {
      continue;
    }
    if (
      buf.length >= 3 &&
      buf[0] === 0xef &&
      buf[1] === 0xbb &&
      buf[2] === 0xbf &&
      !isBinary(buf)
    ) {
      findings.push(`${f}: starts with a UTF-8 BOM`);
    }
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ positional, flags }) => {
    const root = process.cwd();
    return report('bom', findBoms(root, selectFiles(root, positional)), { quiet: flags.quiet });
  });
}
