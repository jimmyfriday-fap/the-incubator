#!/usr/bin/env node
// Renders the single agent-instructions source into CLAUDE.md, AGENTS.md, Copilot and Cursor files.
// The body sits between agent-instructions scaffold markers so the drift guard can compare them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';

export const TARGETS = [
  { file: 'CLAUDE.md', header: '' },
  { file: 'AGENTS.md', header: '' },
  { file: '.github/copilot-instructions.md', header: '' },
  {
    file: '.cursor/rules/incubator.mdc',
    header: '---\ndescription: Repository rules for AI agents\nalwaysApply: true\n---\n\n',
  },
];

export function render(source) {
  const body = source.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  return (header) =>
    `${header}<!-- Generated from .incubator/agent/INSTRUCTIONS.md by scripts/agent/sync-instructions.mjs. Edit the source. -->\n<!-- <scaffold:agent-instructions> -->\n\n${body}\n\n<!-- </scaffold:agent-instructions> -->\n`;
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const make = render(readFileSync(path.join(root, '.incubator/agent/INSTRUCTIONS.md'), 'utf8'));
  let stale = 0;
  for (const t of TARGETS) {
    const want = make(t.header);
    const abs = path.join(root, t.file);
    let have;
    try {
      have = readFileSync(abs, 'utf8');
    } catch {
      have = null;
    }
    if (have === want) continue;
    stale++;
    if (flags.check) process.stdout.write(`stale: ${t.file}\n`);
    else {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, want);
      process.stdout.write(`wrote ${t.file}\n`);
    }
  }
  process.exit(flags.check && stale ? EXIT.POLICY : EXIT.OK);
}
