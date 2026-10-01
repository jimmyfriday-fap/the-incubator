import type { Decision } from '@incubator/spec';
import type { JournalEntry } from './journal.js';
import type { RunInput } from './store.js';

export const RUN_STATES = [
  'INTAKE',
  'ANALYZE',
  'REQUEST',
  'DRAFT_SPEC',
  'CLARIFY',
  'REVIEW',
  'APPROVED',
  'SCAFFOLD',
  'VERIFY',
  'PUBLISH',
  'HANDOFF',
  'CODE',
  'COMMIT',
  'PUSH',
  'DONE',
  'PARKED',
] as const;
export type RunStateName = (typeof RUN_STATES)[number];

export interface AskedOption {
  value: string;
  label: string;
  recommended: boolean;
}
export interface AskedQuestion {
  key: string;
  question: string;
  impact: number;
  options: AskedOption[];
}
export interface Answer {
  key: string;
  value: string;
  source: Decision['source'];
}

export interface RunState {
  runId: string;
  input: RunInput;
  state: RunStateName;
  /** Discovery round (1-based) of the current or last DRAFT_SPEC/CLARIFY. */
  round: number;
  /** Latest spec revision number (0 = none). */
  rev: number;
  pendingQuestions: AskedQuestion[] | null;
  parked: { state: RunStateName; reason: string; message: string; evidence?: unknown } | null;
  approvedHash: string | null;
  llmCostUsd: number;
  done: boolean;
  /** Completed effectful steps (publish, handoff) by id. */
  steps: Record<string, { status: 'ok' | 'warn' | 'fail'; data?: unknown }>;
}

/** Pure reducer over journal entries (ADR-010): resume = replay + re-enter. */
export function reduce(entries: readonly JournalEntry[], runId = '', input?: RunInput): RunState {
  let s: RunState = {
    runId,
    input: input ?? { kind: 'new', surface: 'cli' },
    state: 'INTAKE',
    round: 0,
    rev: 0,
    pendingQuestions: null,
    parked: null,
    approvedHash: null,
    llmCostUsd: 0,
    done: false,
    steps: {},
  };
  for (const e of entries) {
    switch (e.type) {
      case 'run.start':
        s = { ...s, runId: String(e['runId']), input: e['input'] as RunInput };
        break;
      case 'input.override':
        s = {
          ...s,
          input: {
            ...s.input,
            ...(typeof e['adapter'] === 'string' ? { adapter: e['adapter'] } : {}),
          },
        };
        break;
      case 'state.enter':
        s = {
          ...s,
          state: e['state'] as RunStateName,
          round: typeof e['round'] === 'number' ? e['round'] : s.round,
          parked: null,
        };
        break;
      case 'spec.revision':
        s = { ...s, rev: e['rev'] as number };
        break;
      case 'llm.turn':
        s = { ...s, llmCostUsd: s.llmCostUsd + ((e['costUsd'] as number | undefined) ?? 0) };
        break;
      case 'questions':
        s = { ...s, pendingQuestions: e['questions'] as AskedQuestion[] };
        break;
      case 'answers':
        s = { ...s, pendingQuestions: null };
        break;
      case 'spec.approved':
        s = { ...s, approvedHash: e['hash'] as string };
        break;
      case 'park':
        s = {
          ...s,
          parked: {
            state: s.state,
            reason: String(e['reason']),
            message: String(e['message']),
            evidence: e['evidence'],
          },
          state: 'PARKED',
        };
        break;
      case 'resume':
        s = {
          ...s,
          state: (e['to'] as RunStateName | undefined) ?? s.parked?.state ?? s.state,
          parked: null,
        };
        break;
      case 'step.ok':
      case 'step.warn':
      case 'step.fail':
        s = {
          ...s,
          steps: {
            ...s.steps,
            [String(e['step'])]: {
              status: e.type.slice(5) as 'ok' | 'warn' | 'fail',
              data: e['data'],
            },
          },
        };
        break;
      case 'run.done':
        s = { ...s, state: 'DONE', done: true };
        break;
      default:
        break;
    }
  }
  return s;
}
