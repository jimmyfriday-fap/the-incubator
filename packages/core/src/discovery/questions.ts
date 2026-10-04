import {
  FIXED_BY_PACKS,
  covers,
  specSchema,
  type Decision,
  type Issue,
  type Question,
} from '@incubator/spec';
import type { AskedQuestion } from '../state.js';

export const MAX_QUESTIONS_PER_ROUND = 5;
export const MAX_ROUNDS = 2;

type Node = Record<string, unknown>;
function resolve(node: Node | undefined): Node | undefined {
  const ref = node?.['$ref'];
  if (typeof ref === 'string')
    return (specSchema['$defs'] as Record<string, Node>)[ref.replace('#/$defs/', '')];
  return node;
}

/** The schema node at a dotted spec path, or undefined when the path is not part of incubator.json. */
export function schemaAt(key: string): Node | undefined {
  let node: Node | undefined = specSchema;
  for (const part of key.split('.')) {
    node = resolve(node);
    const props = node?.['properties'] as Record<string, Node> | undefined;
    node = props?.[part];
    if (!node) return undefined;
  }
  return resolve(node);
}

/** The only keys an update run may ask under: `request.<topic>`, answers kept as context (never written to the spec). */
const REQUEST_KEY = /^request\.[a-z][a-zA-Z0-9]*$/;

/**
 * What an answer to a question keyed `key` does: `spec` writes one value at that path, `context` only
 * informs the next turn, `null` means the key is not answerable (objects, lists of objects, the owner's
 * own request text, free-form lists). A model that keys a scope question on `intent.coreFeatures` would
 * otherwise overwrite the structured field with an option slug.
 */
export function questionTarget(key: string): 'spec' | 'context' | null {
  if (REQUEST_KEY.test(key)) return 'context';
  if (key === 'intent.narrative' || key === 'decisions' || key.startsWith('decisions.'))
    return null;
  const node = schemaAt(key);
  const type = node?.['type'];
  if (
    Array.isArray(node?.['enum']) ||
    type === 'string' ||
    type === 'boolean' ||
    type === 'integer' ||
    type === 'number'
  )
    return 'spec';
  if (type === 'array') return itemEnum(node) ? 'spec' : null;
  return null;
}

function itemEnum(node: Node | undefined): unknown[] | undefined {
  const items = resolve(node?.['items'] as Node | undefined);
  const values = items?.['enum'];
  return Array.isArray(values) ? values : undefined;
}

/** The option values a question may offer for `key`, or undefined when the schema does not restrict them. */
function optionIssue(key: string, value: string): string | undefined {
  const node = schemaAt(key);
  const type = node?.['type'];
  const enums = node?.['enum'];
  if (Array.isArray(enums) && !enums.includes(value))
    return `"${value}" is not one of ${enums.join(', ')}`;
  if (type === 'boolean' && value !== 'true' && value !== 'false')
    return `"${value}" is not true or false`;
  if ((type === 'integer' || type === 'number') && !Number.isFinite(Number(value)))
    return `"${value}" is not a number`;
  if (type === 'array') {
    const allowed = itemEnum(node);
    const bad =
      allowed && (coerceAnswer(key, value) as unknown[]).find((v) => !allowed.includes(v));
    if (bad !== undefined) return `${JSON.stringify(bad)} is not one of ${allowed!.join(', ')}`;
  }
  return undefined;
}

/** Converts an answer string to the type the schema wants at that path. */
export function coerceAnswer(key: string, value: string): unknown {
  const node = schemaAt(key);
  const type = node?.['type'];
  if (type === 'boolean') return value === 'true';
  if (type === 'integer' || type === 'number') return Number(value);
  if (type === 'array') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // comma-separated fallback
    }
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return value;
}

/** Semantic checks on a turn's questions; failures send the turn back through the schema gate. */
export function questionIssues(
  questions: readonly Question[],
  opts: { enhance?: boolean } = {},
): Issue[] {
  const issues: Issue[] = [];
  questions.forEach((q, i) => {
    const rec = q.options.filter((o) => o.recommended).length;
    if (rec !== 1)
      issues.push({
        code: 'question.recommended',
        path: `/questions/${i}`,
        message: `question "${q.key}" must mark exactly one option recommended (has ${rec})`,
      });
    const keyIssue = (message: string): void => {
      issues.push({ code: 'question.key', path: `/questions/${i}/key`, message });
    };
    const fixed = FIXED_BY_PACKS.some((k) => covers(k, q.key));
    if (opts.enhance && !REQUEST_KEY.test(q.key))
      keyIssue(
        `question key "${q.key}" is not allowed on an update run: key every question "request.<topic>" (for example "request.dashboardRecords")`,
      );
    else if (fixed) {
      // why: the engine drops pack-fixed questions, so only the key's existence is checked.
      if (!schemaAt(q.key)) keyIssue(`question key "${q.key}" is not a path in incubator.json`);
    } else if (!questionTarget(q.key))
      keyIssue(
        `question key "${q.key}" cannot be answered with one option: use a single-value path in incubator.json, or "request.<topic>" for scope and behaviour questions`,
      );
    else if (!REQUEST_KEY.test(q.key))
      for (const o of q.options) {
        const why = optionIssue(q.key, o.value);
        if (why)
          issues.push({
            code: 'question.options',
            path: `/questions/${i}/options`,
            message: `option ${why} for "${q.key}"`,
          });
      }
    const values = q.options.map((o) => o.value);
    if (new Set(values).size !== values.length)
      issues.push({
        code: 'question.options',
        path: `/questions/${i}/options`,
        message: `question "${q.key}" repeats an option`,
      });
  });
  return issues;
}

/**
 * The engine, not the model, enforces the clarification rules (TDD §5.2): drop questions the packs
 * fix or that are already decided, rank by impact (ties by key), keep at most five.
 */
export function selectQuestions(
  questions: readonly Question[],
  decisions: readonly Decision[],
): { asked: AskedQuestion[]; dropped: { key: string; why: string }[] } {
  const dropped: { key: string; why: string }[] = [];
  const decided = decisions.filter((d) => d.source !== 'inferred').map((d) => d.key);
  const seen = new Set<string>();
  const kept: AskedQuestion[] = [];
  for (const q of questions) {
    if (FIXED_BY_PACKS.some((k) => covers(k, q.key)))
      dropped.push({ key: q.key, why: 'fixed by the template packs' });
    else if (decided.some((k) => covers(k, q.key)))
      dropped.push({ key: q.key, why: 'already decided' });
    else if (seen.has(q.key)) dropped.push({ key: q.key, why: 'duplicate question' });
    else {
      seen.add(q.key);
      kept.push({
        key: q.key,
        question: q.question,
        impact: q.impact,
        options: q.options.map((o) => ({ ...o })),
      });
    }
  }
  kept.sort((a, b) => b.impact - a.impact || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const q of kept.slice(MAX_QUESTIONS_PER_ROUND))
    dropped.push({ key: q.key, why: 'over the per-round limit' });
  return { asked: kept.slice(0, MAX_QUESTIONS_PER_ROUND), dropped };
}
