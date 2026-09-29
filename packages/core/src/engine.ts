import {
  InterruptedError,
  ParkError,
  ToolError,
  type Clock,
  type Logger,
} from '@incubator/runtime';
import type { LlmAdapter, LlmAdapterId } from '@incubator/llm';
import { complete } from '@incubator/llm';
import {
  completeSpec,
  discoveryTurnWireSchema,
  specHash,
  validateSemantics,
  validateSpec,
  type DiscoveryTurn,
  type IncubatorSpec,
} from '@incubator/spec';
import { attributionIssues, mergeTurn, type Draft } from './discovery/merge.js';
import { buildUserPrompt } from './discovery/prompt-builder.js';
import { MAX_ROUNDS, questionIssues, selectQuestions } from './discovery/questions.js';
import type { JournalEntry } from './journal.js';
import { loadPrompt } from './prompts.js';
import type { Prompter } from './prompter.js';
import {
  reduce,
  type Answer,
  type AskedQuestion,
  type RunState,
  type RunStateName,
} from './state.js';
import type { RunInput, RunStore } from './store.js';
import { INCUBATOR_VERSION } from './version.js';

export interface LlmSelector {
  select(
    purpose: 'discovery' | 'analysis' | 'handoff',
    preferred?: LlmAdapterId,
  ): Promise<LlmAdapter>;
}

export interface EngineDeps {
  store: RunStore;
  clock: Clock;
  log: Logger;
  llm: LlmSelector;
  llmTimeoutMs?: number;
}

export interface RunEvent {
  runId: string;
  entry: JournalEntry;
}

/** The single engine behind the CLI, web server and desktop app (TDD §4.2). */
export class Engine {
  readonly #listeners = new Set<(e: RunEvent) => void>();
  constructor(private readonly deps: EngineDeps) {}

