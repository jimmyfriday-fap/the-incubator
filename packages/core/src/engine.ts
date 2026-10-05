import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  InterruptedError,
  ParkError,
  PolicyError,
  ToolError,
  formatError,
  type Clock,
  type Exec,
  type Logger,
} from '@incubator/runtime';
import type { Capabilities, LlmAdapter, LlmAdapterId } from '@incubator/llm';
import { complete } from '@incubator/llm';
import type { RepoRef } from '@incubator/git';
import {
  ENHANCEMENT_SPEC_VERSION,
  OTHER,
  completeSpec,
  discoveryTurnWireSchema,
  specHash,
  stackById,
  validateSemantics,
  validateSpec,
  type DiscoveryTurn,
  type IncubatorSpec,
  type StackEntry,
} from '@incubator/spec';
import {
  attributionIssues,
  mergeTurn,
  otherIssues,
  type AskedInfo,
  type Draft,
} from './discovery/merge.js';
import { buildUserPrompt } from './discovery/prompt-builder.js';
import { MAX_ROUNDS, questionIssues, selectQuestions } from './discovery/questions.js';
import type { JournalEntry } from './journal.js';
import { loadPrompt } from './prompts.js';
import { inspectFolder, type FolderPurpose, type FolderVerdict } from './folders.js';
import {
  agentReport,
  draftMessage,
  ensureLocalExclude,
  finalMessage,
  finishBody,
  finishTrailer,
  type AgentChecks,
  type AgentReport,
  type FinishDetail,
} from './finish.js';
import {
  analysisSummarySchema,
  renderAnalysisSummary,
  summaryUserPrompt,
  type AnalysisSummary,
} from './analysis-summary.js';
import {
  cleanReviewSummary,
  reviewSummarySchema,
  reviewSummaryUserPrompt,
  type ReviewSummary,
} from './review-summary.js';
import {
  createStackProject,
  probeStack,
  toolPathEnv,
  type StackCreateResult,
  type StackProbe,
  type ToolsDeps,
} from './stacks.js';
import {
  recommendationIssues,
  stackRecommendationSchema,
  stackRecommendationUserPrompt,
  type StackRecommendation,
} from './stack-recommendation.js';
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
import { PreviewCache, type Preview, type PreviewStatus } from './preview.js';
import {
  analyze,
  cmp,
  coverageLines,
  deepScan,
  gapReport,
  planDelta,
  renderGapReport,
  renderScanReport,
  scanDigest,
  scanHash,
  proposeChecks,
  whatItDoes,
  summarizeGaps,
  unsupportedStackLabel,
  viewFromDir,
  type CheckProposal,
  type RepoScan,
} from '@incubator/analyzer';
import { externalTools, isCanonicalRepo, normalizeChecks, validateChecks } from './checks.js';
import { render, renderLanes, type RenderResult, type RenderedFile } from '@incubator/templates';
import {
  ENHANCEMENT_LANES,
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
  type HandoffProgress,
  cleanAgentText,
  type HandoffPlan,
} from './handoff.js';

/**
 * The identity of what the owner asked for. `existingRepo` (the base commit and the scan) is left
 * out on purpose: the same request against the repository after its own delivery was merged must
 * produce the same `request.md`, or a re-run could never be recognised as already delivered.
 */
function requestHash(spec: IncubatorSpec): string {
  const { existingRepo: _repoState, ...rest } = spec;
  return specHash(rest);
}

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
  /** Retrieved stacks (ADR-027): finds and runs a stack's own generator. */
  tools?: ToolsDeps;
}

export interface RunEvent {
  runId: string;
  entry: JournalEntry;
}

