import type { MemoryChoices } from '../api-types.js';

/** The isolation terms as typed: one per line or comma-separated, trimmed, duplicates dropped. */
export function parseTerms(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
}

/** The terms as the form shows them: one per line. */
export function termsText(terms: readonly string[]): string {
  return terms.join('\n');
}

/** A system name the server accepts: lowercase kebab-case. */
export function validSystem(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** The body of `POST /api/runs` for an Add memory run. */
export function memoryBody(f: {
  system: string;
  terms: string;
  policy: MemoryChoices['commitPolicy'];
  model: string;
  effort: string;
  /** Store mode: the repositories other than the run folder that share the store. */
  members?: { dir: string; name: string }[];
  /** Store mode: the run folder, the first member. */
  dir?: string;
  storePolicy?: 'pr' | 'direct';
  storeRemote?: string;
  /** Add member: the system to join; it is also the system name. */
  joinSystem?: string;
}): MemoryChoices {
  const others = f.members ?? [];
  return {
    system: f.system.trim(),
    isolationTerms: parseTerms(f.terms),
    commitPolicy: f.policy,
    ...(f.model.trim() ? { model: f.model.trim() } : {}),
    ...(f.effort ? { effort: f.effort } : {}),
    ...(others.length && f.dir
      ? { members: [{ dir: f.dir, name: folderName(f.dir) }, ...others] }
      : {}),
    ...(others.length ? { storeCommitPolicy: f.storePolicy ?? 'pr' } : {}),
    ...(others.length && f.storeRemote?.trim() ? { storeRemote: f.storeRemote.trim() } : {}),
    ...(f.joinSystem ? { joinSystem: f.joinSystem } : {}),
  };
}

/** The last segment of a folder path, either separator. */
export function folderName(dir: string): string {
  return (
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? dir
  );
}

/** The folder a path sits in. */
export function parentOf(dir: string): string {
  const t = dir.replace(/[\\/]+$/, '');
  const i = Math.max(t.lastIndexOf('/'), t.lastIndexOf('\\'));
  return i <= 0 ? '' : t.slice(0, i);
}
