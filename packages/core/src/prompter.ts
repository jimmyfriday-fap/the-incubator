import { ParkError, type ExitCode } from '@incubator/runtime';
import type { IncubatorSpec } from '@incubator/spec';
import type { Answer, AskedQuestion } from './state.js';

export type ReviewVerdict =
  { approve: true; spec?: IncubatorSpec } | { approve: false; reason: string };

/** How the engine talks to a human (CLI prompts, web UI, or scripted defaults in tests). */
export interface Prompter {
  readonly interactive: boolean;
  ask(questions: readonly AskedQuestion[], round: number): Promise<Answer[]>;
  review(spec: IncubatorSpec): Promise<ReviewVerdict>;
}

export function recommended(q: AskedQuestion): string {
  return (q.options.find((o) => o.recommended) ?? q.options[0]!).value;
}

/** `--yes`: every question takes its recommended option (`source: "default"`); review approves. */
export class DefaultsPrompter implements Prompter {
  readonly interactive = false;
  readonly asked: AskedQuestion[][] = [];
  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    this.asked.push([...questions]);
    return Promise.resolve(
      questions.map((q) => ({ key: q.key, value: recommended(q), source: 'default' as const })),
    );
  }
  review(): Promise<ReviewVerdict> {
    return Promise.resolve({ approve: true });
  }
}

/** No human available and no `--yes`: the run parks at the first question (resumable). */
export class NonInteractivePrompter implements Prompter {
  readonly interactive = false;
  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    return Promise.reject(
      new ParkError(
        'needs_input',
        `${questions.length} question(s) need an answer; resume interactively or with --yes`,
        {
          keys: questions.map((q) => q.key),
        },
      ),
    );
  }
  review(): Promise<ReviewVerdict> {
    return Promise.reject(
      new ParkError(
        'needs_review',
        'the drafted spec needs approval; resume interactively or with --yes',
      ),
    );
  }
}

/** Test helper: scripted answers by key (others get the recommended option, source "user"). */
export class ScriptedPrompter implements Prompter {
  readonly interactive = true;
  readonly asked: AskedQuestion[][] = [];
  constructor(
    private readonly answers: Record<string, string> = {},
    private readonly verdict: ReviewVerdict = { approve: true },
  ) {}
  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    this.asked.push([...questions]);
    return Promise.resolve(
      questions.map((q) => ({
        key: q.key,
        value: this.answers[q.key] ?? recommended(q),
        source: 'user' as const,
      })),
    );
  }
  review(): Promise<ReviewVerdict> {
    return Promise.resolve(this.verdict);
  }
}

export type { ExitCode };
