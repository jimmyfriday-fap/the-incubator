import { confirm, select } from '@inquirer/prompts';
import { InterruptedError } from '@incubator/runtime';
import type { Answer, AskedQuestion, Prompter, ReviewVerdict } from '@incubator/core';
import type { IncubatorSpec } from '@incubator/spec';
import type { Io } from './io.js';
import { summarizeSpec } from './summary.js';

async function guard<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof Error && e.name === 'ExitPromptError')
      throw new InterruptedError('prompt cancelled');
    throw e;
  }
}

/** Terminal prompts for CLARIFY and REVIEW. */
export class TerminalPrompter implements Prompter {
  readonly interactive = true;
  constructor(private readonly io: Io) {}

  async ask(questions: readonly AskedQuestion[], round: number): Promise<Answer[]> {
    this.io.stderr(
      `\nRound ${round}: ${questions.length} question(s). The recommended option is preselected.\n`,
    );
    const answers: Answer[] = [];
    for (const q of questions) {
      const rec = q.options.find((o) => o.recommended) ?? q.options[0]!;
      const value = await guard(
        select({
          message: q.question,
          default: rec.value,
          choices: q.options.map((o) => ({
            value: o.value,
            name: o.recommended ? `${o.label} (recommended)` : o.label,
          })),
        }),
      );
      answers.push({ key: q.key, value, source: 'user' });
    }
    return answers;
  }

  async review(spec: IncubatorSpec): Promise<ReviewVerdict> {
    this.io.stderr(`\n${summarizeSpec(spec)}\n`);
    const ok = await guard(confirm({ message: 'Approve this spec?', default: true }));
    return ok
      ? { approve: true }
      : {
          approve: false,
          reason:
            'not approved at review; edit spec/incubator.json in the run directory and resume',
        };
  }
}
