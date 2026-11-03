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
}): MemoryChoices {
  return {
    system: f.system.trim(),
    isolationTerms: parseTerms(f.terms),
    commitPolicy: f.policy,
    ...(f.model.trim() ? { model: f.model.trim() } : {}),
    ...(f.effort ? { effort: f.effort } : {}),
  };
}
