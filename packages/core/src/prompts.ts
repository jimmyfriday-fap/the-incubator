import { readFileSync } from 'node:fs';

export interface Prompt {
  name: string;
  version: string;
  body: string;
}

/** Parses a prompt file with YAML-ish front matter (`name`, `version`). */
export function parsePrompt(text: string): Prompt {
  const m = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(text.replace(/\r\n?/g, '\n'));
  if (!m) throw new Error('prompt file has no front matter');
  const meta = Object.fromEntries(
    m[1]!.split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
  );
  if (!meta['name'] || !/^\d+\.\d+\.\d+$/.test(meta['version'] ?? ''))
    throw new Error('prompt front matter needs name and semver version');
  return { name: meta['name'], version: meta['version']!, body: m[2]!.trim() };
}

/** Loads `packages/core/prompts/<name>.md` (resolved next to src/ and dist/). */
export function loadPrompt(name: string): Prompt {
  return parsePrompt(readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8'));
}
