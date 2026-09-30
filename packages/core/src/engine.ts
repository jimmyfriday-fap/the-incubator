import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  InterruptedError,
  ParkError,
  PolicyError,
  ToolError,
  type Clock,
  type Exec,
  type Logger,
} from '@incubator/runtime';
import type { Capabilities, LlmAdapter, LlmAdapterId } from '@incubator/llm';
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
import { Publisher, type PublishDeps, type PublishSummary, type StepContext } from './publish.js';
import { scaffoldSpec } from './scaffold.js';
import { Adopter, adoptReport, isEmptyDelta, writeReport, type AdoptContext } from './adopt.js';
import { PreviewCache, type Preview } from './preview.js';
import {
  analyze,
  coverageLines,
  deepScan,
  gapReport,
  planDelta,
  renderGapReport,
  renderScanReport,
  scanDigest,
  scanHash,
  summarizeGaps,
  viewFromDir,
  type RepoScan,
} from '@incubator/analyzer';
import { render, type RenderResult } from '@incubator/templates';
import {
  Enhancer,
  buildDelivery,
  enhanceBranch,
  enhanceDate,
  featureIssues,
  nextPlanNumber,
  outsideIntentIssues,
  partStep,
  renderPrBody,
  resolveTargets,
  sanitizeRequest,
  ticketId,
  type EnhancePlanRecord,
} from './enhance.js';
import {
  AGENT_ADAPTERS,
  activeTicket,
  buildHandoffArgv,
  handoffPrompt,
  launchHandoff,
  type HandoffAgent,
  type HandoffOutcome,
  type HandoffPlan,
} from './handoff.js';

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
  /** GitHub, git and verification; required to go past SCAFFOLD into VERIFY/PUBLISH. */
  publish?: PublishDeps;
  /** Handoff: probes an agent CLI and runs processes. */
  handoff?: { exec: Exec; probe(adapter: LlmAdapterId): Promise<Capabilities> };
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

  /** A run that starts from an existing, complete spec (for `publish <spec>` and scaffold runs). */
  startFromSpec(spec: IncubatorSpec, input: RunInput): string {
    const runId = this.start({ ...input, narrative: spec.intent.narrative });
    const issues = [
      ...validateSpec(spec).issues,
      ...(validateSpec(spec).ok ? validateSemantics(spec) : []),
    ];
    if (issues.length)
      throw new ParkError('spec_invalid', `the spec is invalid (${issues.length} issue(s))`, {
        issues,
      });
    this.writeRevision(runId, spec as unknown as Draft, { final: true, hash: specHash(spec) });
    this.approve(runId);
    return runId;
  }

  private stepContext(runId: string, spec: IncubatorSpec): StepContext {
    const s = this.state(runId);
    return {
      runId,
      spec,
      workspace: path.join(this.deps.store.runDir(runId), 'workspace'),
      steps: s.steps,
      record: (type, fields) => {
        this.record(runId, type, fields);
      },
      clock: this.deps.clock,
      log: this.deps.log,
      ...(s.input.keep ? { keep: true } : {}),
    };
  }

  #publisher: Publisher | undefined;
  private publisher(): Publisher {
    if (!this.deps.publish)
      throw new ToolError(
        'publishing is not configured for this engine (no GitHub/git dependencies)',
      );
    return (this.#publisher ??= new Publisher(this.deps.publish));
  }

  /** The approved spec (the final revision). */
  approvedSpec(runId: string): IncubatorSpec {
    return this.draft(runId) as unknown as IncubatorSpec;
  }

  /** PolicyErrors in effectful states park the run so it can be fixed and resumed (exit 2). */
  private async effect(runId: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      // A ParkError is already a PolicyError; wrapping it again would replace its reason and evidence.
      if (e instanceof ParkError) throw e;
      if (e instanceof PolicyError)
        throw new ParkError((e as PolicyError & { code?: string }).code ?? 'policy', e.message);
      throw e;
    }
  }

  #adopter: Adopter | undefined;
  private adopter(): Adopter {
    if (!this.deps.publish) throw new ToolError('adopt needs git and GitHub dependencies');
    return (this.#adopter ??= new Adopter(this.deps.publish));
  }

  #enhancer: Enhancer | undefined;
  private enhancer(): Enhancer {
    if (!this.deps.publish) throw new ToolError('enhance needs git and GitHub dependencies');
    return (this.#enhancer ??= new Enhancer(this.deps.publish));
  }

  private adoptContext(runId: string): AdoptContext {
    return {
      runId,
      workspace: path.join(this.deps.store.runDir(runId), 'workspace'),
      clock: this.deps.clock,
      steps: this.state(runId).steps,
      record: (type, fields) => {
        this.record(runId, type, fields);
      },
    };
  }

  /** ANALYZE (brownfield): acquire a copy, run the detectors, draft the spec, then REVIEW. */
  private async analyzeStep(runId: string, s: RunState): Promise<void> {
    if (s.input.kind === 'enhance') return this.enhanceAnalyzeStep(runId, s);
    await this.effect(runId, async () => {
      const a = this.adopter();
      const got = await a.acquire(this.adoptContext(runId), s.input.repo!, s.input.repoRef);
      const repoName =
        got.ref?.name ?? path.basename(path.resolve(s.input.repo!)).replace(/\.git$/, '');
      const owner = { type: s.input.ownerType ?? 'user', login: got.ref?.owner ?? '' } as const;
      const { analysis, items, spec } = a.inspect(got.dir, owner, repoName);
      const issues = [
        ...validateSpec(spec).issues,
        ...(validateSpec(spec).ok ? validateSemantics(spec) : []),
      ];
      if (issues.length)
        throw new ParkError(
          'spec_invalid',
          `the inferred spec is invalid (${issues.length} issue(s))`,
          { issues },
        );
      this.record(runId, 'adopt.analysis', {
        stack: analysis.stack,
        tests: analysis.tests,
        hasSpec: analysis.hasSpec,
        gaps: summarizeGaps(items),
      });
      this.writeRevision(runId, spec as unknown as Draft, {
        final: true,
        inferred: true,
        hash: specHash(spec),
      });
    });
    this.enter(runId, 'REVIEW');
  }

  /** SCAFFOLD for adopt: plan the delta; an empty one means the repository is already compliant. */
  private async adoptScaffoldStep(runId: string): Promise<void> {
    const spec = this.approvedSpec(runId);
    const ctx = this.adoptContext(runId);
    const dir = path.join(ctx.workspace, 'repo');
    let empty = false;
    await this.effect(runId, async () => {
      const a = this.adopter();
      const planned = ctx.steps['adopt.plan']?.data as
        { create: string[]; proposed: string[] } | undefined;
      const { result, delta } = await a.plan(dir, spec, planned);
      if (!planned) {
        // First pass only: the report describes the repository as it was before this run wrote
        // anything, and the planned lists are pinned before the first write so a replay reuses them.
        const view = viewFromDir(dir);
        const analysis = analyze(view);
        const report = adoptReport(analysis, gapReport(view, spec.stack.pack), delta);
        writeReport(this.deps.store.runDir(runId), report);
        this.record(runId, 'adopt.delta', {
          create: delta.create.length,
          proposed: delta.proposed,
          owned: delta.owned.length,
        });
        this.record(runId, 'step.ok', {
          step: 'adopt.plan',
          data: { create: delta.create, proposed: delta.proposed },
        });
      }
      if (isEmptyDelta(delta)) {
        empty = true;
        return;
      }
      const identity = (await this.deps.publish?.identity?.()) ?? {
        name: 'Incubator',
        email: 'incubator@users.noreply.github.com',
      };
      await a.commit(ctx, dir, result, delta, identity);
    });
    if (empty) {
      this.record(runId, 'step.ok', { step: 'adopt.compliant' });
      this.record(runId, 'run.done', { compliant: true });
    } else if (this.state(runId).input.noPublish) this.record(runId, 'run.done', { local: dir });
    else this.enter(runId, 'PUBLISH');
  }

  private async adoptPublishStep(runId: string): Promise<void> {
    const ctx = this.adoptContext(runId);
    const ref = (
      ctx.steps['adopt.acquire']?.data as
        { ref: { owner: string; name: string } | null } | undefined
    )?.ref;
    await this.effect(runId, async () => {
      if (!ref)
        throw new PolicyError(
          'the repository has no GitHub origin to open a pull request against',
          { code: 'no_github_origin' },
        );
      const body = readFileSync(
        path.join(this.deps.store.runDir(runId), 'adopt', 'gap-report.md'),
        'utf8',
      );
      const pr = await this.adopter().publish(ctx, path.join(ctx.workspace, 'repo'), ref, body);
      this.record(runId, 'adopt.summary', {
        pr,
        repo: `https://github.com/${ref.owner}/${ref.name}`,
      });
    });
    this.record(runId, 'run.done', {});
  }

  /** The adopt outcome: compliant, local branch, or the pull request. */
  adoptSummary(runId: string): {
    compliant: boolean;
    pr?: { number: number; url: string };
    report: string | null;
  } {
    const entries = this.entries(runId);
    const pr = entries.findLast((e) => e.type === 'adopt.summary')?.['pr'] as
      { number: number; url: string } | undefined;
    const file = path.join(this.deps.store.runDir(runId), 'adopt', 'gap-report.md');
    return {
      compliant: entries.some((e) => e.type === 'step.ok' && e['step'] === 'adopt.compliant'),
      ...(pr ? { pr } : {}),
      report: existsSync(file) ? readFileSync(file, 'utf8') : null,
    };
  }

  // --- enhance (TDD §7.4, ADR-020) ---------------------------------------------------------------

  private enhanceFile(runId: string, name: string): string {
    return path.join(this.deps.store.runDir(runId), 'enhance', name);
  }

  /** The scan the run saved at ANALYZE; later steps read it instead of re-scanning a tree they edited. */
  private readScan(runId: string): RepoScan {
    return JSON.parse(readFileSync(this.enhanceFile(runId, 'scan.json'), 'utf8')) as RepoScan;
  }

  /** Feature ids the repository's own incubator.json already had: not new requests. */
  private enhanceBaseline(runId: string): string[] {
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.scan');
    return (e?.['baseline'] as string[] | undefined) ?? [];
  }

  /** The owner's change request: a submitted one wins over the one given at start. */
  requestText(runId: string): string {
    const submitted = this.entries(runId).findLast((e) => e.type === 'enhance.request');
    return sanitizeRequest(
      typeof submitted?.['text'] === 'string'
        ? submitted['text']
        : (this.state(runId).input.request ?? ''),
    );
  }

  /** The web and desktop "What do you want to change?" step; resume the run afterwards. */
  submitRequest(runId: string, text: string): void {
    const s = this.state(runId);
    if (s.input.kind !== 'enhance' || (s.state !== 'REQUEST' && s.parked?.state !== 'REQUEST'))
      throw new PolicyError(`run ${runId} is not waiting for a change request`, {
        code: 'not_waiting',
      });
    const clean = sanitizeRequest(text);
    if (!clean)
      throw new PolicyError('describe what you want to change', { code: 'empty_request' });
    this.record(runId, 'enhance.request', { text: clean });
  }

  /** ANALYZE (enhance): acquire a copy, scan the whole repository, draft from the detectors, then REQUEST. */
  private async enhanceAnalyzeStep(runId: string, s: RunState): Promise<void> {
    await this.effect(runId, async () => {
      const a = this.adopter();
      const got = await a.acquire(this.adoptContext(runId), s.input.repo!, s.input.repoRef);
      const repoName =
        got.ref?.name ?? path.basename(path.resolve(s.input.repo!)).replace(/\.git$/, '');
      const owner = { type: s.input.ownerType ?? 'user', login: got.ref?.owner ?? '' } as const;
      let inspected: ReturnType<Adopter['inspect']>;
      try {
        inspected = a.inspect(got.dir, owner, repoName);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('no supported stack'))
          throw new ParkError('no_stack', e.message);
        throw e;
      }
      const { spec, items } = inspected;
      const issues = [
        ...validateSpec(spec).issues,
        ...(validateSpec(spec).ok ? validateSemantics(spec) : []),
      ];
      if (issues.length)
        throw new ParkError(
          'spec_invalid',
          `the inferred spec is invalid (${issues.length} issue(s))`,
          { issues },
        );
      const scan = deepScan(viewFromDir(got.dir));
      mkdirSync(path.dirname(this.enhanceFile(runId, 'x')), { recursive: true });
      writeFileSync(this.enhanceFile(runId, 'scan.json'), `${JSON.stringify(scan)}\n`);
      writeFileSync(this.enhanceFile(runId, 'scan-report.md'), renderScanReport(scan));
      this.record(runId, 'enhance.scan', {
        hash: scanHash(scan),
        scanned: scan.coverage.scanned,
        total: scan.coverage.total,
        totalIsLowerBound: scan.coverage.totalIsLowerBound,
        baseline: spec.intent.coreFeatures.map((f) => f.id),
        gaps: summarizeGaps(items),
      });
      this.writeRevision(runId, spec as unknown as Draft, {
        inferred: true,
        hash: specHash(spec),
      });
    });
    this.enter(runId, 'REQUEST');
  }

  /** REQUEST: the owner says what to change; without it the run parks for the UI or CLI to answer. */
  private requestStep(runId: string): void {
    if (!this.requestText(runId))
      throw new ParkError(
        'needs_request',
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    this.enter(runId, 'DRAFT_SPEC', 1);
  }

  /**
   * SCAFFOLD (enhance): pins the plan before the first write, then commits the delivery (and, when
   * asked for, the canonical gaps as a second commit). Nothing to deliver ends the run as a no-op.
   */
  private async enhanceScaffoldStep(runId: string): Promise<void> {
    const s = this.state(runId);
    const spec = this.approvedSpec(runId);
    const ctx = this.adoptContext(runId);
    const dir = path.join(ctx.workspace, 'repo');
    const baseline = this.enhanceBaseline(runId);
    const features = spec.intent.coreFeatures.filter((f) => !baseline.includes(f.id));
    let noop: string | null = null;
    await this.effect(runId, async () => {
      const prior = ctx.steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
      if (!prior && features.length === 0) {
        noop = 'no_features';
        return;
      }
      const scan = this.readScan(runId);
      const base = await render({ ...spec, intent: { ...spec.intent, coreFeatures: [] } });
      const date = prior?.date ?? enhanceDate(this.deps.clock);
      // Same day, same plan file: a re-run on a repository that already has this run's plan is a
      // no-op rather than a second numbered plan.
      const repoFiles = viewFromDir(dir).files;
      const sameDay = repoFiles.find((f) =>
        new RegExp(`^docs/plans/\\d{3}-enhance-${date}\\.md$`).test(f),
      );
      const planPath =
        prior?.planPath ?? sameDay ?? `docs/plans/${nextPlanNumber(repoFiles)}-enhance-${date}.md`;
      const targets = Object.fromEntries(features.map((f) => [f.id, resolveTargets(scan, f)]));
      const files = buildDelivery({
        spec,
        specHash: specHash(spec),
        request: this.requestText(runId),
        scan,
        scanReport: readFileSync(this.enhanceFile(runId, 'scan-report.md'), 'utf8'),
        date,
        planPath,
        features,
        targets,
        base,
      });
      const delivery: RenderResult = { ...base, files };
      let plan = prior;
      if (!plan) {
        const d = planDelta(delivery, dir);
        let gaps: EnhancePlanRecord['gaps'] = null;
        if (s.input.withGaps) {
          const view = viewFromDir(dir);
          const gd = planDelta(base, dir);
          const mine = (p: string): boolean => !files.has(p);
          const create = gd.create.filter(mine);
          const proposed = gd.proposed.filter(mine);
          const analysis = analyze(view);
          writeFileSync(
            this.enhanceFile(runId, 'gaps-report.md'),
            renderGapReport(analysis, gapReport(view, spec.stack.pack), {
              ...gd,
              create,
              proposed,
            }),
          );
          if (create.length || proposed.length) gaps = { create, proposed };
        }
        // The scan report describes the repository as it is now, so it always differs from the one
        // a previous delivery committed; it alone is never a reason to deliver again.
        const scanReport = `.incubator/enhance/${date}/scan-report.md`;
        const meaningful = [...d.create, ...d.proposed].filter((p) => p !== scanReport);
        if (meaningful.length === 0 && !gaps) {
          noop = 'already_delivered';
          return;
        }
        plan = {
          date,
          planPath,
          specHash: specHash(spec),
          create: d.create,
          proposed: d.proposed,
          gaps,
          features: features.map((f) => ({ id: f.id, lane: f.lane, targets: targets[f.id] ?? [] })),
        };
        this.record(runId, 'step.ok', { step: 'enhance.plan', data: plan });
      }
      const identity = (await this.deps.publish?.identity?.()) ?? {
        name: 'Incubator',
        email: 'incubator@users.noreply.github.com',
      };
      const e = this.enhancer();
      await e.commitPart(
        ctx,
        dir,
        'enhance',
        delivery,
        plan,
        identity,
        `chore: add the enhancement plan for ${features.length} request(s)\n\n${plan.create.length} file(s) added, ${plan.proposed.length} proposed as *.incubator-proposed.`,
      );
      if (plan.gaps)
        await e.commitPart(
          ctx,
          dir,
          'gaps',
          base,
          plan.gaps,
          identity,
          `chore: adopt the Incubator canonical pattern (optional)\n\n${plan.gaps.create.length} file(s) added, ${plan.gaps.proposed.length} proposed as *.incubator-proposed.`,
        );
    });
    if (noop) {
      this.record(runId, 'step.ok', { step: 'enhance.noop', data: { reason: noop } });
      this.record(runId, 'run.done', { noop: true, reason: noop });
    } else if (s.input.noPublish) this.record(runId, 'run.done', { local: dir });
    else this.enter(runId, 'PUBLISH');
  }

  private async enhancePublishStep(runId: string): Promise<void> {
    const ctx = this.adoptContext(runId);
    const spec = this.approvedSpec(runId);
    const ref = (
      ctx.steps['adopt.acquire']?.data as
        { ref: { owner: string; name: string } | null } | undefined
    )?.ref;
    await this.effect(runId, async () => {
      if (!ref)
        throw new PolicyError(
          'the repository has no GitHub origin to open a pull request against',
          { code: 'no_github_origin' },
        );
      const plan = ctx.steps['enhance.plan']!.data as EnhancePlanRecord;
      const gapsFile = this.enhanceFile(runId, 'gaps-report.md');
      const gapsSha = (ctx.steps[partStep('gaps')]?.data as { sha?: string } | undefined)?.sha;
      const body = renderPrBody({
        project: spec.project.name,
        request: this.requestText(runId),
        coverage: coverageLines(this.readScan(runId).coverage).join('\n\n'),
        plan,
        gapsMarkdown: plan.gaps && existsSync(gapsFile) ? readFileSync(gapsFile, 'utf8') : null,
        gapsSha: gapsSha ?? null,
      });
      const pr = await this.adopter().publish(
        ctx,
        path.join(ctx.workspace, 'repo'),
        ref,
        body,
        undefined,
        {
          prefix: 'enhance',
          commitStep: partStep('enhance'),
          title: `Enhancement plan: ${spec.project.name}`,
          fallbackBranch: enhanceBranch(this.deps.clock),
        },
      );
      this.record(runId, 'enhance.summary', {
        pr,
        repo: `https://github.com/${ref.owner}/${ref.name}`,
      });
    });
    this.enter(runId, 'HANDOFF');
  }

  /** The enhance outcome: nothing to change, the local branch, or the pull request. */
  enhanceSummary(runId: string): {
    noop: string | null;
    pr?: { number: number; url: string };
    plan: EnhancePlanRecord | null;
    scanReport: string | null;
  } {
    const entries = this.entries(runId);
    const pr = entries.findLast((e) => e.type === 'enhance.summary')?.['pr'] as
      { number: number; url: string } | undefined;
    const done = entries.findLast((e) => e.type === 'run.done');
    const plan = this.state(runId).steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
    const report = this.enhanceFile(runId, 'scan-report.md');
    return {
      noop: done?.['noop'] === true ? String(done['reason']) : null,
      ...(pr ? { pr } : {}),
      plan: plan ?? null,
      scanReport: existsSync(report) ? readFileSync(report, 'utf8') : null,
    };
  }

  private async scaffoldStep(runId: string, s: RunState): Promise<void> {
    if (s.input.kind === 'adopt') return this.adoptScaffoldStep(runId);
    if (s.input.kind === 'enhance') return this.enhanceScaffoldStep(runId);
    const spec = this.approvedSpec(runId);
    if (s.input.out) {
      const r = await scaffoldSpec(spec, { out: s.input.out });
      this.record(runId, 'step.ok', {
        step: 'render',
        data: { out: s.input.out, files: r.report?.written.length ?? 0 },
      });
      this.record(runId, 'run.done', { scaffoldOnly: true });
      return;
    }
    await this.effect(runId, async () => {
      const p = this.publisher();
      await p.preflight(this.stepContext(runId, spec));
      await p.render(this.stepContext(runId, spec));
    });
    this.enter(runId, 'VERIFY');
  }

  private async verifyStep(runId: string): Promise<void> {
    const spec = this.approvedSpec(runId);
    await this.effect(runId, () => this.publisher().verify(this.stepContext(runId, spec)));
    this.enter(runId, 'PUBLISH');
  }

  private async publishStep(runId: string): Promise<void> {
    const spec = this.approvedSpec(runId);
    let summary: PublishSummary | undefined;
    await this.effect(runId, async () => {
      const p = this.publisher();
      if (!this.state(runId).steps['token.resolve'])
        await p.preflight(this.stepContext(runId, spec));
      const rendered = await p.render(this.stepContext(runId, spec));
      summary = await p.publish(this.stepContext(runId, spec), rendered);
    });
    this.record(runId, 'publish.summary', { summary });
    this.enter(runId, 'HANDOFF');
  }

  /** HANDOFF: seed one ticket per feature through the tracker (idempotent by Incubator id). */
  private async handoffStep(runId: string): Promise<void> {
    const spec = this.approvedSpec(runId);
    await this.effect(runId, async () => {
      // Local tickets are rendered into the repository at SCAFFOLD; remote trackers sync here.
      const tracker =
        spec.tracker.type === 'local' ? null : await this.deps.publish?.tracker?.(spec);
      if (spec.tracker.type !== 'local' && !tracker)
        throw new PolicyError(`no ${spec.tracker.type} tracker is configured`, {
          code: 'no_tracker',
        });
      // Enhance runs sync only their own requests (E-<id>); new projects sync every feature (F-<id>).
      const plan = this.state(runId).steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
      const enhance = this.state(runId).input.kind === 'enhance';
      const mine = new Set(plan?.features.map((x) => x.id) ?? []);
      const list = spec.intent.coreFeatures.filter((f) => !enhance || mine.has(f.id));
      for (const f of tracker ? list : []) {
        const id = enhance ? ticketId(f) : `F-${f.id}`;
        const step = `handoff.ticket.${id}`;
        if (this.state(runId).steps[step]?.status === 'ok') continue;
        const r = await tracker!.ensureTicket({
          id,
          title: f.summary,
          lane: f.lane,
          description: `${f.summary}\n\nPlan: ${plan?.planPath ?? 'docs/plans/000-bootstrap.md'} (${spec.project.slug})`,
        });
        this.record(runId, 'step.ok', { step, data: r });
      }
    });
    this.record(runId, 'step.ok', {
      step: 'handoff.tickets',
      data: { tracker: spec.tracker.type },
    });
    this.record(runId, 'run.done', {});
  }

  /**
   * Prepares `incubator handoff`: the repository (scaffold-only output, or a fresh clone of the
   * published repo), the agent's headless argv from its probed capabilities, the ceilings and the
   * prompt with the executor plan inlined.
   */
  async prepareHandoff(
    runId: string,
    opts: { agent?: HandoffAgent } = {},
  ): Promise<{ plan: HandoffPlan; prompt: string; ticket: string | null }> {
    const s = this.state(runId);
    if (!s.done)
      throw new PolicyError(`run ${runId} is not finished (${s.state}); publish it first`, {
        code: 'not_done',
      });
    if (!this.deps.handoff) throw new ToolError('handoff is not configured for this engine');
    const spec = this.approvedSpec(runId);
    const enhance = s.input.kind === 'enhance';
    const delivered = enhance
      ? (s.steps['enhance.plan']?.data as EnhancePlanRecord | undefined)
      : undefined;
    if (enhance && !delivered)
      throw new PolicyError(`run ${runId} delivered nothing to hand off`, { code: 'no_plan' });
    let repo = enhance
      ? path.join(this.deps.store.runDir(runId), 'workspace', 'repo')
      : s.input.out;
    if (!repo) {
      const summary = this.publishSummary(runId);
      if (!summary)
        throw new PolicyError(`run ${runId} has no published repository`, {
          code: 'not_published',
        });
      repo = path.join(this.deps.store.runDir(runId), 'handoff', spec.project.slug);
      if (!existsSync(path.join(repo, '.git'))) {
        const pub = this.deps.publish;
        if (!pub)
          throw new ToolError('publishing is not configured (needed to clone the repository)');
        const token = await pub.resolveToken();
        const gh = pub.github(token!.token);
        await pub.git.clone(
          gh.remoteUrl({ owner: spec.project.owner.login, name: spec.project.slug }),
          repo,
          {
            ...(token ? { token: token.token } : {}),
          },
        );
      }
    }
    const agent = opts.agent ?? spec.agents.primary;
    const caps = await this.deps.handoff.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    const c = spec.agents.runCeilings;
    const ceilings = {
      turns: c.turns > 0 ? c.turns : 60,
      toolCalls: c.toolCalls > 0 ? c.toolCalls : 400,
      minutes: c.minutes > 0 ? c.minutes : 45,
      usd: c.usd > 0 ? c.usd : 10,
    };
    const planPath = delivered
      ? path.join(repo, ...delivered.planPath.split('/'))
      : path.join(repo, 'docs', 'plans', '000-bootstrap.md');
    if (!existsSync(planPath))
      throw new PolicyError(`no executor plan at ${planPath}`, { code: 'no_plan' });
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(caps, ceilings),
      cwd: repo,
      planPath,
      ceilings,
      unenforceable: [],
    };
    return {
      plan,
      prompt: handoffPrompt(readFileSync(planPath, 'utf8')),
      ticket: activeTicket(repo, spec, delivered?.features.map(ticketId)),
    };
  }

  /** `incubator handoff --launch`: runs the agent headless, bounded by the ceilings, logged per run. */
  async launchHandoff(
    runId: string,
    opts: { agent?: HandoffAgent; onEvent?: (chunk: string) => void } = {},
  ): Promise<HandoffOutcome> {
    const { plan, prompt, ticket } = await this.prepareHandoff(runId, opts);
    this.record(runId, 'handoff.launch', {
      agent: plan.agent,
      argv: plan.argv,
      ceilings: plan.ceilings,
      ticket,
    });
    const outcome = await launchHandoff(this.deps.handoff!.exec, plan, prompt, {
      logFile: path.join(this.deps.store.runDir(runId), 'logs', 'handoff.log'),
      ticket,
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    });
    this.record(runId, 'handoff.result', { ...outcome });
    return outcome;
  }

  /** The spec of the latest revision when it is complete (REVIEW onwards), else null. */
  finalSpec(runId: string): IncubatorSpec | null {
    const last = this.entries(runId).findLast((e) => e.type === 'spec.revision');
    return last?.['final'] === true
      ? (this.deps.store.readSpecRevision(runId, last['rev'] as number) as unknown as IncubatorSpec)
      : null;
  }

  /** Spec revisions of a run, oldest first (for the spec diff). */
  revisions(runId: string): { rev: number; final: boolean; edited: boolean; inferred: boolean }[] {
    return this.entries(runId)
      .filter((e) => e.type === 'spec.revision')
      .map((e) => ({
        rev: e['rev'] as number,
        final: e['final'] === true,
        edited: e['edited'] === true,
        inferred: e['inferred'] === true,
      }));
  }

  specRevision(runId: string, rev: number): Record<string, unknown> {
    return this.deps.store.readSpecRevision(runId, rev);
  }

  readonly #previews = new PreviewCache();

  /** The tree the run's complete spec renders to (with adopt delta statuses), or null before REVIEW. */
  async preview(runId: string): Promise<Preview | null> {
    const spec = this.finalSpec(runId);
    if (!spec || this.state(runId).input.kind === 'enhance') return null;
    const adopt = this.state(runId).input.kind === 'adopt';
    return this.#previews.preview(
      spec,
      adopt ? path.join(this.deps.store.runDir(runId), 'workspace', 'repo') : undefined,
    );
  }

  async previewFile(runId: string, filePath: string): Promise<Buffer | null> {
    const spec = this.finalSpec(runId);
    return spec ? this.#previews.file(spec, filePath) : null;
  }

  /** The publish summary recorded for a run, if it got that far. */
  publishSummary(runId: string): PublishSummary | null {
    const e = this.entries(runId).findLast((x) => x.type === 'publish.summary');
    return (e?.['summary'] as PublishSummary | undefined) ?? null;
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
    const enhance = s.input.kind === 'enhance';
    const prompt = loadPrompt(enhance ? 'enhance' : 'discovery');
    const before = this.draft(runId);
    const narrative = enhance ? this.requestText(runId) : (s.input.narrative ?? '');
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      ...(enhance ? { narrativeHeading: 'Change request' } : {}),
      analysis: enhance ? scanDigest(this.readScan(runId)) : null,
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
          ...(enhance
            ? [...featureIssues(turn.draftSpec, baseline), ...outsideIntentIssues(before, turn)]
            : []),
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
      untrustedSource: s.input.kind === 'adopt' || enhance,
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
            await this.analyzeStep(runId, s);
            break;
          case 'REQUEST':
            this.requestStep(runId);
            break;
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
            this.enter(runId, 'SCAFFOLD');
            break;
          case 'SCAFFOLD':
            await this.scaffoldStep(runId, s);
            break;
          case 'VERIFY':
            await this.verifyStep(runId);
            break;
          case 'PUBLISH':
            if (s.input.kind === 'adopt') await this.adoptPublishStep(runId);
            else if (s.input.kind === 'enhance') await this.enhancePublishStep(runId);
            else await this.publishStep(runId);
            break;
          case 'HANDOFF':
            await this.handoffStep(runId);
            break;
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
