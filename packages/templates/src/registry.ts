import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolError } from '@incubator/runtime';
import type { IncubatorSpec, PackRef } from '@incubator/spec';
import { loadPack, type Pack } from './pack.js';
import { evaluateWhen } from './when.js';

export const BUNDLED_PACKS_DIR = fileURLToPath(new URL('../packs', import.meta.url));

/**
 * The packs directory renders use: `INCUBATOR_PACKS_DIR` when set (the desktop app extracts its packs
 * there, because installers drop dotfiles such as `.github/`), else the packs shipped with this module.
 * `actions-lock.json` and `versions.json` sit in its parent directory.
 */
export function packsDir(): string {
  const env = process.env['INCUBATOR_PACKS_DIR'];
  return env ? path.resolve(env) : BUNDLED_PACKS_DIR;
}

export interface PackRegistry {
  packs: ReadonlyMap<string, Pack>;
  actionsLock: Record<string, { tag: string; sha: string }>;
  versions: Record<string, unknown>;
}

let cached: { dir: string; reg: PackRegistry } | undefined;

/** Loads every pack under `dir` (default: `packsDir()`). Cached for the default directory. */
export function loadRegistry(dir: string = packsDir()): PackRegistry {
  const isDefault = dir === packsDir();
  if (isDefault && cached?.dir === dir) return cached.reg;
  const packs = new Map<string, Pack>();
  const candidates: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    if (existsSync(path.join(p, 'pack.json'))) candidates.push(p);
    else if (!name.startsWith('.')) {
      for (const sub of readdirSync(p).sort())
        if (existsSync(path.join(p, sub, 'pack.json'))) candidates.push(path.join(p, sub));
    }
  }
  for (const c of candidates) {
    const pack = loadPack(c);
    packs.set(pack.manifest.id, pack);
  }
  const root = path.dirname(dir);
  const read = (f: string) => JSON.parse(readFileSync(path.join(root, f), 'utf8')) as unknown;
  const reg: PackRegistry = {
    packs,
    actionsLock: (read('actions-lock.json') as { actions: PackRegistry['actionsLock'] }).actions,
    versions: read('versions.json') as Record<string, unknown>,
  };
  if (isDefault) cached = { dir, reg };
  return reg;
}

const ORDER = ['base', 'stack/', 'deploy/', 'test-home/'];
const rank = (id: string) => ORDER.findIndex((p) => id === p || id.startsWith(p));

/** The packs a spec composes, in composition order: base → stack → deploy → test-home. */
export function selectPacks(reg: PackRegistry, spec: IncubatorSpec): Pack[] {
  const ctx = { ...(spec as unknown as Record<string, unknown>), spec };
  const chosen = [...reg.packs.values()]
    .filter((p) => evaluateWhen(p.manifest.appliesWhen, ctx))
    .sort(
      (a, b) =>
        rank(a.manifest.id) - rank(b.manifest.id) || (a.manifest.id < b.manifest.id ? -1 : 1),
    );
  for (const kind of ORDER) {
    const n = chosen.filter((p) => p.manifest.id === kind || p.manifest.id.startsWith(kind)).length;
    if (n !== 1)
      throw new ToolError(
        `expected exactly one ${kind.replace('/', '')} pack for this spec, found ${n}`,
        { code: 'pack_selection' },
      );
  }
  for (const want of spec.templates.packs) {
    const have = chosen.find((p) => p.manifest.id === want.id);
    if (!have)
      throw new ToolError(`spec pins pack ${want.id}, which does not apply to this spec`, {
        code: 'pack_pin',
      });
    if (have.manifest.version !== want.version) {
      throw new ToolError(
        `spec pins ${want.id}@${want.version}; this build ships ${have.manifest.version}`,
        { code: 'pack_pin' },
      );
    }
  }
  return chosen;
}

export function packRefs(packs: readonly Pack[]): PackRef[] {
  return packs.map((p) => ({ id: p.manifest.id, version: p.manifest.version }));
}
