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
export function questionIssues(questions: readonly Question[]): Issue[] {
  const issues: Issue[] = [];
  questions.forEach((q, i) => {
    const rec = q.options.filter((o) => o.recommended).length;
    if (rec !== 1)
      issues.push({
        code: 'question.recommended',
        path: `/questions/${i}`,
        message: `question "${q.key}" must mark exactly one option recommended (has ${rec})`,
      });
    if (!schemaAt(q.key))
      issues.push({
        code: 'question.key',
        path: `/questions/${i}/key`,
        message: `question key "${q.key}" is not a path in incubator.json`,
      });
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
