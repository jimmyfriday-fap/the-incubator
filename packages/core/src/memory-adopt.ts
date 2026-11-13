import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PolicyError } from '@incubator/runtime';

/** One repository a store's system.yaml lists, with its folder on this computer. */
export interface StoreMember {
  repo: string;
  dir: string;
}

/** What an existing memory store says about its system. Reading it changes nothing (plan 079 WI-2). */
export interface StoreSystem {
  name: string;
  store: string;
  seedVersion: string;
  storeCommitPolicy: 'pr' | 'direct';
  /** The system.yaml, verbatim (LF). */
  manifest: string;
  members: StoreMember[];
}

/** The `repo:` and `path:` of each entry under `members:` in a system.yaml. */
export function manifestMemberPaths(yaml: string): { repo: string; path: string | null }[] {
  const out: { repo: string; path: string | null }[] = [];
  let inMembers = false;
  for (const raw of yaml.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^members:\s*$/.test(raw)) {
      inMembers = true;
      continue;
    }
    if (inMembers && /^\S/.test(raw) && !raw.startsWith('#')) break;
    if (!inMembers) continue;
    const repo = /^\s*-\s*repo:\s*["']?([A-Za-z0-9._-]+)["']?\s*(?:#.*)?$/.exec(raw);
    if (repo) {
      out.push({ repo: repo[1]!, path: null });
      continue;
    }
    const at = /^\s+path:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/.exec(raw);
    const last = out[out.length - 1];
    if (at && last) last.path = at[1]!.trim();
  }
  return out;
}

/**
 * Reads a memory store's `system.yaml` and `memory.conf`. Read only. A member without a `path:` sits beside the
 * store (`../<repo>`); every folder is resolved against the store folder.
 */
export function readStoreSystem(storeDir: string): StoreSystem {
  const store = path.resolve(storeDir);
  const file = path.join(store, 'system.yaml');
  if (!existsSync(file))
    throw new PolicyError(`${store} has no system.yaml, so it is not a memory store`, {
      code: 'not_a_store',
    });
  const manifest = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const name = /^system:\s*["']?([a-z0-9]+(?:-[a-z0-9]+)*)["']?\s*(?:#.*)?$/m.exec(manifest)?.[1];
  const listed = manifestMemberPaths(manifest);
  if (!name || listed.length === 0)
    throw new PolicyError(
      'the store system.yaml needs a kebab-case "system:" line and at least one member',
      { code: 'bad_manifest' },
    );
  const seedVersion = /^seed_version:\s*["']?([^"'\s#]+)/m.exec(manifest)?.[1] ?? '';
  const confFile = path.join(store, 'memory.conf');
  const conf = existsSync(confFile) ? readFileSync(confFile, 'utf8') : '';
  const policy = /^\s*commit_policy\s*=\s*(pr|direct)\s*$/m.exec(conf)?.[1];
  return {
    name,
    store,
    seedVersion,
    storeCommitPolicy: policy === 'pr' ? 'pr' : 'direct',
    manifest,
    members: listed.map((m) => ({
      repo: m.repo,
      dir: path.resolve(store, m.path ?? `../${m.repo}`),
    })),
  };
}