  on(listener: (e: RunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private record(runId: string, type: string, fields: Record<string, unknown> = {}): JournalEntry {
    const entry = this.deps.store.open(runId).journal.append(type, fields);
    for (const l of this.#listeners) l({ runId, entry });
    return entry;
  }

  private enter(runId: string, state: RunStateName, round?: number): void {
    this.record(runId, 'state.enter', round === undefined ? { state } : { state, round });
  }

  state(runId: string): RunState {
    const { journal, header } = this.deps.store.open(runId);
    return reduce(journal.entries(), runId, header.input);
  }

  entries(runId: string): JournalEntry[] {
    return this.deps.store.open(runId).journal.entries();
  }

  draft(runId: string): Draft {
    const s = this.state(runId);
    return this.deps.store.readSpecRevision(runId, s.rev);
  }

  private writeRevision(runId: string, draft: Draft, extra: Record<string, unknown> = {}): number {
    const rev = this.state(runId).rev + 1;
    this.deps.store.writeSpecRevision(runId, rev, draft);
    this.record(runId, 'spec.revision', { rev, decisions: draft.decisions?.length ?? 0, ...extra });
    return rev;
  }

  /** INTAKE: creates the run and its first (empty) draft. */
  start(input: RunInput): string {
    const { runId } = this.deps.store.create(input, { incubator: INCUBATOR_VERSION });
    this.record(runId, 'run.start', { runId, input });
    this.enter(runId, 'INTAKE');
    this.writeRevision(runId, { intent: { narrative: input.narrative ?? '' }, decisions: [] });
    return runId;
  }

  private answers(runId: string): { answers: Answer[]; questions: Map<string, string> } {
    const answers: Answer[] = [];
    const questions = new Map<string, string>();
    for (const e of this.entries(runId)) {
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
      if (e.type === 'questions')
        for (const q of e['questions'] as AskedQuestion[]) questions.set(q.key, q.question);
    }
    return { answers, questions };
  }

  private async draftStep(runId: string, s: RunState): Promise<void> {
    const adapter = await this.deps.llm.select(
      'discovery',
      s.input.adapter as LlmAdapterId | undefined,
    );
    const prompt = loadPrompt('discovery');
    const before = this.draft(runId);
    const narrative = s.input.narrative ?? '';
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      analysis: null,
      draft: before,
      decisions: before.decisions ?? [],
    });
    const gate = await complete<DiscoveryTurn>(
      adapter,
      {
        schemaName: 'DiscoveryTurn',
        schema: discoveryTurnWireSchema,
        system: prompt.body,
        user,
        promptVersion: prompt.version,
        timeoutMs: this.deps.llmTimeoutMs ?? 180_000,
      },
      {
        log: this.deps.log,
        extraCheck: (turn) => [
          ...questionIssues(turn.questions),
          ...attributionIssues(before, turn),
        ],
      },
    );
    const turn = gate.value;
    this.record(runId, 'llm.turn', {
      round: s.round,
      adapter: adapter.id,
      model: gate.model ?? null,
      attempts: gate.attempts,
      costUsd: gate.costUsd,
      questions: turn.questions.length,
      done: turn.done,
    });
    const { answers, questions } = this.answers(runId);
    const merged = mergeTurn({
      before,
      turn,
      narrative,
      answers,
      questions,
      untrustedSource: s.input.kind === 'adopt',
    });
    this.writeRevision(runId, merged);
    const { asked, dropped } = selectQuestions(turn.questions, merged.decisions ?? []);
    if (dropped.length) this.record(runId, 'questions.dropped', { round: s.round, dropped });
    if (!turn.done && asked.length > 0) {
      this.record(runId, 'questions', { round: s.round, questions: asked });
      this.enter(runId, 'CLARIFY', s.round);
    } else {
      this.finalize(runId);
    }
  }

  private async clarifyStep(runId: string, s: RunState, prompter: Prompter): Promise<void> {
    const questions = s.pendingQuestions ?? [];
    const answers = await prompter.ask(questions, s.round);
    const byKey = new Map(questions.map((q) => [q.key, q]));
    for (const a of answers) {
      const q = byKey.get(a.key);
      if (!q) throw new ToolError(`answer for unknown question ${a.key}`);
      if (!q.options.some((o) => o.value === a.value))
        throw new ToolError(`answer "${a.value}" is not an option of ${a.key}`);
    }
    if (answers.length !== questions.length) throw new ToolError('every question needs an answer');
    this.record(runId, 'answers', { round: s.round, answers });
    const { answers: all, questions: texts } = this.answers(runId);
    const draft = mergeTurn({
      before: this.draft(runId),
      turn: { draftSpec: {}, questions: [], done: false },
      narrative: s.input.narrative ?? '',
      answers: all,
      questions: texts,
      untrustedSource: false,
    });
    this.writeRevision(runId, draft);
    if (s.round >= MAX_ROUNDS) this.finalize(runId);
    else this.enter(runId, 'DRAFT_SPEC', s.round + 1);
  }

  /** Fills defaults (`source: "default"`), validates schema + semantics, then REVIEW. */
  private finalize(runId: string): void {
    const { spec, added } = completeSpec(this.draft(runId));
    const issues = [...validateSpec(spec).issues, ...validateSemantics(spec)];
    if (issues.length)
      throw new ParkError(
        'spec_invalid',
        `the drafted spec is invalid (${issues.length} issue(s))`,
        { issues },
      );
    this.writeRevision(runId, spec as unknown as Draft, {
      final: true,
      defaulted: added.length,
      hash: specHash(spec),
    });
    this.enter(runId, 'REVIEW');
  }

  private async reviewStep(runId: string, prompter: Prompter): Promise<void> {
    const spec = this.draft(runId) as unknown as IncubatorSpec;
    const verdict = await prompter.review(spec);
    if (!verdict.approve) throw new ParkError('review_rejected', verdict.reason);
    this.approve(runId, verdict.spec);
  }

  /** REVIEW → APPROVED, optionally with a user-edited spec (revalidated). */
  approve(runId: string, edited?: IncubatorSpec): IncubatorSpec {
    let spec = this.draft(runId) as unknown as IncubatorSpec;
    if (edited) {
      const issues = [
        ...validateSpec(edited).issues,
        ...(validateSpec(edited).ok ? validateSemantics(edited) : []),
      ];
      if (issues.length)
        throw new ParkError(
          'spec_invalid',
          `the edited spec is invalid (${issues.length} issue(s))`,
          { issues },
        );
      spec = edited;
      this.writeRevision(runId, spec as unknown as Draft, {
        final: true,
        edited: true,
        hash: specHash(spec),
      });
    }
    this.record(runId, 'spec.approved', { hash: specHash(spec), rev: this.state(runId).rev });
    this.enter(runId, 'APPROVED');
    return spec;
  }

  /**
   * Drives the run until it is done, parked, or waiting at a state this phase does not implement.
   * A ParkError is journaled and the parked state returned (exit 2 at the CLI).
   */
  async advance(runId: string, prompter: Prompter): Promise<RunState> {
    try {
      for (;;) {
        const s = this.state(runId);
        switch (s.state) {
          case 'INTAKE':
            if (s.input.repo) this.enter(runId, 'ANALYZE');
            else this.enter(runId, 'DRAFT_SPEC', 1);
            break;
          case 'ANALYZE':
            throw new ToolError('brownfield analysis is not available in this build');
          case 'DRAFT_SPEC':
            await this.draftStep(runId, s);
            break;
          case 'CLARIFY':
            await this.clarifyStep(runId, s, prompter);
            break;
          case 'REVIEW':
            await this.reviewStep(runId, prompter);
            break;
          case 'APPROVED':
            if (s.input.specOnly) {
              this.record(runId, 'run.done', { specOnly: true, hash: s.approvedHash });
              break;
            }
            return s;
          case 'SCAFFOLD':
          case 'VERIFY':
          case 'PUBLISH':
          case 'HANDOFF':
          case 'DONE':
          case 'PARKED':
            return s;
        }
      }
    } catch (err) {
      if (err instanceof ParkError) {
        this.record(runId, 'park', {
          reason: err.reason,
          message: err.message,
          evidence: err.evidence ?? null,
        });
        this.deps.log.warn(`run ${runId} parked: ${err.message}`, { reason: err.reason });
        return this.state(runId);
      }
      if (err instanceof InterruptedError) this.record(runId, 'interrupted', {});
      throw err;
    }
  }

  /** Re-enters a parked (or interrupted) run from its journal. */
  async resume(
    runId: string,
    prompter: Prompter,
    overrides: Partial<Pick<RunInput, 'adapter' | 'yes'>> = {},
  ): Promise<RunState> {
    const s = this.state(runId);
    if (s.done) return s;
    if (s.state === 'PARKED')
      this.record(runId, 'resume', {
        to: s.parked?.state ?? 'INTAKE',
        from: s.parked?.reason ?? null,
        ...overrides,
      });
    if (overrides.adapter) this.record(runId, 'input.override', { adapter: overrides.adapter });
    return this.advance(runId, prompter);
  }
}
