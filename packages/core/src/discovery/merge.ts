import {
  FIXED_BY_PACKS,
  OTHER,
  SECURITY_FIELDS,
  changedPaths,
  covers,
  deepMerge,
  getAt,
  setAt,
  type Decision,
  type DiscoveryTurn,
  type Issue,
} from '@incubator/spec';
import type { Answer } from '../state.js';
import { coerceAnswer } from './questions.js';

export type Draft = Record<string, unknown> & { decisions?: Decision[] };

export function withoutMeta(draft: Draft): Record<string, unknown> {
  const { decisions: _d, ...rest } = draft;
  const intent = rest['intent'] as Record<string, unknown> | undefined;
  if (intent) {
    const { narrative: _n, ...i } = intent;
    return { ...rest, intent: i };
  }
  return rest;
}

/** Removes fields the template packs fix; the model may echo them but never sets them. */
export function withoutPackFixed(draft: Draft): Draft {
  const out = structuredClone(draft);
  for (const field of FIXED_BY_PACKS) {
    const parts = field.split('.');
    let node: Record<string, unknown> | undefined = out;
    for (const part of parts.slice(0, -1))
      node = node?.[part] as Record<string, unknown> | undefined;
    if (node) delete node[parts[parts.length - 1]!];
  }
  return out;
}

/** Every value the model changed must be attributed by a decision (TDD §5.2 rule 4). */
export function attributionIssues(before: Draft, turn: DiscoveryTurn): Issue[] {
  const proposed = withoutPackFixed(turn.draftSpec);
  const after = deepMerge(withoutMeta(before), withoutMeta(proposed));
  const keys = [...(before.decisions ?? []), ...(proposed.decisions ?? [])].map((d) => d.key);
  return changedPaths(withoutMeta(before), after)
    .filter((p) => !keys.some((k) => covers(k, p)))
    .map((p) => ({
      code: 'decision.missing',
      path: `/draftSpec/${p.replaceAll('.', '/')}`,
      message: `draftSpec sets ${p} without a matching decisions[] entry`,
    }));
}

const OTHER_PATHS = [
  'platform',
  'stack.pack',
  'stack.framework',
  'stack.packageManager',
  'stack.database',
  'stack.auth',
  'deploy.target',
] as const;

/**
 * A model may never choose `other` (ADR-024): it marks a repository the scan found no pack for. The
 * turn is sent back to the model with this issue instead of failing later at validation.
 */
export function otherIssues(turn: DiscoveryTurn): Issue[] {
  return OTHER_PATHS.filter((p) => getAt(turn.draftSpec, p) === OTHER).map((p) => ({
    code: 'stack.other',
    path: `/draftSpec/${p.replaceAll('.', '/')}`,
    message: `${p} cannot be "other": choose one of the listed values`,
  }));
}

function upsert(list: Decision[], d: Decision): Decision[] {
  return [...list.filter((x) => x.key !== d.key), d];
}

export function applyAnswers(
  draft: Draft,
  answers: readonly Answer[],
  questions: ReadonlyMap<string, string>,
): Draft {
  let out = structuredClone(draft);
  let decisions = out.decisions ?? [];
  for (const a of answers) {
    out = setAt(out, a.key, coerceAnswer(a.key, a.value));
    decisions = upsert(decisions, {
      key: a.key,
      question: questions.get(a.key) ?? a.key,
      answer: a.value,
      source: a.source,
    });
  }
  out.decisions = decisions;
  return out;
}

/**
 * Merges a model turn into the draft. The narrative stays the user's, answers already given stay
 * authoritative, model decisions are always `inferred`, and for brownfield runs the security fields
 * are never taken from the model (threat T6).
 */
export function mergeTurn(opts: {
  before: Draft;
  turn: DiscoveryTurn;
  narrative: string;
  answers: readonly Answer[];
  questions: ReadonlyMap<string, string>;
  untrustedSource: boolean;
}): Draft {
  const proposed = withoutPackFixed(opts.turn.draftSpec);
  let inferred = (proposed.decisions ?? []).map((d) => ({ ...d, source: 'inferred' as const }));
  delete proposed.decisions;
  if (opts.untrustedSource) {
    for (const field of SECURITY_FIELDS) {
      const parts = field.split('.');
      let node: Record<string, unknown> | undefined = proposed;
      for (const part of parts.slice(0, -1))
        node = node?.[part] as Record<string, unknown> | undefined;
      if (node) delete node[parts[parts.length - 1]!];
    }
    inferred = inferred.filter(
      (d) => !SECURITY_FIELDS.some((f) => covers(f, d.key) || covers(d.key, f)),
    );
  }
  let merged = deepMerge(structuredClone(opts.before), proposed);
  merged = setAt(merged, 'intent.narrative', opts.narrative);
  let decisions = [...(opts.before.decisions ?? [])];
  const answered = new Set(opts.answers.map((a) => a.key));
  for (const d of inferred) if (!answered.has(d.key)) decisions = upsert(decisions, d);
  merged.decisions = decisions;
  return applyAnswers(merged, opts.answers, opts.questions);
}
