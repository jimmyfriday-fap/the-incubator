import type { IncubatorSpec } from '@incubator/spec';

/** Plan 065: the design document committed with a finished project. */
export const DESIGN_FILE = 'docs/DESIGN.md';
/** Plan 065: the stand-up guide committed with a finished project (the run folder keeps its own copy). */
export const STAND_UP_FILE = 'docs/STAND-UP.md';

/** Backslash-escapes characters markdown would read as formatting in text that came from the spec. */
const esc = (text: string): string => text.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);

/**
 * Plan 065: what was asked for and what was decided, in the owner's own words: the plain-English idea exactly as
 * given, the people it is for, the features, and the stack. `incubator.json` is the machine copy of the same.
 */
export function designMarkdown(spec: IncubatorSpec): string {
  const features = spec.intent.coreFeatures.filter((f) => !('builtin' in f && f.builtin));
  return [
    `# ${esc(spec.project.name)}: design`,
    '',
    'What was asked for, kept with the code. The machine copy is `incubator.json`.',
    '',
    '## The idea, as written',
    '',
    ...spec.intent.narrative.split(/\r?\n/).map((l) => (l.length ? `> ${l}` : '>')),
    '',
    '## Who it is for',
    '',
    ...(spec.intent.personas.length
      ? spec.intent.personas.map((p) => `- ${esc(p)}`)
      : ['Not recorded.']),
    '',
    '## What it does',
    '',
    ...(features.length
      ? features.map((f) => `- **${esc(f.id)}**: ${esc(f.summary)}`)
      : ['No core features were recorded.']),
    '',
    '## How it is built',
    '',
    `- Stack: ${esc(spec.stack.pack)}`,
    `- Platform: ${esc(spec.platform)}`,
    '',
    'To run it, see `WHAT-NOW.md` and `docs/STAND-UP.md`.',
    '',
  ].join('\n');
}
