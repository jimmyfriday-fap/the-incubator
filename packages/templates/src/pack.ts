import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ToolError, sha256Hex } from '@incubator/runtime';
import { validateAgainst } from '@incubator/spec';
import type { JsonPatchOp } from './json-patch.js';

export interface FileEntry {
  src: string;
  dest: string;
  when?: string;
  each?: string;
  as?: string;
  mode?: '0644' | '0755';
  role?: string;
  vars?: Record<string, unknown>;
}
export interface MarkerPatchDecl {
  file: string;
  region: string;
  when?: string;
  entries: { id: string; src?: string; text?: string; when?: string }[];
}
export interface JsonPatchDecl {
  file: string;
  when?: string;
  ops: (JsonPatchOp & { valueSrc?: string; when?: string })[];
}
export interface PackManifest {
  id: string;
  version: string;
  description: string;
  appliesWhen: string;
  requires?: string[];
  files: FileEntry[];
  markerPatches?: MarkerPatchDecl[];
  jsonPatches?: JsonPatchDecl[];
  relocate?: { role: string; to: string; when?: string }[];
  copy?: { role: string; to: string; when?: string }[];
  canonical?: string;
  settings?: { variables?: SettingDecl[]; secrets?: SettingDecl[] };
}

export interface SettingDecl {
  name: string;
  description: string;
  when?: string;
  target?: 'app' | 'paired';
}

export interface Pack {
  manifest: PackManifest;
  dir: string;
  /** Every file in the pack directory (POSIX path → bytes), loaded once. */
  files: Map<string, Buffer>;
  /** SHA-256 over sorted `path\0sha256\n` lines (ADR-004). */
  integrity: string;
}

const packSchema = JSON.parse(
  readFileSync(new URL('../schema/pack.schema.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/** Tool caches and OS litter are never pack content (they would also make the integrity hash unstable). */
const IGNORED = new Set([
  '__pycache__',
  '.ruff_cache',
  '.mypy_cache',
  '.pytest_cache',
  '.phpunit.cache',
  'node_modules',
  '.DS_Store',
  'Thumbs.db',
]);

function walk(dir: string, rel: string, out: Map<string, Buffer>): void {
  for (const name of readdirSync(path.join(dir, rel)).sort()) {
    if (IGNORED.has(name)) continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(dir, r)).isDirectory()) walk(dir, r, out);
    else out.set(r, readFileSync(path.join(dir, r)));
  }
}

export function packIntegrity(files: Map<string, Buffer>): string {
  const lines = [...files.keys()].sort().map((p) => `${p}\0${sha256Hex(files.get(p)!)}\n`);
  return `sha256:${sha256Hex(lines.join(''))}`;
}

export function loadPack(dir: string): Pack {
  const files = new Map<string, Buffer>();
  walk(dir, '', files);
  const raw = files.get('pack.json');
  if (!raw) throw new ToolError(`${dir}: missing pack.json`);
  const manifest = JSON.parse(raw.toString('utf8')) as unknown;
  const v = validateAgainst<PackManifest>(packSchema, manifest);
  if (!v.ok)
    throw new ToolError(
      `${dir}/pack.json is invalid: ${v.issues.map((i) => i.message).join('; ')}`,
      { code: 'bad_pack' },
    );
  const m = manifest as PackManifest;
  for (const f of m.files) {
    const isGlob = f.src.endsWith('/**');
    const prefix = isGlob ? f.src.slice(0, -2) : f.src;
    const exists = isGlob ? [...files.keys()].some((k) => k.startsWith(prefix)) : files.has(f.src);
    if (!exists)
      throw new ToolError(`${m.id}: file entry ${f.src} matches nothing`, { code: 'bad_pack' });
  }
  return { manifest: m, dir, files, integrity: packIntegrity(files) };
}
