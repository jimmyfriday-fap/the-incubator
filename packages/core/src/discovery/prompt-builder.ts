import { FIXED_BY_PACKS, OTHER, specSchema, type Decision } from '@incubator/spec';
import { MAX_QUESTIONS_PER_ROUND, MAX_ROUNDS } from './questions.js';

type Node = Record<string, unknown>;

/**
 * `path: a | b | c` for every enum in the spec schema, so the model sees the allowed values.
 * `other` (a stack with no pack, ADR-024) is listed only when the draft already is such a repository:
 * a model must never pick it, and every other prompt stays byte-identical.
 */
export function allowedValues(includeOther = false): string[] {
  const out: string[] = [];
  const defs = specSchema['$defs'] as Record<string, Node>;
  const walk = (node: Node | undefined, prefix: string): void => {
    if (!node) return;
    const ref = node['$ref'];
    const n = typeof ref === 'string' ? defs[ref.replace('#/$defs/', '')] : node;
    if (!n) return;
    if (Array.isArray(n['enum']))
      out.push(
        `${prefix}: ${(n['enum'] as string[]).filter((v) => includeOther || v !== OTHER).join(' | ')}`,
      );
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
  /** Heading for the narrative: "Change request" on enhance runs. */
  narrativeHeading?: string;
  /** An update run: questions are keyed `request.<topic>` and their answers print with the question. */
  enhance?: boolean;
  /** A ready-made fenced digest (a string, used as is), a value to print as JSON, or nothing. */
  analysis: unknown;
  draft: Record<string, unknown>;
  decisions: readonly Decision[];
  /** The owner's corrections at review, oldest first (plan 021). Absent or empty: the prompt is unchanged. */
  corrections?: readonly string[];
}

/** Deterministic user prompt for one discovery round (no clocks, no ids). */
export function buildUserPrompt(ctx: TurnContext): string {
  const { decisions: _omit, ...draft } = ctx.draft;
  const decided = ctx.decisions.map((d) =>
    ctx.enhance && d.key.startsWith('request.')
      ? `- ${d.key}: "${d.question}" -> ${d.answer} (${d.source})`
      : `- ${d.key} = ${d.answer} (${d.source})`,
  );
  const lines = [
    `# Discovery round ${ctx.round} of ${MAX_ROUNDS}`,
    '',
    `## ${ctx.narrativeHeading ?? 'Narrative'}`,
    ctx.narrative.trim() || '(none)',
    '',
    ...(ctx.corrections?.length
      ? ["## Owner's corrections at review", ...ctx.corrections.map((c) => `- ${c}`), '']
      : []),
    '## Repository analysis',
    ctx.analysis === undefined || ctx.analysis === null
      ? '(none)'
      : typeof ctx.analysis === 'string'
        ? ctx.analysis
        : `\`\`\`json\n${JSON.stringify(ctx.analysis, null, 2)}\n\`\`\``,
    '',
    '## Current draft incubator.json (without decisions)',
    `\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\``,
    '',
    '## Decisions so far',
    decided.length ? decided.join('\n') : '(none)',
    '',
    '## Allowed values',
    ...allowedValues((ctx.draft['stack'] as { pack?: string } | undefined)?.pack === OTHER).map(
      (v) => `- ${v}`,
    ),
    '',
    '## Fixed by the template packs (never ask about these)',
    FIXED_BY_PACKS.join(', '),
    '',
    '## Rules for this round',
    ctx.enhance
      ? `- Ask at most ${MAX_QUESTIONS_PER_ROUND} questions; key every question "request.<topic>" in camelCase (for example "request.dashboardRecords"), never a path in incubator.json. Fold the answers into intent.coreFeatures yourself.`
      : `- Ask at most ${MAX_QUESTIONS_PER_ROUND} questions; question keys are dotted paths into incubator.json (for example "deploy.target").`,
    '- Each question has 2-4 options with exactly one marked recommended.',
    ctx.enhance
      ? '- Record each intent field you set or change in draftSpec.decisions, keyed by its path: "intent.coreFeatures" whenever you set features, and "intent.personas" (or any other intent field) if you change it; source "inferred", with a one-line question/answer. A decision keyed by a feature id, by a request.<topic> key, or by a path below the field (such as intent.coreFeatures.exportOrders) does not count.'
      : '- Record every value you set in draftSpec.decisions with source "inferred" and a one-line question/answer.',
    '- Answers the user already gave are final; do not ask about them again.',
    ...(ctx.corrections?.length
      ? [
          '- Apply every correction from the owner; it overrides earlier answers and decisions. Record each field you change in draftSpec.decisions as usual.',
        ]
      : []),
    ctx.round >= MAX_ROUNDS
      ? '- This is the last round: ask only what would still change the generated files; unanswered questions take their recommended option.'
      : '- Prefer inferring over asking.',
  ];
  return `${lines.join('\n')}\n`;
}
