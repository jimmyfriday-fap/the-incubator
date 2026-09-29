import { existsSync, readFileSync } from 'node:fs';

/** Parses KEY=value lines (quotes stripped, # comments ignored). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Loads `.env`, then `private/.env`. A later file only fills keys that are still missing, and
 * variables already in the environment always win. Returns the keys that were set.
 */
export function loadEnv(
  files: readonly string[] = ['.env', 'private/.env'],
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const set: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (env[key] === undefined) {
        env[key] = value;
        set.push(key);
      }
    }
  }
  return set;
}
