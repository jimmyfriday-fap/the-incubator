import { FIXED_BY_PACKS, specSchema, type Decision } from '@incubator/spec';
import { MAX_QUESTIONS_PER_ROUND, MAX_ROUNDS } from './questions.js';

type Node = Record<string, unknown>;

/** `path: a | b | c` for every enum in the spec schema, so the model sees the allowed values. */
export function allowedValues(): string[] {
  const out: string[] = [];
  const defs = specSchema['$defs'] as Record<string, Node>;
  const walk = (node: Node | undefined, prefix: string): void => {
    if (!node) return;
    const ref = node['$ref'];
    const n = typeof ref === 'string' ? defs[ref.replace('#/$defs/', '')] : node;
    if (!n) return;
    if (Array.isArray(n['enum'])) out.push(`${prefix}: ${(n['enum'] as string[]).join(' | ')}`);
    const items = n['items'] as Node | undefined;
    if (items) walk(items, `${prefix}[]`);
    for (const [k, v] of Object.entries(
      (n['properties'] as Record<string, Node> | undefined) ?? {},
    )) {
      walk(v, prefix ? `${prefix}.${k}` : k);
    }
  };
  walk(specSchema, '');
  return out;
}

export interface TurnContext {
  round: number;
  narrative: string;
  analysis: unknown;
  draft: Record<string, unknown>;
  decisions: readonly Decision[];
}

/** Deterministic user prompt for one discovery round (no clocks, no ids). */
export function buildUserPrompt(ctx: TurnContext): string {
  const { decisions: _omit, ...draft } = ctx.draft;
  const decided = ctx.decisions.map((d) => `- ${d.key} = ${d.answer} (${d.source})`);
  const lines = [
    `# Discovery round ${ctx.round} of ${MAX_ROUNDS}`,
    '',
    '## Narrative',
    ctx.narrative.trim() || '(none)',
    '',
    '## Repository analysis',
    ctx.analysis === undefined || ctx.analysis === null
      ? '(none)'
      : `\`\`\`json\n${JSON.stringify(ctx.analysis, null, 2)}\n\`\`\``,
    '',
    '## Current draft incubator.json (without decisions)',
    `\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\``,
    '',
    '## Decisions so far',
    decided.length ? decided.join('\n') : '(none)',
    '',
    '## Allowed values',
    ...allowedValues().map((v) => `- ${v}`),
    '',
    '## Fixed by the template packs (never ask about these)',
    FIXED_BY_PACKS.join(', '),
    '',
    '## Rules for this round',
    `- Ask at most ${MAX_QUESTIONS_PER_ROUND} questions; question keys are dotted paths into incubator.json (for example "deploy.target").`,
    '- Each question has 2-4 options with exactly one marked recommended.',
    '- Record every value you set in draftSpec.decisions with source "inferred" and a one-line question/answer.',
    '- Answers the user already gave are final; do not ask about them again.',
    ctx.round >= MAX_ROUNDS
      ? '- This is the last round: ask only what would still change the generated files; unanswered questions take their recommended option.'
      : '- Prefer inferring over asking.',
  ];
  return `${lines.join('\n')}\n`;
}