/** The single engine behind the CLI, web server and desktop app (TDD §4.2). */
/** What the scan recognised a repository as, for the review screen. */
export interface DetectedStack {
  label: string;
  evidence: string[];
  /** The Incubator has a stack pack for it. */
  packed: boolean;
}

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
      ...(s.input.dir && s.input.kind === 'new' ? { localDir: path.resolve(s.input.dir) } : {}),
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

  /** Check commands proposed at the scan: built-in constants chosen by the repository's manifests. */
  proposedChecks(runId: string): CheckProposal[] {
    const e = this.entries(runId).find((x) => x.type === 'enhance.scan');
    // why: runs journaled before `what` existed carry only the command and the reason.
    return ((e?.['checks'] as Partial<CheckProposal>[] | undefined) ?? []).map((c) => ({
      command: c.command ?? '',
      what: c.what ?? whatItDoes(c.command ?? ''),
      why: c.why ?? '',
    }));
  }

  /** What the owner approved: a list (possibly empty), or null while they have not decided. */
  approvedChecks(runId: string): string[] | null {
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.checks');
    return e ? (e['commands'] as string[]) : null;
  }

  /**
   * The owner's decision on what the coding agent may run in a repository the Incubator did not
   * build (ADR-025). An empty list is a decision too: edits only. Accepted until coding starts.
   */
  submitChecks(runId: string, commands: readonly string[]): string[] {
    const s = this.state(runId);
    if (s.input.kind !== 'enhance')
      throw new PolicyError(`run ${runId} is not an update of an existing repository`, {
        code: 'not_waiting',
      });
    if (s.done || s.steps['code.start'] !== undefined)
      throw new PolicyError(`run ${runId} has already started coding`, { code: 'not_waiting' });
    const clean = normalizeChecks(commands);
    const issues = validateChecks(clean);
    if (issues.length)
      throw new PolicyError(
        `check commands refused: ${issues.map((i) => `${i.path} ${i.message}`).join('; ')}`,
        { code: 'bad_checks', details: { issues } },
      );
    this.record(runId, 'enhance.checks', { commands: clean });
    return clean;
  }

  /**
   * What the owner is asked at review, for a folder run on a repository with no Incubator gate: the
   * proposals and the decision so far. Null when the question does not arise (no folder, an
   * Incubator-built repository, or the canonical files arriving with this run).
   */
  checksDetail(runId: string): { proposed: CheckProposal[]; approved: string[] | null } | null {
    const s = this.state(runId);
    if (s.input.kind !== 'enhance' || !s.input.dir) return null;
    const dir = this.runDir(s);
    if (!existsSync(dir) || isCanonicalRepo(dir)) return null;
    const pack = this.finalSpec(runId)?.stack.pack;
    if (s.input.withGaps === true && pack !== undefined && pack !== OTHER) return null;
    return { proposed: this.proposedChecks(runId), approved: this.approvedChecks(runId) };
  }

  /** What a coding agent may run in `repo`: its own gate, the approved commands, or nothing. */
  handoffChecks(runId: string, repo: string): AgentChecks {
    if (isCanonicalRepo(repo)) return { mode: 'gate', commands: [] };
    const approved = this.approvedChecks(runId) ?? [];
    return { mode: approved.length ? 'approved' : 'none', commands: approved };
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
      if (s.input.dir) await this.checkOwnerFolder(runId, s);
      const a = this.adopter();
      const got = await a.acquire(this.adoptContext(runId), s.input.repo!, s.input.repoRef);
      const repoName =
        got.ref?.name ?? path.basename(path.resolve(s.input.repo!)).replace(/\.git$/, '');
      const owner = { type: s.input.ownerType ?? 'user', login: got.ref?.owner ?? '' } as const;
      // Any repository can be updated: one with no stack pack gets an `other` draft (ADR-024).
      const inspected = a.inspect(got.dir, owner, repoName, { allowOther: true });
      const { items } = inspected;
      const scan = deepScan(viewFromDir(got.dir));
      const git = this.deps.publish?.git;
      // Spec 1.1: an enhancement run says which repository, at which commit, and what was scanned.
      const spec: IncubatorSpec = {
        ...inspected.spec,
        incubatorVersion: ENHANCEMENT_SPEC_VERSION,
        mode: 'enhancement',
        existingRepo: {
          ref: got.ref ? `${got.ref.owner}/${got.ref.name}` : repoName,
          defaultBranch: (await git?.currentBranch(got.dir)) ?? 'main',
          baseSha: (await git?.headSha(got.dir)) ?? '0'.repeat(40),
          scanHash: scanHash(scan),
        },
      };
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
      mkdirSync(path.dirname(this.enhanceFile(runId, 'x')), { recursive: true });
      writeFileSync(this.enhanceFile(runId, 'scan.json'), `${JSON.stringify(scan)}\n`);
      writeFileSync(this.enhanceFile(runId, 'scan-report.md'), renderScanReport(scan));
      await this.analysisSummary(runId, s, scan, got.dir);
      this.record(runId, 'enhance.scan', {
        hash: scanHash(scan),
        scanned: scan.coverage.scanned,
        total: scan.coverage.total,
        totalIsLowerBound: scan.coverage.totalIsLowerBound,
        baseline: spec.intent.coreFeatures.map((f) => f.id),
        gaps: summarizeGaps(items),
        ...(spec.stack.pack === OTHER ? { stack: unsupportedStackLabel(inspected.analysis) } : {}),
        // Proposals only: the owner approves what the coding agent may run (ADR-025).
        checks: isCanonicalRepo(got.dir)
          ? []
          : proposeChecks(viewFromDir(got.dir), inspected.analysis),
      });
      if (spec.stack.pack === OTHER && s.input.withGaps)
        this.record(runId, 'step.warn', {
          step: 'enhance.gaps_unavailable',
          message: `the canonical-pattern files need a stack pack, and this repository (${unsupportedStackLabel(inspected.analysis)}) has none: they are left out`,
        });
      this.writeRevision(runId, spec as unknown as Draft, {
        inferred: true,
        hash: specHash(spec),
      });
    });
    this.enter(runId, 'REQUEST');
  }

  /**
   * The LLM summary of the scan (ADR-007: a tool-less, empty-directory adapter; the digest and the
   * README's opening travel on stdin, fenced as untrusted data). Advisory: whatever goes wrong here,
   * the run goes on with a warning, and the summary never feeds the spec.
   */
  private async analysisSummary(
    runId: string,
    s: RunState,
    scan: RepoScan,
    dir: string,
  ): Promise<void> {
    if (this.state(runId).steps['enhance.summary']?.status === 'ok') return;
    try {
      const adapter = await this.deps.llm.select(
        'analysis',
        s.input.adapter as LlmAdapterId | undefined,
      );
      const prompt = loadPrompt('analysis-summary');
      const readme = ['README.md', 'README', 'readme.md', 'README.rst']
        .map((f) => path.join(dir, f))
        .find((f) => existsSync(f) && statSync(f).isFile());
      // Only the opening is read, whatever the file's size.
      const opening = readme ? readFileSync(readme).subarray(0, 4000).toString('utf8') : null;
      const gate = await complete<AnalysisSummary>(
        adapter,
        {
          schemaName: 'AnalysisSummary',
          schema: analysisSummarySchema,
          system: prompt.body,
          user: summaryUserPrompt(scanDigest(scan), opening),
          promptVersion: prompt.version,
          timeoutMs: this.deps.llmTimeoutMs ?? 180_000,
        },
        { log: this.deps.log },
      );
      writeFileSync(
        this.enhanceFile(runId, 'analysis-summary.md'),
        renderAnalysisSummary(gate.value, coverageLines(scan.coverage)),
      );
      this.record(runId, 'llm.turn', {
        purpose: 'analysis',
        adapter: adapter.id,
        model: gate.model ?? null,
        attempts: gate.attempts,
        costUsd: gate.costUsd,
      });
      this.record(runId, 'step.ok', { step: 'enhance.summary', data: { adapter: adapter.id } });
    } catch (e) {
      if (e instanceof InterruptedError) throw e;
      this.record(runId, 'step.warn', {
        step: 'enhance.summary',
        data: { reason: (e instanceof Error ? e.message : String(e)).slice(0, 300) },
      });
    }
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
   * What an enhancement delivers for the approved spec: the delivery files, the rendered base pack
   * (lane templates, canonical gaps) and the pinned names. Pure with respect to the repository, so
   * the REVIEW preview and the SCAFFOLD step cannot disagree.
   */
  private async enhanceDelivery(runId: string, spec: IncubatorSpec, prior?: EnhancePlanRecord) {
    const dir = path.join(this.deps.store.runDir(runId), 'workspace', 'repo');
    const baseline = this.enhanceBaseline(runId);
    const features = spec.intent.coreFeatures.filter((f) => !baseline.includes(f.id));
    const scan = this.readScan(runId);
    // With no stack pack there is no canonical tree to render: only the lane templates, which need none.
    const base: RenderResult =
      spec.stack.pack === OTHER
        ? {
            files: await renderLanes(ENHANCEMENT_LANES),
            packs: [],
            lock: {
              lockVersion: 1,
              incubatorVersion: INCUBATOR_VERSION,
              specHash: specHash(spec),
              packs: [],
              files: {},
            },
            settings: { variables: [], secrets: [] },
          }
        : await render({ ...spec, intent: { ...spec.intent, coreFeatures: [] } });
    const date = prior?.date ?? enhanceDate(this.deps.clock);
    // Same day, same plan file: a re-run on a repository that already has this run's plan is a
    // no-op rather than a second numbered plan.
    const repoFiles = viewFromDir(dir).files;
    const sameDay = repoFiles.find((f) =>
      new RegExp(`^docs/plans/\\d{3}-enhance-${date}\\.md$`).test(f),
    );
    const planPath =
      prior?.planPath ?? sameDay ?? `docs/plans/${nextPlanNumber(repoFiles)}-enhance-${date}.md`;
    const targets = Object.fromEntries(
      features.map((f) => [f.id, f.targets ?? resolveTargets(scan, f)]),
    );
    const files = buildDelivery({
      spec,
      specHash: requestHash(spec),
      request: this.requestText(runId),
      scan,
      scanReport: readFileSync(this.enhanceFile(runId, 'scan-report.md'), 'utf8'),
      analysisSummary: existsSync(this.enhanceFile(runId, 'analysis-summary.md'))
        ? readFileSync(this.enhanceFile(runId, 'analysis-summary.md'), 'utf8')
        : null,
      date,
      planPath,
      features,
      targets,
      base,
      // No Incubator gate in the repository, and none arriving with this delivery.
      external:
        !isCanonicalRepo(dir) &&
        !(this.state(runId).input.withGaps === true && spec.stack.pack !== OTHER),
    });
    const delivery: RenderResult = { ...base, files };
    return { dir, features, base, date, planPath, targets, files, delivery };
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
      const { base, date, planPath, targets, files, delivery } = await this.enhanceDelivery(
        runId,
        spec,
        prior,
      );
      let plan = prior;
      if (!plan) {
        const d = planDelta(delivery, dir);
        let gaps: EnhancePlanRecord['gaps'] = null;
        if (s.input.withGaps && spec.stack.pack !== OTHER) {
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
          specHash: requestHash(spec),
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
    } else if (s.input.dir) {
      // In place: the plan moves into the owner's folder, tickets sync, then the agent codes there.
      await this.effect(runId, () => this.deliverInPlace(runId, this.state(runId)));
      this.enter(runId, 'HANDOFF');
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
        analysisSummary: existsSync(this.enhanceFile(runId, 'analysis-summary.md'))
          ? readFileSync(this.enhanceFile(runId, 'analysis-summary.md'), 'utf8')
          : null,
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

  /**
   * Advisory: which stack fits a new idea, from the catalog only. A failure is a warning, never an
   * error, and the owner then picks from the list themselves.
   */
  async stackRecommend(
    idea: string,
    opts: { adapter?: LlmAdapterId } = {},
  ): Promise<
    { status: 'ready'; recommendation: StackRecommendation } | { status: 'failed'; message: string }
  > {
    try {
      const adapter = await this.deps.llm.select('analysis', opts.adapter);
      const prompt = loadPrompt('stack-recommendation');
      const gate = await complete<StackRecommendation>(
        adapter,
        {
          schemaName: 'StackRecommendation',
          schema: stackRecommendationSchema,
          system: prompt.body,
          user: stackRecommendationUserPrompt(idea),
          promptVersion: prompt.version,
          timeoutMs: this.deps.llmTimeoutMs ?? 180_000,
        },
        { log: this.deps.log, extraCheck: (rec) => recommendationIssues(rec) },
      );
      return { status: 'ready', recommendation: gate.value };
    } catch (e) {
      if (e instanceof InterruptedError) throw e;
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
      this.deps.log.warn(`stack recommendation failed: ${message}`);
      return { status: 'failed', message };
    }
  }

  private retrievedStack(id: string): StackEntry {
    const entry = stackById(id);
    if (!entry || entry.kind !== 'retrieved')
      throw new PolicyError(`${id} is not a stack that is created by its own generator`, {
        code: 'not_retrieved',
      });
    if (!this.deps.tools)
      throw new PolicyError('this build cannot run a stack generator', { code: 'no_tools' });
    return entry;
  }

  /** Is the tool for a retrieved stack installed (ADR-027)? */
  stackProbe(id: string): Promise<StackProbe> {
    return probeStack(this.retrievedStack(id), this.deps.tools!);
  }

  /** Creates a new project in an empty folder with the stack's own generator, then commits it. */
  stackCreate(input: {
    stack: string;
    dir: string;
    name: string;
    org: string;
  }): Promise<StackCreateResult> {
    const entry = this.retrievedStack(input.stack);
    const publish = this.deps.publish;
    if (!publish) throw new PolicyError('this build cannot run git', { code: 'no_git' });
    return createStackProject(entry, input, {
      ...this.deps.tools!,
      git: publish.git,
      ...(publish.identity ? { identity: () => publish.identity!() } : {}),
    });
  }

  /** The enhance outcome: nothing to change, the local branch, or the pull request. */
  enhanceSummary(runId: string): {
    noop: string | null;
    pr?: { number: number; url: string };
    plan: EnhancePlanRecord | null;
    scanReport: string | null;
    stack: DetectedStack | null;
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
      stack: this.detectedStack(runId),
    };
  }

  /**
   * What the scan recognised the repository as ("Dart/Flutter"), with the files that say so, and
   * whether the Incubator has a stack pack for it. Null before the scan or on a run with no scan.
   */
  detectedStack(runId: string): DetectedStack | null {
    if (this.state(runId).input.kind !== 'enhance') return null;
    if (!existsSync(this.enhanceFile(runId, 'scan.json'))) return null;
    const eco = this.readScan(runId).analysis.ecosystem;
    const pack = this.finalSpec(runId)?.stack.pack ?? this.draftPack(runId);
    return eco
      ? { label: eco.label, evidence: eco.evidence.map((e) => e.file), packed: pack !== OTHER }
      : null;
  }

  private draftPack(runId: string): string | undefined {
    return (this.draft(runId)['stack'] as { pack?: string } | undefined)?.pack;
  }

  readonly #reviewSummaries = new Map<
    string,
    { promise?: Promise<void> | undefined; failed?: string | undefined }
  >();

  /**
   * The plain-English brief for the spec at REVIEW. Generated on first ask (so a run already parked
   * at review gets one too), cached on disk per spec hash, and advisory: a failure is a warning and
   * never blocks approval.
   */
  reviewSummary(
    runId: string,
    opts: { retry?: boolean } = {},
  ):
    | { status: 'ready'; summary: ReviewSummary }
    | { status: 'pending' }
    | {
        status: 'failed';
        message: string;
      }
    | { status: 'unavailable' } {
    const spec = this.finalSpec(runId);
    if (!spec) return { status: 'unavailable' };
    const hash = specHash(spec);
    const file = path.join(
      this.deps.store.runDir(runId),
      'review',
      `summary-${hash.slice(7, 23)}.json`,
    );
    if (existsSync(file))
      return {
        status: 'ready',
        summary: JSON.parse(readFileSync(file, 'utf8')) as ReviewSummary,
      };
    // why: a summary is only written while the owner is at the review, never for the edited spec an
    // approval writes next, or for a run that has moved on.
    const st = this.state(runId);
    if (st.state !== 'REVIEW' && !(st.state === 'PARKED' && st.parked?.state === 'REVIEW'))
      return { status: 'unavailable' };
    const key = `${runId}:${hash}`;
    let slot = this.#reviewSummaries.get(key);
    if (slot?.failed !== undefined && opts.retry) slot = undefined;
    if (slot?.failed !== undefined) return { status: 'failed', message: slot.failed };
    if (!slot?.promise) {
      slot = {};
      this.#reviewSummaries.set(key, slot);
      const s = this.state(runId);
      const cell = slot;
      cell.promise = this.writeReviewSummary(runId, s, spec, hash, file)
        .catch((e: unknown) => {
          if (e instanceof InterruptedError) return;
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          cell.failed = message;
          this.record(runId, 'step.warn', { step: 'review.summary', data: { reason: message } });
        })
        .finally(() => {
          cell.promise = undefined;
        });
    }
    return { status: 'pending' };
  }

  private async writeReviewSummary(
    runId: string,
    s: RunState,
    spec: IncubatorSpec,
    hash: string,
    file: string,
  ): Promise<void> {
    const adapter = await this.deps.llm.select(
      'analysis',
      s.input.adapter as LlmAdapterId | undefined,
    );
    const prompt = loadPrompt('review-summary');
    const enhance = s.input.kind === 'enhance';
    const gate = await complete<ReviewSummary>(
      adapter,
      {
        schemaName: 'ReviewSummary',
        schema: reviewSummarySchema,
        system: prompt.body,
        user: reviewSummaryUserPrompt({
          kind: s.input.kind,
          request: enhance ? this.requestText(runId) : (s.input.narrative ?? spec.intent.narrative),
          spec,
          detected: enhance ? this.detectedStack(runId) : null,
          digest: enhance ? scanDigest(this.readScan(runId)) : null,
        }),
        promptVersion: prompt.version,
        timeoutMs: this.deps.llmTimeoutMs ?? 180_000,
      },
      { log: this.deps.log },
    );
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      `${JSON.stringify(cleanReviewSummary(gate.value), null, 2)}
`,
      {
        mode: 0o600,
      },
    );
    this.record(runId, 'llm.turn', {
      purpose: 'review-summary',
      adapter: adapter.id,
      model: gate.model ?? null,
      attempts: gate.attempts,
      costUsd: gate.costUsd,
    });
    this.record(runId, 'review.summary', { hash });
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
    // A folder run goes on to the coding iteration; the others are done.
    if (this.state(runId).input.dir) this.enter(runId, 'CODE');
    else this.record(runId, 'run.done', {});
  }

  // --- folder runs: coding, then the owner's commit and push (ADR-023) ---------------------------

  /** Explains a folder the owner chose before a run starts (the wizard, the CLI). Changes nothing. */
  async inspectFolder(folder: string, purpose: FolderPurpose): Promise<FolderVerdict> {
    if (!this.deps.publish) throw new ToolError('folders need git dependencies');
    return inspectFolder(this.deps.publish.git, folder, purpose);
  }

  /** In-place enhance and new-solution runs both name a folder; everything below works on it. */
  private runDir(s: RunState): string {
    return path.resolve(s.input.dir!);
  }

  /**
   * In-place enhance: the folder must be a clean git repository (parks `dirty_tree`, `not_git` and so on
   * otherwise), and its starting point is recorded so delivery can prove nothing moved underneath.
   */
  private async checkOwnerFolder(runId: string, s: RunState): Promise<void> {
    if (s.steps['folder.base']?.status === 'ok') return;
    const git = this.deps.publish?.git;
    if (!git) throw new ToolError('enhance needs git and GitHub dependencies');
    const v = await inspectFolder(git, this.runDir(s), 'existing');
    if (!v.ok)
      throw new ParkError(
        v.git && !v.git.clean ? 'dirty_tree' : 'folder_invalid',
        v.problems.join(' '),
        { path: v.path, changed: v.git?.changed ?? [] },
      );
    this.record(runId, 'step.ok', {
      step: 'folder.base',
      data: { head: v.git!.head, branch: v.git!.branch, origin: v.git!.origin },
    });
  }

  /**
   * In-place enhance: the plan was committed on a branch in the run's clone; bring that branch into the
   * owner's folder and check it out. The owner's own branch is not written to, and nothing moves if the
   * folder changed since the scan.
   */
  private async deliverInPlace(runId: string, s: RunState): Promise<void> {
    if (s.steps['deliver']?.status === 'ok') return;
    const git = this.deps.publish!.git;
    const dir = this.runDir(s);
    const base = s.steps['folder.base']!.data as { head: string; branch: string };
    const branch = (s.steps[partStep('enhance')]?.data as { branch?: string } | undefined)?.branch;
    if (!branch) throw new ToolError('the enhance branch was not recorded');
    const now = await git.currentBranch(dir);
    if (now !== branch) {
      const status = await git.status(dir);
      if (status.length || now !== base.branch || (await git.headSha(dir)) !== base.head)
        throw new ParkError(
          'folder_changed',
          'the folder changed while the plan was being prepared; commit or stash your changes, go back to the branch you started on, and resume',
          { expected: base, now, changed: status.slice(0, 8).map((e) => e.path) },
        );
      await git.fetch(
        dir,
        path.join(this.deps.store.runDir(runId), 'workspace', 'repo'),
        `refs/heads/${branch}:refs/heads/${branch}`,
      );
      await git.checkout(dir, branch);
    }
    ensureLocalExclude(dir);
    this.record(runId, 'step.ok', { step: 'deliver', data: { branch, from: base.branch } });
  }

  private async codeStep(runId: string, s: RunState): Promise<void> {
    if (s.steps['code.done']?.status === 'ok') return this.enter(runId, 'COMMIT');
    const dir = this.runDir(s);
    const git = this.deps.publish!.git;
    await this.effect(runId, async () => {
      if (s.steps['code.start']?.status !== 'ok') {
        let branch = await git.currentBranch(dir);
        // A new solution is coded on its own branch: the staging branch deploys.
        if (s.input.kind === 'new') {
          const target = `incubator/build-${enhanceDate(this.deps.clock)}`;
          if (branch !== target) await git.checkoutNewBranch(dir, target);
          branch = target;
        }
        this.record(runId, 'step.ok', {
          step: 'code.start',
          data: { branch, base: await git.headSha(dir) },
        });
      }
      ensureLocalExclude(dir);
      const checks = this.handoffChecks(runId, dir);
      if (checks.mode === 'none')
        this.record(runId, 'step.warn', {
          step: 'code.checks',
          message:
            'no check commands were approved for this repository: the agent can edit files but cannot run anything, so its work is untested',
        });
      let last = 0;
      const out = await this.launchHandoff(runId, {
        onProgress: (p) => {
          // why: a long run reports every turn; the journal keeps the first and then one a second.
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
      });
      this.record(runId, 'step.ok', { step: 'code.done', data: { ...agentReport(out), checks } });
    });
    this.enter(runId, 'COMMIT');
  }

  /** The review the owner needs at the commit request, computed from the folder as it is now. */
  async finishDetail(runId: string): Promise<FinishDetail | null> {
    const s = this.state(runId);
    if (!s.input.dir || !this.deps.publish) return null;
    // Nothing to review (and the spec may still be a draft) until the run reaches the coding stage.
    const reached =
      s.steps['code.start'] !== undefined ||
      s.state === 'CODE' ||
      (s.state === 'PARKED' && s.parked?.state === 'CODE');
    if (!reached) return null;
    const dir = this.runDir(s);
    const git = this.deps.publish.git;
    const stage: FinishDetail['stage'] = s.done
      ? 'done'
      : s.state === 'CODE' || (s.state === 'PARKED' && s.parked?.state === 'CODE')
        ? 'coding'
        : s.state === 'PUSH' || (s.state === 'PARKED' && s.parked?.state === 'PUSH')
          ? 'push'
          : 'commit';
    const start = s.steps['code.start']?.data as { branch?: string | null } | undefined;
    const committed = s.steps['finish.commit']?.data as FinishDetail['commit'];
    const agent = (s.steps['code.done']?.data as AgentReport | undefined) ?? null;
    const files = stage === 'commit' && existsSync(dir) ? await git.status(dir) : [];
    const target = this.pushTarget(runId, s);
    const approved = this.entries(runId).findLast((e) => e.type === 'finish.approve');
    const progress = this.entries(runId).findLast((e) => e.type === 'handoff.progress');
    const pr = this.entries(runId).findLast((e) => e.type === 'finish.summary')?.['pr'] as
      { number: number; url: string } | undefined;
    return {
      stage,
      dir,
      branch: committed?.branch ?? start?.branch ?? null,
      agent,
      files,
      message:
        typeof approved?.['message'] === 'string'
          ? approved['message']
          : draftMessage({ title: this.finishTitle(runId, s), summary: agent?.summary ?? null }),
      identity: existsSync(dir) ? await git.identity(dir) : null,
      commit: committed ?? null,
      target,
      pr: pr ?? null,
      progress:
        stage === 'coding' && progress
          ? {
              turns: Number(progress['turns'] ?? 0),
              toolCalls: Number(progress['toolCalls'] ?? 0),
              costUsd: typeof progress['costUsd'] === 'number' ? progress['costUsd'] : null,
              snippet: typeof progress['snippet'] === 'string' ? progress['snippet'] : null,
            }
          : null,
    };
  }

  /** The subject of the drafted commit: the one request, the count of requests, or the new project. */
  private finishTitle(runId: string, s: RunState): string {
    if (s.input.kind === 'enhance') {
      const plan = s.steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
      const features = plan?.features ?? [];
      if (features.length === 1) {
        const f = this.approvedSpec(runId).intent.coreFeatures.find(
          (x) => x.id === features[0]!.id,
        );
        return f?.summary ?? features[0]!.id;
      }
      return `${features.length} enhancement requests`;
    }
    return `build ${this.approvedSpec(runId).project.name}`;
  }

  /** Where Push would send the branch: the GitHub repository of the folder, or the reason there is none. */
  private pushTarget(runId: string, s: RunState): FinishDetail['target'] {
    if (s.input.kind === 'new') {
      const spec = this.approvedSpec(runId);
      return { repo: { owner: spec.project.owner.login, name: spec.project.slug }, reason: null };
    }
    const base = s.steps['folder.base']?.data as { origin?: RepoRef | null } | undefined;
    // An explicit repository (owner/name) wins, as for `adopt`: the origin may not be GitHub's URL form.
    const repo = s.input.repoRef ?? base?.origin ?? null;
    return repo
      ? { repo, reason: null }
      : {
          repo: null,
          reason:
            'The folder has no GitHub origin, so there is nowhere to push or open a pull request.',
        };
  }

  /** COMMIT: park with the review until the owner approves (or leaves the changes uncommitted). */
  private async commitStep(runId: string, s: RunState): Promise<void> {
    if (s.steps['finish.commit']?.status === 'ok') return this.enter(runId, 'PUSH');
    const dir = this.runDir(s);
    const git = this.deps.publish!.git;
    const start = s.steps['code.start']!.data as { branch: string; base: string | null };
    await this.effect(runId, async () => {
      const done = (data: FinishDetail['commit']): void => {
        this.record(runId, 'step.ok', { step: 'finish.commit', data });
      };
      const head = await git.headSha(dir);
      // A crash after the commit but before the journal entry: take the commit as it is.
      if ((await git.headMessage(dir))?.includes(finishTrailer(runId))) {
        done({ sha: head, branch: start.branch });
        return this.enter(runId, 'PUSH');
      }
      const changes = await git.status(dir);
      if (changes.length === 0) {
        if (head === start.base) {
          done({ sha: null, branch: start.branch, none: true });
          this.record(runId, 'run.done', { nothingToCommit: true });
          return;
        }
        done({ sha: head, branch: start.branch });
        return this.enter(runId, 'PUSH');
      }
      const approval = this.entries(runId).findLast((e) => e.type === 'finish.approve');
      if (!approval)
        throw new ParkError(
          'needs_commit',
          `${changes.length} changed file${changes.length === 1 ? '' : 's'} are waiting for your decision to commit`,
          { files: changes.length },
        );
      if (approval['action'] === 'leave') {
        done({ sha: null, branch: start.branch, left: true });
        this.record(runId, 'run.done', { uncommitted: true });
        return;
      }
      if (!(await git.identity(dir)))
        throw new ParkError(
          'no_git_identity',
          'git does not know who you are: run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`, then resume',
        );
      const fallback = draftMessage({
        title: this.finishTitle(runId, s),
        summary: (s.steps['code.done']?.data as AgentReport | undefined)?.summary ?? null,
      });
      await git.addAll(dir);
      const sha = await git.commit(
        dir,
        finalMessage(
          typeof approval['message'] === 'string' ? approval['message'] : '',
          fallback,
          runId,
        ),
        {},
      );
      done({ sha, branch: start.branch });
      this.enter(runId, 'PUSH');
    });
  }

  /** PUSH: the owner decides whether the branch goes to GitHub as a pull request. */
  private async pushStep(runId: string, s: RunState): Promise<void> {
    const committed = s.steps['finish.commit']!.data as { sha: string | null; branch: string };
    const target = this.pushTarget(runId, s);
    if (!target.repo) {
      this.record(runId, 'run.done', { committedLocally: true, reason: target.reason });
      return;
    }
    const decision = this.entries(runId).findLast((e) => e.type === 'finish.push');
    if (!decision)
      throw new ParkError(
        'needs_push',
        `push ${committed.branch} to ${target.repo.owner}/${target.repo.name}?`,
      );
    if (decision['action'] === 'skip') {
      this.record(runId, 'run.done', { committedLocally: true });
      return;
    }
    const ctx = this.adoptContext(runId);
    await this.effect(runId, async () => {
      const spec = this.approvedSpec(runId);
      const agent = s.steps['code.done']?.data as AgentReport | undefined;
      const files = (
        await this.deps.publish!.git.diffNameStatus(
          this.runDir(s),
          (s.steps['code.start']!.data as { base: string }).base,
          committed.sha!,
        )
      ).map(([, p]) => p);
      const body = finishBody({
        title: this.finishTitle(runId, s),
        summary: agent?.summary ?? null,
        verdict: agent?.verdict ?? 'ready',
        files,
      });
      const pr = await this.adopter().publish(ctx, this.runDir(s), target.repo!, body, undefined, {
        prefix: 'finish',
        commitStep: 'finish.commit',
        title: `${spec.project.name}: ${this.finishTitle(runId, s)}`.slice(0, 120),
        fallbackBranch: committed.branch,
      });
      this.record(runId, 'finish.summary', {
        pr,
        repo: `https://github.com/${target.repo!.owner}/${target.repo!.name}`,
      });
    });
    this.record(runId, 'run.done', {});
  }

  /** The owner's answer to "commit these changes?" (`leave` keeps them uncommitted); resume afterwards. */
  submitCommit(runId: string, a: { action: 'commit' | 'leave'; message?: string }): void {
    const s = this.state(runId);
    if (s.state !== 'PARKED' || s.parked?.state !== 'COMMIT' || s.parked.reason !== 'needs_commit')
      throw new PolicyError(`run ${runId} is not waiting for a commit decision`, {
        code: 'not_waiting',
      });
    this.record(runId, 'finish.approve', {
      action: a.action,
      ...(a.action === 'commit' ? { message: cleanAgentText(a.message ?? '', 4000) ?? '' } : {}),
    });
  }

  /** The owner's answer to "push this branch?"; resume afterwards. */
  submitPush(runId: string, action: 'push' | 'skip'): void {
    const s = this.state(runId);
    if (s.state !== 'PARKED' || s.parked?.state !== 'PUSH' || s.parked.reason !== 'needs_push')
      throw new PolicyError(`run ${runId} is not waiting for a push decision`, {
        code: 'not_waiting',
      });
    this.record(runId, 'finish.push', { action });
  }

  /**
   * Prepares `incubator handoff`: the repository (scaffold-only output, or a fresh clone of the
   * published repo), the agent's headless argv from its probed capabilities, the ceilings and the
   * prompt with the executor plan inlined.
   */
  async prepareHandoff(
    runId: string,
    opts: { agent?: HandoffAgent } = {},
  ): Promise<{ plan: HandoffPlan; prompt: string; ticket: string | null; checks: AgentChecks }> {
    const s = this.state(runId);
    // A folder run codes before it is finished; every other run is handed off once it is done.
    const coding = Boolean(s.input.dir) && (s.state === 'CODE' || s.done);
    if (!s.done && !coding)
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
    let repo = s.input.dir
      ? this.runDir(s)
      : enhance
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
    const checks = this.handoffChecks(runId, repo);
    const external = checks.mode !== 'gate';
    // Approval means nothing if the CLI cannot be held to it.
    if (external && !caps.flags.allowedTools)
      throw new ParkError(
        'checks_unenforceable',
        `${AGENT_ADAPTERS[agent]} cannot restrict which commands an agent runs, so it cannot code in a repository the Incubator did not build`,
      );
    const env =
      external && this.deps.tools ? await toolPathEnv(checks.commands, this.deps.tools) : null;
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(caps, ceilings, external ? externalTools(checks.commands) : undefined),
      cwd: repo,
      planPath,
      ceilings,
      ...(env ? { env } : {}),
      unenforceable: [],
    };
    return {
      plan,
      prompt: handoffPrompt(
        readFileSync(planPath, 'utf8'),
        external ? { checks: checks.commands } : undefined,
      ),
      ticket: activeTicket(repo, spec, delivered?.features.map(ticketId)),
      checks,
    };
  }

  /** `incubator handoff --launch`: runs the agent headless, bounded by the ceilings, logged per run. */
  async launchHandoff(
    runId: string,
    opts: {
      agent?: HandoffAgent;
      onEvent?: (chunk: string) => void;
      onProgress?: (p: HandoffProgress) => void;
    } = {},
  ): Promise<HandoffOutcome> {
    const { plan, prompt, ticket, checks } = await this.prepareHandoff(runId, opts);
    this.record(runId, 'handoff.launch', {
      agent: plan.agent,
      argv: plan.argv,
      ceilings: plan.ceilings,
      ticket,
      checks,
    });
    const outcome = await launchHandoff(this.deps.handoff!.exec, plan, prompt, {
      logFile: path.join(this.deps.store.runDir(runId), 'logs', 'handoff.log'),
      ticket,
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
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
    if (!spec) return null;
    if (this.state(runId).input.kind === 'enhance')
      return (await this.enhancePreview(runId, spec)).preview;
    const adopt = this.state(runId).input.kind === 'adopt';
    return this.#previews.preview(
      spec,
      adopt ? path.join(this.deps.store.runDir(runId), 'workspace', 'repo') : undefined,
    );
  }

  async previewFile(runId: string, filePath: string): Promise<Buffer | null> {
    const spec = this.finalSpec(runId);
    if (!spec) return null;
    if (this.state(runId).input.kind === 'enhance')
      return (await this.enhancePreview(runId, spec)).files.get(filePath)?.bytes ?? null;
    return this.#previews.file(spec, filePath);
  }

  readonly #enhancePreviews = new Map<
    string,
    Promise<{ preview: Preview; files: Map<string, RenderedFile> }>
  >();

  /** The enhance delivery as the REVIEW tree shows it: every file with its delta status. */
  private enhancePreview(runId: string, spec: IncubatorSpec) {
    const key = `${runId}:${specHash(spec)}`;
    let hit = this.#enhancePreviews.get(key);
    if (!hit) {
      hit = (async () => {
        const d = await this.enhanceDelivery(runId, spec, undefined);
        const files = new Map<string, RenderedFile>();
        const status = new Map<string, PreviewStatus>();
        if (d.features.length > 0) {
          for (const [p, f] of d.files) files.set(p, f);
          const delta = planDelta(d.delivery, d.dir);
          for (const k of ['create', 'identical', 'proposed', 'owned'] as const)
            for (const p of delta[k]) status.set(p, k);
          if (this.state(runId).input.withGaps && spec.stack.pack !== OTHER) {
            const gd = planDelta(d.base, d.dir);
            for (const k of ['create', 'identical', 'proposed', 'owned'] as const)
              for (const p of gd[k])
                if (!files.has(p) && d.base.files.has(p)) {
                  files.set(p, d.base.files.get(p)!);
                  status.set(p, k);
                }
          }
        }
        return {
          files,
          preview: {
            specHash: specHash(spec),
            files: [...files.values()]
              .map((f) => ({
                path: f.path,
                bytes: f.bytes.length,
                mode: f.mode,
                pack: f.pack,
                ...(status.has(f.path) ? { status: status.get(f.path)! } : {}),
              }))
              .sort((a, b) => cmp(a.path, b.path)),
          },
        };
      })();
      hit.catch(() => this.#enhancePreviews.delete(key));
      if (this.#enhancePreviews.size >= 8)
        this.#enhancePreviews.delete(this.#enhancePreviews.keys().next().value!);
      this.#enhancePreviews.set(key, hit);
    }
    return hit;
  }

  /** The publish summary recorded for a run, if it got that far. */
  publishSummary(runId: string): PublishSummary | null {
    const e = this.entries(runId).findLast((x) => x.type === 'publish.summary');
    return (e?.['summary'] as PublishSummary | undefined) ?? null;
  }

  private answers(runId: string): { answers: Answer[]; questions: Map<string, AskedInfo> } {
    const answers: Answer[] = [];
    const questions = new Map<string, AskedInfo>();
    for (const e of this.entries(runId)) {
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
      if (e.type === 'questions')
        for (const q of e['questions'] as AskedQuestion[])
          questions.set(q.key, {
            question: q.question,
            labels: Object.fromEntries(q.options.map((o) => [o.value, o.label])),
          });
    }
    return { answers, questions };
  }

  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
  private narrativeFor(runId: string, s: RunState): string {
    return s.input.kind === 'enhance' ? this.requestText(runId) : (s.input.narrative ?? '');
  }

  private async draftStep(runId: string, s: RunState): Promise<void> {
    const adapter = await this.deps.llm.select(
      'discovery',
      s.input.adapter as LlmAdapterId | undefined,
    );
    const enhance = s.input.kind === 'enhance';
    const prompt = loadPrompt(enhance ? 'enhance' : 'discovery');
    const before = this.draft(runId);
    const narrative = this.narrativeFor(runId, s);
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      ...(enhance ? { narrativeHeading: 'Change request', enhance: true } : {}),
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
          ...questionIssues(turn.questions, { enhance }),
          ...attributionIssues(before, turn),
          ...(enhance
            ? [...featureIssues(turn.draftSpec, baseline), ...outsideIntentIssues(before, turn)]
            : otherIssues(turn)),
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
      narrative: this.narrativeFor(runId, s),
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
    const completed = completeSpec(this.draft(runId));
    const { added } = completed;
    let spec = completed.spec;
    if (this.state(runId).input.kind === 'enhance') {
      // Targets come from the scan, never from the model; the owner can edit them at REVIEW.
      const scan = this.readScan(runId);
      const baseline = this.enhanceBaseline(runId);
      spec = {
        ...spec,
        intent: {
          ...spec.intent,
          // why: a malformed feature (not an object with an id) must reach validateSpec and park the run,
          // not crash target resolution.
          coreFeatures: spec.intent.coreFeatures.map((f) =>
            typeof f !== 'object' ||
            f === null ||
            typeof f.id !== 'string' ||
            baseline.includes(f.id) ||
            f.targets
              ? f
              : { ...f, targets: resolveTargets(scan, f) },
          ),
        },
      };
    }
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
          case 'CODE':
            await this.codeStep(runId, s);
            break;
          case 'COMMIT':
            await this.commitStep(runId, s);
            break;
          case 'PUSH':
            await this.pushStep(runId, s);
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
      // why: without a journal entry a failed run reads as still in progress after a restart,
      // and the web UI offers no way to resume it.
      else
        this.record(runId, 'failed', { state: this.state(runId).state, message: formatError(err) });
      throw err;
    }
  }

  /** Re-enters a parked, interrupted or failed run from its journal. */
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
    else if (s.failure) this.record(runId, 'resume', { to: s.state, from: 'failed', ...overrides });
    if (overrides.adapter) this.record(runId, 'input.override', { adapter: overrides.adapter });
    return this.advance(runId, prompter);
  }
}
