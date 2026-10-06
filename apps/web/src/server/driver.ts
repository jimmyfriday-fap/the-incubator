import {
  InterruptedError,
  ParkError,
  PolicyError,
  formatError,
  type Logger,
} from '@incubator/runtime';
import type {
  Answer,
  AskedQuestion,
  Engine,
  Prompter,
  ReviewVerdict,
  RunInput,
  RunState,
} from '@incubator/core';
import type { IncubatorSpec } from '@incubator/spec';

/**
 * The web UI answers asynchronously, so the prompter parks the run instead of blocking: CLARIFY parks
 * with `needs_input` and REVIEW with `needs_review`. Answers submitted later resume the run from its
 * journal with a one-shot prompter that returns them for the pending round only.
 */
export class WebPrompter implements Prompter {
  readonly interactive = true;
  #answers: readonly Answer[] | null;
  constructor(answers?: readonly Answer[]) {
    this.#answers = answers ?? null;
  }

  ask(questions: readonly AskedQuestion[]): Promise<Answer[]> {
    const answers = this.#answers;
    this.#answers = null;
    if (answers) return Promise.resolve([...answers]);
    return Promise.reject(
      new ParkError('needs_input', `${questions.length} question(s) are waiting in the UI`, {
        keys: questions.map((q) => q.key),
      }),
    );
  }

  review(): Promise<ReviewVerdict> {
    return Promise.reject(
      new ParkError('needs_review', 'the spec is waiting for approval in the UI'),
    );
  }
}

export class ConflictError extends PolicyError {
  constructor(message: string) {
    super(message, { code: 'conflict' });
  }
}

export interface DriverStatus {
  runId: string;
  busy: boolean;
  error: string | null;
}

/** Runs engine work in the background, one task per run at a time, and reports status changes. */
export class RunDriver {
  readonly #busy = new Map<string, Promise<void>>();
  readonly #errors = new Map<string, string>();
  readonly #listeners = new Set<(s: DriverStatus) => void>();

  constructor(
    private readonly engine: Engine,
    private readonly log: Logger,
  ) {}

  on(listener: (s: DriverStatus) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(runId: string): DriverStatus {
    return { runId, busy: this.#busy.has(runId), error: this.#errors.get(runId) ?? null };
  }

  /** Resolves when the run's background task (if any) has settled. */
  async idle(runId: string): Promise<void> {
    await this.#busy.get(runId);
  }

  private emit(runId: string): void {
    const s = this.status(runId);
    for (const l of this.#listeners) l(s);
  }

  private spawn(runId: string, work: () => Promise<RunState>): void {
    if (this.#busy.has(runId)) throw new ConflictError(`run ${runId} is already working`);
    this.#errors.delete(runId);
    const task = work()
      .then(() => undefined)
      .catch((err: unknown) => {
        // why: a stop is what the owner asked for, not an error to show.
        if (err instanceof InterruptedError) {
          this.log.info(`run ${runId} stopped`);
          return;
        }
        const message = formatError(err);
        this.#errors.set(runId, message);
        this.log.error(`run ${runId} failed: ${message}`);
      })
      .finally(() => {
        this.#busy.delete(runId);
        this.emit(runId);
      });
    this.#busy.set(runId, task);
    this.emit(runId);
  }

  private parkedAt(runId: string, state: string, reason?: string): RunState {
    const s = this.engine.state(runId);
    if (s.state !== 'PARKED' || s.parked?.state !== state || (reason && s.parked.reason !== reason))
      throw new ConflictError(
        `run ${runId} is not waiting at ${state} (it is ${s.state}${s.parked ? ` at ${s.parked.state}` : ''})`,
      );
    return s;
  }

  start(input: Omit<RunInput, 'surface'>): string {
    const runId = this.engine.start({ ...input, surface: 'web' });
    this.spawn(runId, () => this.engine.advance(runId, new WebPrompter()));
    return runId;
  }

  answer(runId: string, answers: { key: string; value: string }[]): void {
    const s = this.parkedAt(runId, 'CLARIFY', 'needs_input');
    const keys = new Set((s.pendingQuestions ?? []).map((q) => q.key));
    for (const a of answers)
      if (!keys.has(a.key)) throw new ConflictError(`no pending question ${a.key}`);
    this.spawn(runId, () =>
      this.engine.resume(
        runId,
        new WebPrompter(answers.map((a) => ({ ...a, source: 'user' as const }))),
      ),
    );
  }

  /** The "What do you want to change?" answer of an enhance run, then the run continues. */
  request(runId: string, text: string): void {
    this.parkedAt(runId, 'REQUEST', 'needs_request');
    this.engine.submitRequest(runId, text);
    this.spawn(runId, () => this.engine.resume(runId, new WebPrompter()));
  }

  /** The owner's answer to the commit request; the run then commits (or finishes) in the background. */
  commit(runId: string, a: { action: 'commit' | 'leave'; message?: string }): void {
    this.parkedAt(runId, 'COMMIT', 'needs_commit');
    this.engine.submitCommit(runId, a);
    this.spawn(runId, () => this.engine.resume(runId, new WebPrompter()));
  }

  /** The owner's answer to the push request; the run then pushes and opens the pull request, or finishes. */
  push(runId: string, action: 'push' | 'skip'): void {
    this.parkedAt(runId, 'PUSH', 'needs_push');
    this.engine.submitPush(runId, action);
    this.spawn(runId, () => this.engine.resume(runId, new WebPrompter()));
  }

  /** REVIEW → APPROVED (optionally with an edited spec), then continues in the background. */
  approve(runId: string, spec?: IncubatorSpec): void {
    this.parkedAt(runId, 'REVIEW');
    if (this.#busy.has(runId)) throw new ConflictError(`run ${runId} is already working`);
    this.engine.approve(runId, spec);
    this.spawn(runId, () => this.engine.advance(runId, new WebPrompter()));
  }

  /** Re-enters a parked or interrupted run (after fixing whatever parked it). */
  resume(runId: string): void {
    const s = this.engine.state(runId);
    if (s.done)
      throw new ConflictError(`run ${runId} ${s.cancelled ? 'was cancelled' : 'is finished'}`);
    this.spawn(runId, () => this.engine.resume(runId, new WebPrompter()));
  }

  /**
   * Stops the work under way: the model call or coding agent is killed and the run ends its step. It returns
   * at once; the run stops being busy when the work has settled. The run stays resumable.
   */
  stop(runId: string): void {
    if (!this.#busy.has(runId)) throw new ConflictError(`nothing is running for ${runId}`);
    this.engine.abortRun(runId, 'owner');
  }

  /** Abandons a run: stops it if it is working, waits for that, then records the cancellation. */
  async cancel(runId: string, reason?: string): Promise<void> {
    const s = this.engine.state(runId);
    if (s.done)
      throw new ConflictError(`run ${runId} is already ${s.cancelled ? 'cancelled' : 'finished'}`);
    if (this.#busy.has(runId)) {
      this.engine.abortRun(runId, 'owner');
      await this.#busy.get(runId);
    }
    this.engine.cancel(runId, reason);
    this.emit(runId);
  }

  /** Stops everything that is working and waits for it to settle (closing the app). */
  async stopAll(by: 'shutdown' | 'signal' = 'shutdown'): Promise<void> {
    this.engine.abortAll(by);
    await Promise.all([...this.#busy.values()]);
  }
}
