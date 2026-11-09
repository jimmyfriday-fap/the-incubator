import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import type { GitOps, RepoRef } from '@incubator/git';
import {
  BACKSHACK_STACK,
  DEFAULT_RUN_CEILINGS,
  ENHANCEMENT_SPEC_VERSION,
  LEANTIME_FALLBACK,
  OTHER,
  completeSpec,
  discoveryTurnWireSchema,
  specHash,
  stackById,
  validateSemantics,
  validateSpec,
  withReachableTracker,
  type DiscoveryTurn,
  type IncubatorSpec,
  type StackEntry,
} from '@incubator/spec';
import {
  attributionIssues,
  deployClassIssues,
  mergeTurn,
  otherIssues,
  supersededAnswers,
  withoutTargets,
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
  MAX_CODE_PARTS,
  partMessage,
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
import type { IncubatorConfig } from './config.js';
import {
  MARKER_PATH,
  markerText,
  readMarker,
  type Portfolio,
  type PortfolioProject,
  type PortfolioRun,
  type MemoryRecord,
  type MemorySystem,
} from './portfolio.js';
import { planReverseOut, type LeftBehind, type ReversePlan } from './reverse-out.js';
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
import type { InstallRun } from './verify.js';
import {
  MEMORY_OFFER,
  readGettingStarted,
  readTickets,
  WHAT_NOW_FILE,
  whatNow,
  whatNowMarkdown,
  type WhatNow,
} from './what-now.js';
import { standUp, type StandUp, type StandUpFacts } from './standup.js';
import { DESIGN_FILE, STAND_UP_FILE, designMarkdown } from './design-doc.js';
import {
  addressInUse,
  appRunSteps,
  appUrl,
  projectContainersUp,
  runAppSteps,
  waitForUrl,
} from './app-run.js';
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
  numberedAhead,
  numberedMax,
  outsideIntentIssues,
  partStep,
  renderPrBody,
  resolveTargets,
  REQUEST_MAX,
  sanitizeRequest,
  ticketId,
  type EnhancePlanRecord,
  type FolderUpstream,
} from './enhance.js';
import {
  AGENT_ADAPTERS,
  activeTicket,
  buildHandoffArgv,
  continuationText,
  handoffPrompt,
  launchHandoff,
  remainingTickets,
  type HandoffAgent,
  type HandoffOutcome,
  type HandoffProgress,
  cleanAgentText,
  type HandoffPlan,
  type CodePart,
} from './handoff.js';
import { CHECK_NOT_RUN, checkBudgetMs, runChecks, type CheckRun } from './check-run.js';
import {
  RECOMMENDATION_FILE,
  backshackFit,
  backshackPaths,
  backshackWorktree,
  createBackshackWorktree,
  readBackshackContract,
  recommendationYaml,
  requireBackshackPaths,
  type BackshackDecision,
  type BackshackFit,
  type BackshackPaths,
} from './backshack.js';
import {
  MEMORY_ALLOWED_TOOLS,
  MEMORY_AVAILABLE_TOOLS,
  MEMORY_BRANCH,
  MEMORY_DEFAULT_EFFORT,
  MEMORY_DEFAULT_MODEL,
  REPO_STORE,
  allowedMemoryPath,
  checkMemoryInput,
  checkTerms,
  copySeed,
  installedPolicy,
  kebab,
  memoryBuildLine,
  memoryBuildPrompt,
  memoryConsumptionLine,
  memoryPrompt,
  parseMemoryReport,
  prefillIsolationTerms,
  seedVersion,
  MEMORY_BUILD_ALLOWED_TOOLS,
  allowedMemberPath,
  manifestMembers,
  memoryStoreAllowedTools,
  memoryMemberPrompt,
  proposeMemberManifest,
  type MemberFacts,
  type MemoryMemberPhase,
  memoryStoreFor,
  memoryStorePrompt,
  parseProposedManifest,
  type BuildMemoryFacts,
  type MemoryStoreDone,
  type MemoryBuildPhase,
  type MemoryDetail,
  type MemoryDone,
  type MemoryRunInput,
} from './memory.js';
import {
  checksReport,
  installMemoryProtected,
  installMemorySystemProtected,
  type InstallCheck,
} from './memory-install.js';
import { resolveMemoryDestination, type MemoryPlan } from './memory-destination.js';

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
  /** The live configuration (Settings, ADR-029): read when a run needs it, so a saved change applies to the next run. */
  config?: () => IncubatorConfig;
  /** GitHub, git and verification; required to go past SCAFFOLD into VERIFY/PUBLISH. */
  publish?: PublishDeps;
  /** Handoff: probes an agent CLI and runs processes. */
  handoff?: {
    exec: Exec;
    probe(adapter: LlmAdapterId): Promise<Capabilities>;
    /** Plan 056: installs a built repository's dependencies before the agent codes. Absent in tests that need none. */
    // why: a property, not a method signature, so the engine can read it off the object (unbound-method).
    install?: (dir: string, signal?: AbortSignal) => Promise<InstallRun[]>;
    /** Plan 064: true when a started project answers at an address. Absent: the address is never asked. */
    ping?: (url: string) => Promise<boolean>;
  };
  /** Retrieved stacks (ADR-027): finds and runs a stack's own generator. */
  tools?: ToolsDeps;
  /** The portfolio of projects the Incubator has worked on (ADR-028). */
  portfolio?: Portfolio;
  /** Add memory: run the playbook's verification steps 4 to 6 after the install (default true). Only tests turn it off. */
  memorySelfTests?: boolean;
}

/** The journal entries that change what the portfolio shows about a run or its project. */
const PORTFOLIO_EVENTS = new Set([
  'state.enter',
  'park',
  'failed',
  'run.done',
  'enhance.request',
  'step.ok',
  'finish.summary',
  'spec.revision',
  'interrupted',
  'run.cancel',
  'memory.installed',
]);

/** Who asked the work to stop: the owner in the UI, a signal (Ctrl+C), or the app shutting down. */
export type StopBy = 'owner' | 'signal' | 'shutdown';

/** Where an update run's repository stands against the commit the run read (plan 025). */
export interface RepoMove {
  /** The repository has new commits (or another branch is checked out) since the run read it. */
  moved: boolean;
  /** The commit the run read, or null when it has not read one yet. */
  recorded: string | null;
  /** The commit there now, or null when it could not be read. */
  current: string | null;
  /** The branch there now (the default branch for a GitHub repository). */
  branch: string | null;
  /** How many commits are new; null when they cannot be counted (a GitHub repository). */
  commits: number | null;
}

/** The states in which an update run is still planning, so a refresh can still change the plan (plan 025). */
const PLANNING_STATES: readonly RunStateName[] = [
  'INTAKE',
  'ANALYZE',
  'REQUEST',
  'DRAFT_SPEC',
  'CLARIFY',
  'REVIEW',
  'APPROVED',
];

/** One tool and model that did one kind of work in a run. */
export interface ModelUse {
  job: 'planning' | 'analysis' | 'review-summary' | 'coding';
  tool: string;
  model: string | null;
  calls: number;
  costUsd: number | null;
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

/** Plan 064: where a finished project's local start stands. */
export interface AppStatus {
  state: 'down' | 'starting' | 'up' | 'failed';
  /** The address to open, only while it is up. */
  url: string | null;
  /** False for a stack with nothing to start (a library). */
  available: boolean;
  steps: { title: string; ok: boolean; tail: string }[];
}

export class Engine {
  readonly #listeners = new Set<(e: RunEvent) => void>();
  constructor(private readonly deps: EngineDeps) {
    if (deps.portfolio) this.on((e) => this.syncPortfolio(e));
  }

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
    if (input.stack === BACKSHACK_STACK) this.checkBackshackInput(input);
    if (input.kind === 'memory') {
      if (!input.dir || !input.memory)
        throw new PolicyError('an Add memory run needs a folder and its memory choices', {
          code: 'bad_memory_input',
        });
      input = { ...input, memory: checkMemoryInput(input.memory) };
      if (input.memory?.joinSystem && !this.knownMemorySystems().includes(input.memory.joinSystem))
        throw new PolicyError(
          `no memory store is known for the system "${input.memory.joinSystem}"`,
          {
            code: 'unknown_memory_system',
          },
        );
    }
    // Plan 074: a new build with a folder decides where its memory lives before any code is generated.
    const memoryPlan = resolveMemoryDestination(input, this.knownMemorySystems());
    const { runId } = this.deps.store.create(input, { incubator: INCUBATOR_VERSION });
    this.record(runId, 'run.start', { runId, input });
    if (memoryPlan) this.record(runId, 'memory.plan', { plan: memoryPlan });
    if (input.backshack) {
      // ADR-030: the owner's approval of the Backshack target, durable in the run folder and the journal.
      writeFileSync(
        path.join(this.deps.store.runDir(runId), RECOMMENDATION_FILE),
        recommendationYaml(input.backshack),
      );
      this.record(runId, 'stack.approved', { stack: BACKSHACK_STACK, decision: input.backshack });
    }
    this.enter(runId, 'INTAKE');
    this.writeRevision(runId, { intent: { narrative: input.narrative ?? '' }, decisions: [] });
    return runId;
  }

  /** The systems whose memory store a new repository can join: those the portfolio knows, with a store on disk. */
  private knownMemorySystems(): string[] {
    return (this.deps.portfolio?.systems() ?? [])
      .filter((x) => existsSync(x.store))
      .map((x) => x.name);
  }

  /** The systems the portfolio knows, for the Add memory and new-build forms (plan 076). */
  memorySystems(): MemorySystem[] {
    return this.deps.portfolio?.systems() ?? [];
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

  /**
   * The owner's change request: a submitted one wins over the one given at start. After a refresh (plan 025)
   * only a request submitted since counts; until there is one it is empty and the run asks again.
   */
  requestText(runId: string): string {
    const cut = this.since(runId);
    const submitted = this.entries(runId).findLast(
      (e) => e.type === 'enhance.request' && e.seq > cut,
    );
    const given = cut > 0 ? '' : (this.state(runId).input.request ?? '');
    return sanitizeRequest(
      typeof submitted?.['text'] === 'string' ? submitted['text'] : given,
      REQUEST_MAX,
    );
  }

  /** The seq of the latest repository refresh (plan 025), or 0: what the owner said before it is asked again. */
  private since(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'repo.refresh')?.seq ?? 0;
  }

  /** The seq of the latest "continue coding" (plan 037), or 0: the owner's commit and push answers before it are spent. */
  private continuedAt(runId: string): number {
    return this.entries(runId).findLast((e) => e.type === 'code.continue')?.seq ?? 0;
  }

  /** The commit a continued run started from, and why its earlier coding stopped (plan 037), or null. */
  private continuedFrom(
    runId: string,
  ): { sha: string; since: string | null; tripped: string | null } | null {
    const e = this.entries(runId).findLast((x) => x.type === 'code.continue');
    if (!e || typeof e['from'] !== 'string') return null;
    return {
      sha: e['from'],
      since: typeof e['since'] === 'string' ? e['since'] : null,
      tripped: typeof e['tripped'] === 'string' ? e['tripped'] : null,
    };
  }

  /** After a refresh (plan 025): the earlier request, with the corrections given at review, to confirm or edit. */
  previousRequest(runId: string): string | null {
    const e = this.entries(runId).findLast((x) => x.type === 'repo.refresh');
    return typeof e?.['previous'] === 'string' && e['previous'] ? e['previous'] : null;
  }

  /** Check commands proposed at the scan: built-in constants chosen by the repository's manifests. */
  proposedChecks(runId: string): CheckProposal[] {
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.scan');
    // why: runs journaled before `what` existed carry only the command and the reason.
    return ((e?.['checks'] as Partial<CheckProposal>[] | undefined) ?? []).map((c) => ({
      command: c.command ?? '',
      what: c.what ?? whatItDoes(c.command ?? ''),
      why: c.why ?? '',
    }));
  }

  /** What the owner approved: a list (possibly empty), or null while they have not decided. */
  approvedChecks(runId: string): string[] | null {
    // why: commands approved before a refresh (plan 025) were chosen for the old snapshot: ask again.
    const cut = this.since(runId);
    const e = this.entries(runId).findLast((x) => x.type === 'enhance.checks' && x.seq > cut);
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
    const clean = sanitizeRequest(text, REQUEST_MAX);
    if (!clean)
      throw new PolicyError('describe what you want to change', { code: 'empty_request' });
    this.record(runId, 'enhance.request', { text: clean });
  }

  /** ANALYZE (enhance): acquire a copy, scan the whole repository, draft from the detectors, then REQUEST. */
  private async enhanceAnalyzeStep(runId: string, s: RunState): Promise<void> {
    await this.effect(runId, async () => {
      // ADR-030: a Backshack tool is never planned without its contract.
      this.backshackContract(s);
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
          timeoutMs: this.llmTimeout(),
          ...this.sig(runId),
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
    if (!this.requestText(runId)) {
      const previous = this.previousRequest(runId);
      // why: after a refresh (plan 025) the owner confirms or edits what they asked for before.
      if (previous)
        throw new ParkError(
          'needs_request',
          'the repository was read again: confirm what you want to change, or edit it',
          { previous },
        );
      throw new ParkError(
        'needs_request',
        'describe what you want to change (incubator enhance --prompt, or the "What do you want to change?" step)',
      );
    }
    const cut = this.since(runId);
    // why: after a refresh (plan 026) the owner confirms or changes their earlier answers before the draft.
    if (cut > 0 && !this.entries(runId).some((e) => e.type === 'questions' && e.seq > cut)) {
      const carried = this.carriedQuestions(runId);
      if (carried.length) {
        this.record(runId, 'questions', { round: 0, carried: true, questions: carried });
        this.enter(runId, 'CLARIFY', 0);
        return;
      }
    }
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
    // Plan 049: a folder run also numbers past the plans its default branch already has.
    const upstream =
      (
        this.state(runId).steps['folder.base']?.data as
          { upstream?: FolderUpstream | null } | undefined
      )?.upstream ?? null;
    const planPath =
      prior?.planPath ??
      sameDay ??
      `docs/plans/${nextPlanNumber([...repoFiles, ...(upstream?.plans ?? [])])}-enhance-${date}.md`;
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
      numbered: upstream ? { ref: upstream.ref, ahead: upstream.ahead } : null,
      // No Incubator gate in the repository, and none arriving with this delivery.
      external:
        !isCanonicalRepo(dir) &&
        !(this.state(runId).input.withGaps === true && spec.stack.pack !== OTHER),
    });
    // The project's marker travels with the plan, so the repository is recognised next time (ADR-028).
    const marker = this.markerFor(runId);
    if (marker) files.set(marker.path, marker);
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

  // --- stop and cancel (ADR-029) -----------------------------------------------------------------

  /** The work under way for each run: one controller per `advance`, and who asked it to stop. */
  readonly #active = new Map<string, { controller: AbortController; by: StopBy | null }>();
  /** Model calls made outside the run's own task (the review summary), so a stop reaches them too. */
  readonly #background = new Map<string, Set<AbortController>>();

  /** The signal of the work under way for a run, for the calls that can be cancelled. */
  private sig(runId: string): { signal?: AbortSignal } {
    const a = this.#active.get(runId);
    return a ? { signal: a.controller.signal } : {};
  }

  private throwIfStopped(runId: string): void {
    if (this.#active.get(runId)?.controller.signal.aborted)
      throw new InterruptedError(`run ${runId} was stopped`);
  }

  /** The runs that have work under way right now. */
  activeRuns(): string[] {
    return [...this.#active.keys()];
  }

  /**
   * Stops whatever the run is doing: the model call or coding agent is killed, and the run ends the step at
   * its next boundary (a scan cannot be cut short). Returns false when nothing was running. The run stays
   * resumable.
   */
  abortRun(runId: string, by: StopBy = 'owner'): boolean {
    const bg = this.#background.get(runId);
    for (const c of bg ?? []) c.abort();
    const a = this.#active.get(runId);
    if (!a) return Boolean(bg?.size);
    a.by ??= by;
    a.controller.abort();
    return true;
  }

  /** Stops every run that is working (Ctrl+C in the terminal, closing the window). */
  abortAll(by: StopBy): string[] {
    const stopped = [...new Set([...this.#active.keys(), ...this.#background.keys()])].filter(
      (id) => this.abortRun(id, by),
    );
    return stopped;
  }

  /**
   * Abandons a run for good: it ends as cancelled and cannot be resumed. It never touches the owner's files;
   * whatever the coding agent already wrote stays where it is. A run that is working must be stopped first.
   */
  cancel(runId: string, reason?: string): void {
    const s = this.state(runId);
    if (s.done)
      throw new PolicyError(`run ${runId} is already ${s.cancelled ? 'cancelled' : 'finished'}`, {
        code: 'not_cancellable',
      });
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working: stop it first`, { code: 'working' });
    this.record(runId, 'run.cancel', reason ? { reason: cleanAgentText(reason, 200) } : {});
  }

  // --- reversing out (plan 069) -----------------------------------------------------------------

  /** What reversing out would remove and what it would leave, from the run's record and the folder as it is now. */
  async reverseOutPreview(runId: string): Promise<ReversePlan> {
    const s = this.state(runId);
    const git = this.deps.publish?.git;
    const dir = s.input.dir ? path.resolve(s.input.dir) : null;
    let backshack: { repo: string; dir: string } | null = null;
    if (this.isBackshack(s) && s.input.backshack) {
      const paths = this.backshackPaths();
      const wt = backshackWorktree(paths, s.input.backshack.fit.toolSlug);
      // why: only the worktree this tool's name maps to is ever removed, never a path the record names.
      if (dir && path.resolve(wt.dir) === dir) backshack = { repo: paths.devRepo, dir };
    }
    const here = dir && existsSync(dir) && git ? dir : null;
    return planReverseOut({
      state: s,
      working: this.#active.has(runId),
      runFolder: this.deps.store.runDir(runId),
      dir,
      currentBranch: here && git ? await git.currentBranch(here) : null,
      dirtyCount: here && git ? (await git.status(here)).length : 0,
      backshack,
    });
  }

  /**
   * Undoes a run that did not finish: its branch in the owner's folder (or its Backshack worktree), its folder
   * under the Incubator home and its place in the portfolio. Never deletes through a shell, never discards the
   * owner's uncommitted work, and only names what the run left on GitHub.
   */
  async reverseOut(
    runId: string,
    opts: { confirmDirtyWorktree?: boolean } = {},
  ): Promise<{ removed: string[]; leftBehind: LeftBehind[] }> {
    const plan = await this.reverseOutPreview(runId);
    if (!plan.allowed) throw new PolicyError(plan.refusal!.message, { code: plan.refusal!.code });
    if (plan.needsConfirm && !opts.confirmDirtyWorktree)
      throw new PolicyError('the worktree has uncommitted files: confirm to remove it anyway', {
        code: 'confirm_dirty_worktree',
      });
    const git = this.deps.publish?.git;
    const removed: string[] = [];
    for (const a of plan.actions) {
      switch (a.kind) {
        case 'remove-worktree':
          if (existsSync(a.dir)) await git!.worktreeRemove(a.repo, a.dir, a.dirtyCount > 0);
          removed.push(`the worktree ${a.dir}`);
          break;
        case 'delete-branch':
          if (a.returnTo) await git!.checkout(a.dir, a.returnTo);
          if (await git!.deleteBranch(a.dir, a.branch)) removed.push(`the branch ${a.branch}`);
          break;
        case 'remove-run-folder':
          this.deps.store.remove(runId);
          removed.push('the run and its working copy');
          break;
      }
    }
    this.deps.portfolio?.detachRun(runId);
    return { removed, leftBehind: plan.leftBehind };
  }

  // --- settings and models (ADR-029) -------------------------------------------------------------

  private cfg(): IncubatorConfig {
    return this.deps.config?.() ?? {};
  }

  private llmTimeout(): number {
    return this.cfg().discovery?.timeoutMs ?? this.deps.llmTimeoutMs ?? 180_000;
  }

  /** The tool settings with the owner's current `toolPaths`. */
  private tools(): ToolsDeps | undefined {
    const t = this.deps.tools;
    const paths = this.cfg().toolPaths;
    return t && paths ? { ...t, toolPaths: paths } : t;
  }

  /**
   * Which tool and model did each job of a run, from the journal: planning (questions), analysis, the review
   * summary and coding. A model is `null` when the tool did not say.
   */
  models(runId: string): ModelUse[] {
    const out = new Map<string, ModelUse>();
    const add = (job: ModelUse['job'], tool: string, model: string | null, cost: number | null) => {
      const key = `${job}|${tool}|${model ?? ''}`;
      const m = out.get(key) ?? { job, tool, model, calls: 0, costUsd: null };
      m.calls++;
      if (cost !== null) m.costUsd = (m.costUsd ?? 0) + cost;
      out.set(key, m);
    };
    let launched: { agent: string; model: string | null } | null = null;
    for (const e of this.entries(runId)) {
      const x = e as Record<string, unknown>;
      if (e.type === 'llm.turn' && typeof x['adapter'] === 'string') {
        const purpose = x['purpose'];
        add(
          purpose === 'analysis'
            ? 'analysis'
            : purpose === 'review-summary'
              ? 'review-summary'
              : 'planning',
          x['adapter'],
          typeof x['model'] === 'string' ? x['model'] : null,
          typeof x['costUsd'] === 'number' ? x['costUsd'] : null,
        );
      } else if (e.type === 'handoff.launch' && typeof x['agent'] === 'string') {
        launched = { agent: x['agent'], model: typeof x['model'] === 'string' ? x['model'] : null };
      } else if (e.type === 'handoff.result' && launched) {
        add(
          'coding',
          launched.agent,
          typeof x['model'] === 'string' ? x['model'] : launched.model,
          typeof x['costUsd'] === 'number' ? x['costUsd'] : null,
        );
        launched = null;
      }
    }
    return [...out.values()];
  }

  // --- portfolio (ADR-028) -----------------------------------------------------------------------

  /** Every project the Incubator has worked on, most recently touched first. */
  portfolioList(): PortfolioProject[] {
    return this.deps.portfolio?.list() ?? [];
  }

  portfolioGet(id: string): PortfolioProject | undefined {
    return this.deps.portfolio?.get(id);
  }

  /** The project a run belongs to. */
  portfolioForRun(runId: string): PortfolioProject | undefined {
    return this.deps.portfolio?.forRun(runId);
  }

  /** The project a folder is, by its marker, its git remote or its path (for the wizard and a new run). */
  async portfolioFor(dir: string): Promise<PortfolioProject | undefined> {
    const pf = this.deps.portfolio;
    if (!pf || !path.isAbsolute(dir)) return undefined;
    return pf.match({
      markerId: readMarker(dir),
      remote: await this.remoteOf(dir),
      dir,
    });
  }

  private async remoteOf(dir: string): Promise<string | null> {
    try {
      return existsSync(path.join(dir, '.git'))
        ? ((await this.deps.publish?.git.remoteGetUrl(dir)) ?? null)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Puts a run under a project: the one its folder already is (marker, remote, path), or a new one. Best
   * effort: the portfolio is a record, never a reason for a run to fail.
   */
  private async linkPortfolio(runId: string): Promise<void> {
    const pf = this.deps.portfolio;
    if (!pf || pf.forRun(runId)) return;
    try {
      const s = this.state(runId);
      const input = s.input;
      const dir =
        input.dir ??
        (input.repo && path.isAbsolute(input.repo) && existsSync(input.repo) ? input.repo : null);
      const ref = input.repoRef ?? null;
      const remote =
        (dir ? await this.remoteOf(dir) : null) ??
        (ref ? `https://github.com/${ref.owner}/${ref.name}` : null);
      let project = pf.match({ markerId: dir ? readMarker(dir) : null, remote, dir });
      if (!project) {
        const base = dir ? path.basename(dir) : (ref?.name ?? '');
        project = pf.create({
          name: base || 'New project',
          summary: input.kind === 'new' ? sanitizeRequest(input.narrative ?? '', 240) : '',
          origin:
            input.kind === 'new' ? 'created' : input.kind === 'adopt' ? 'adopted' : 'existing',
          repo: {
            dir,
            remote,
            ref,
            url: ref ? `https://github.com/${ref.owner}/${ref.name}` : null,
          },
          stack: null,
        });
      }
      const plan = this.entries(runId).find((en) => en.type === 'memory.plan') as
        { plan?: MemoryPlan; ts?: string } | undefined;
      pf.attachRun(project.id, {
        runId,
        kind: input.kind,
        request: this.portfolioRequest(runId),
        startedAt: this.entries(runId)[0]?.ts ?? this.deps.clock.now().toISOString(),
        state: s.state,
        done: s.done,
        outcome: null,
      });
      if (plan?.plan)
        pf.update(project.id, (p) => {
          p.memoryPlan = {
            ...plan.plan!,
            decidedAt: plan.ts ?? this.deps.clock.now().toISOString(),
          };
        });
    } catch (e) {
      this.deps.log.warn(
        `portfolio: could not link run ${runId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private portfolioRequest(runId: string): string | null {
    const s = this.state(runId);
    if (s.input.kind === 'memory') return `Add memory (${s.input.memory?.system ?? 'repo'})`;
    const text = s.input.kind === 'enhance' ? this.requestText(runId) : (s.input.narrative ?? '');
    return text ? sanitizeRequest(text, 600) : null;
  }

  /** Keeps the portfolio in step with a run from the journal entries it writes. Never throws. */
  private syncPortfolio(e: RunEvent): void {
    const pf = this.deps.portfolio;
    if (!pf) return;
    const t = e.entry.type;
    if (!PORTFOLIO_EVENTS.has(t)) return;
    try {
      const project = pf.forRun(e.runId);
      if (!project) return;
      const run = (p: PortfolioProject): PortfolioRun | undefined =>
        p.runs.find((r) => r.runId === e.runId);
      const x = e.entry as Record<string, unknown>;
      pf.update(project.id, (p) => {
        const r = run(p);
        if (!r) return;
        switch (t) {
          case 'state.enter':
            r.state = String(x['state']);
            break;
          case 'park':
            r.state = 'PARKED';
            break;
          case 'failed':
            r.state = 'FAILED';
            break;
          case 'interrupted':
            r.state = 'STOPPED';
            break;
          case 'run.cancel':
            r.state = 'CANCELLED';
            r.done = true;
            break;
          case 'run.done':
            r.state = 'DONE';
            r.done = true;
            if (typeof x['local'] === 'string')
              r.outcome = { ...(r.outcome ?? {}), local: x['local'] };
            break;
          case 'enhance.request':
            r.request = typeof x['text'] === 'string' ? sanitizeRequest(x['text'], 600) : r.request;
            break;
          case 'step.ok': {
            const data = (x['data'] ?? {}) as { sha?: string | null; branch?: string };
            if (x['step'] === 'finish.commit' && data.sha)
              r.outcome = {
                ...(r.outcome ?? {}),
                commit: data.sha,
                ...(data.branch ? { branch: data.branch } : {}),
              };
            if (x['step'] === 'enhance.summary' && !p.summary)
              p.summary = this.analysisSummaryLine(e.runId);
            break;
          }
          case 'finish.summary': {
            const pr = x['pr'] as { number: number; url: string } | undefined;
            if (pr) r.outcome = { ...(r.outcome ?? {}), pr };
            if (typeof x['repo'] === 'string') p.repo.url = x['repo'];
            break;
          }
          case 'spec.revision':
            if (x['final'] === true) this.portfolioFromSpec(e.runId, p);
            break;
          case 'memory.installed':
            p.memory = x['record'] as NonNullable<PortfolioProject['memory']>;
            break;
        }
      });
    } catch (err) {
      this.deps.log.warn(
        `portfolio: could not record ${t}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** The name, summary and stack the complete spec gives a project this run made; a stack label for an update. */
  private portfolioFromSpec(runId: string, p: PortfolioProject): void {
    const spec = this.finalSpec(runId);
    if (!spec) return;
    const kind = this.state(runId).input.kind;
    if (kind === 'new') {
      p.name = spec.project.name;
      p.summary = sanitizeRequest(spec.project.description || spec.intent.narrative, 240);
      p.stack = stackById(spec.stack.pack)?.label ?? spec.stack.pack;
    } else if (!p.stack) {
      p.stack = this.detectedStack(runId)?.label ?? stackById(spec.stack.pack)?.label ?? null;
    }
  }

  /** The first paragraph of the model's analysis summary ("what this repository is"), one line. */
  private analysisSummaryLine(runId: string): string {
    const file = this.enhanceFile(runId, 'analysis-summary.md');
    if (!existsSync(file)) return '';
    const m = /## What this repository is\s+([\s\S]*?)(?:\n## |$)/.exec(readFileSync(file, 'utf8'));
    return m ? sanitizeRequest(m[1]!, 240) : '';
  }

  /**
   * First use: builds the portfolio from the runs already on disk, so earlier work appears at once. Runs
   * are replayed oldest first through the same code that follows a live run.
   */
  async portfolioBackfill(): Promise<void> {
    const pf = this.deps.portfolio;
    if (!pf || pf.exists()) return;
    for (const runId of this.deps.store.list()) {
      try {
        await this.linkPortfolio(runId);
        for (const entry of this.entries(runId)) this.syncPortfolio({ runId, entry });
      } catch {
        // a run that cannot be read is skipped
      }
    }
  }

  /** The marker file a project's repository carries, as a delivered file. */
  private markerFor(runId: string): RenderedFile | null {
    const project = this.deps.portfolio?.forRun(runId);
    if (!project) return null;
    return {
      path: MARKER_PATH,
      bytes: Buffer.from(markerText(project)),
      mode: '0644',
      pack: 'incubator',
    };
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
          timeoutMs: this.llmTimeout(),
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
    return probeStack(this.retrievedStack(id), this.tools()!);
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
      ...this.tools()!,
      git: publish.git,
      ...(publish.identity ? { identity: () => publish.identity!() } : {}),
    });
  }

  // --- the Backshack tool stack (ADR-030) ---------------------------------------------------------

  private backshackPaths(): BackshackPaths {
    return requireBackshackPaths(this.cfg(), this.deps.store.home);
  }

  /** Is everything a Backshack build needs configured and present? Changes nothing. */
  backshackProbe():
    | { ok: true; stack: string; devRepo: string; contract: string; worktreeRoot: string }
    | { ok: false; stack: string; problems: string[] } {
    const p = backshackPaths(this.cfg(), this.deps.store.home);
    if (!p.ok) return { ok: false, stack: BACKSHACK_STACK, problems: p.problems };
    try {
      readBackshackContract(p.paths);
    } catch (e) {
      return { ok: false, stack: BACKSHACK_STACK, problems: [(e as Error).message] };
    }
    return { ok: true, stack: BACKSHACK_STACK, ...p.paths };
  }

  /**
   * The owner approved the Backshack target: check the contract is there, create the backshack-dev worktree on
   * the tool's branch, and return the input of the run that builds the tool in it. Committed only: the run never
   * creates a repository, adds canonical files, pushes or opens a pull request.
   */
  async backshackPrepare(input: {
    narrative: string;
    fit: Partial<Record<keyof BackshackFit, unknown>>;
    rationale?: readonly string[];
    surface: RunInput['surface'];
  }): Promise<{ input: RunInput; dir: string; branch: string }> {
    const git = this.deps.publish?.git;
    if (!git) throw new PolicyError('this build cannot run git', { code: 'no_git' });
    const request = sanitizeRequest(input.narrative);
    if (!request) throw new PolicyError('describe the tool first', { code: 'empty_request' });
    const fit = backshackFit(input.fit);
    const paths = this.backshackPaths();
    readBackshackContract(paths);
    const decision: BackshackDecision = {
      target: 'backshack',
      rationale: (input.rationale ?? [])
        .map((r) => cleanAgentText(r, 300) ?? '')
        .filter(Boolean)
        .slice(0, 3),
      fit,
      decidedAt: this.deps.clock.now().toISOString(),
    };
    const wt = await createBackshackWorktree(git, paths, fit.toolSlug);
    return {
      dir: wt.dir,
      branch: wt.branch,
      input: {
        kind: 'enhance',
        repo: wt.dir,
        dir: wt.dir,
        request,
        noPublish: true,
        stack: BACKSHACK_STACK,
        backshack: decision,
        surface: input.surface,
      },
    };
  }

  /** A Backshack run works only in its own worktree, carries the owner's decision, and is never published. */
  private checkBackshackInput(input: RunInput): void {
    const fail = (why: string): never => {
      throw new PolicyError(`not a Backshack tool run: ${why}`, { code: 'bad_backshack_run' });
    };
    if (input.kind !== 'enhance') fail('it must be an update run');
    if (!input.backshack) fail('the owner’s decision is missing');
    if (input.noPublish !== true || input.withGaps)
      fail('it must be committed only, with no canonical files');
    const { dir } = backshackWorktree(this.backshackPaths(), input.backshack!.fit.toolSlug);
    if (!input.dir || path.resolve(input.dir) !== dir) fail(`it must work in ${dir}`);
  }

  private isBackshack(s: RunState): boolean {
    return s.input.stack === BACKSHACK_STACK;
  }

  /** The contract, verbatim, for a Backshack run (parks when the file is missing); null for any other run. */
  private backshackContract(s: RunState): string | null {
    return this.isBackshack(s) ? readBackshackContract(this.backshackPaths()) : null;
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
      // why: the summary is written outside the run's own task, so Stop must be able to reach it too.
      const stop = new AbortController();
      const background = this.#background.get(runId) ?? new Set<AbortController>();
      background.add(stop);
      this.#background.set(runId, background);
      cell.promise = this.writeReviewSummary(runId, s, spec, hash, file, stop.signal)
        .catch((e: unknown) => {
          if (e instanceof InterruptedError) return;
          const message = (e instanceof Error ? e.message : String(e)).slice(0, 300);
          cell.failed = message;
          this.record(runId, 'step.warn', { step: 'review.summary', data: { reason: message } });
        })
        .finally(() => {
          cell.promise = undefined;
          background.delete(stop);
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
    signal: AbortSignal,
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
          corrections: this.reviewFeedback(runId),
        }),
        promptVersion: prompt.version,
        timeoutMs: this.llmTimeout(),
        signal,
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
    const found = await inspectFolder(this.deps.publish.git, folder, purpose);
    const v =
      purpose === 'existing' && found.path && found.exists
        ? {
            ...found,
            memoryPresent:
              existsSync(path.join(found.path, '.memory')) ||
              existsSync(path.join(found.path, '.memory-link')),
          }
        : found;
    if (!this.deps.portfolio || purpose !== 'existing' || !v.path) return v;
    const project = await this.portfolioFor(v.path);
    return { ...v, project: project ? { id: project.id, name: project.name } : null };
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
    // Plan 049: what the folder's default branch holds as of its last fetch (nothing is fetched), so the
    // plan and the agent's new numbered files are numbered past it.
    const up = await git.upstreamFiles(this.runDir(s));
    const upstream: FolderUpstream | null = up
      ? {
          ref: up.ref,
          // why: both lists come from git; the scan's file view skips vendor/ and build/ and stops at 5,000 files.
          ahead: numberedAhead(numberedMax(up.head), numberedMax(up.files)),
          plans: up.files.filter((f) => /^docs\/plans\/\d{3}-/.test(f)),
        }
      : null;
    this.record(runId, 'step.ok', {
      step: 'folder.base',
      data: { head: v.git!.head, branch: v.git!.branch, origin: v.git!.origin, upstream },
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
    const part = s.steps[partStep('enhance')]?.data as
      { branch?: string; sha?: string } | undefined;
    const branch = part?.branch;
    if (!branch) throw new ToolError('the enhance branch was not recorded');
    if (this.isBackshack(s)) return this.deliverBackshack(runId, dir, base, branch, part.sha);
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

  /**
   * ADR-030: the plan commit moves the worktree's own branch forward (`incubator/backshack-<slug>`), so the tool
   * is built on the branch the owner approved and no other branch is left in backshack-dev.
   */
  private async deliverBackshack(
    runId: string,
    dir: string,
    base: { head: string; branch: string },
    planBranch: string,
    planSha: string | undefined,
  ): Promise<void> {
    const git = this.deps.publish!.git;
    const head = await git.headSha(dir);
    if (head !== planSha) {
      const status = await git.status(dir);
      if (status.length || (await git.currentBranch(dir)) !== base.branch || head !== base.head)
        throw new ParkError(
          'folder_changed',
          'the Backshack worktree changed while the plan was being prepared; put it back on its branch with no changes, and resume',
          { expected: base, changed: status.slice(0, 8).map((e) => e.path) },
        );
      await git.fetch(
        dir,
        path.join(this.deps.store.runDir(runId), 'workspace', 'repo'),
        `refs/heads/${planBranch}`,
      );
      await git.fastForward(dir, 'FETCH_HEAD');
    }
    ensureLocalExclude(dir);
    this.record(runId, 'step.ok', {
      step: 'deliver',
      data: { branch: base.branch, from: base.branch },
    });
  }

  private async codeStep(runId: string, s: RunState): Promise<void> {
    if (s.steps['code.done']?.status === 'ok') return this.enter(runId, 'COMMIT');
    const dir = this.runDir(s);
    const git = this.deps.publish!.git;
    await this.effect(runId, async () => {
      if (s.steps['code.start']?.status !== 'ok') {
        let branch = await git.currentBranch(dir);
        // A continued run (plan 037) codes only on the branch continueCoding checked; the owner may have switched since.
        const continued = this.entries(runId).findLast((e) => e.type === 'code.continue');
        if (continued && branch !== continued['branch'])
          throw new ParkError(
            'wrong_branch',
            `the folder is on ${branch ?? 'a detached HEAD'}, not the run's branch ${String(continued['branch'])}: check it out, then resume`,
          );
        // A new solution is coded on its own branch: the staging branch deploys. A continued run stays where it is.
        if (s.input.kind === 'new' && !continued) {
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
      // Plan 075: a new build with memory gets its scaffold committed before the first line of code.
      if (this.buildMemoryMode(runId) === 'repo') await this.memoryBuild(runId, 'scaffold');
      else if (this.buildMemoryMode(runId) === 'member')
        await this.memoryMemberSession(runId, 'link');
      const checks = this.handoffChecks(runId, dir);
      if (checks.mode === 'none')
        this.record(runId, 'step.warn', {
          step: 'code.checks',
          message:
            'no check commands were approved for this repository: the agent can edit files but cannot run anything, so its work is untested',
        });
      await this.installDependencies(runId, dir, checks.mode);
      // The agent works in parts (plan 036): a part stopped at a run limit is committed on the run's branch
      // (local only; the owner still decides the push), and the next part continues from there.
      const start = this.state(runId).steps['code.start']?.data as
        { branch?: string | null; base?: string | null } | undefined;
      const base = start?.base;
      const earlier = this.codeParts(runId);
      // A continued run (plan 037): the work before it is committed, and even its first part is told so.
      const resumed = this.continuedFrom(runId);
      // An update run on a repository the Incubator did not build (plan 042): when a part ends, the Incubator runs
      // the approved checks itself, and keeps going until every request's ticket is marked and the checks pass.
      const external = checks.mode !== 'gate';
      const tickets = external ? this.planTickets(runId) : [];
      // why: a check that already failed before the agent started (for example, dependencies not installed) is
      // reported, but does not hold the agent's work back.
      const baseline =
        external && checks.mode === 'approved'
          ? await this.checkBaseline(runId, dir, checks.commands)
          : [];
      // why: a check the baseline never ran (its round's time was used up) is not known to fail, so it is not excused.
      const alreadyFailing = baseline
        .filter((r) => r.result === 'failed' && !r.tail.endsWith(CHECK_NOT_RUN))
        .map((r) => r.command);
      let verify: {
        done: boolean;
        remaining: string[];
        runs: CheckRun[];
        alreadyFailing: string[];
      } | null = null;
      // Plan 046: the requests a part left unmarked when it stopped at a run limit (no checks run then).
      let unmarked: string[] = [];
      let out: HandoffOutcome;
      for (;;) {
        let last = 0;
        const part = earlier.length + 1;
        // The previous part's verification, when it left work: the next part is told exactly what.
        const left = verify && !verify.done ? verify : null;
        out = await this.launchHandoff(runId, {
          onProgress: (p) => {
            // why: a long run reports every turn; the journal keeps the first and then one a second.
            if (last && Date.now() - last < 1000) return;
            last = Date.now();
            this.record(runId, 'handoff.progress', { ...p });
          },
          ...(part > 1 || resumed
            ? {
                continuation: {
                  part,
                  max: MAX_CODE_PARTS,
                  base: base ?? null,
                  earlier,
                  ...(resumed ? { before: resumed } : {}),
                  ...(left
                    ? {
                        remaining: tickets.filter((t) => left.remaining.includes(t.id)),
                        failing: left.runs
                          .filter(
                            (r) =>
                              r.result === 'failed' && !left.alreadyFailing.includes(r.command),
                          )
                          .map((r) => ({ command: r.command, tail: r.tail })),
                      }
                    : unmarked.length
                      ? { remaining: tickets.filter((t) => unmarked.includes(t.id)) }
                      : {}),
                },
              }
            : {}),
        });
        // why: the checks write files too; whether the agent changed anything is read before they run.
        const changed = (await git.status(dir)).length > 0;
        verify = null;
        unmarked = [];
        if (external && !out.stopped) {
          const remaining = remainingTickets(
            dir,
            tickets.map((t) => t.id),
          );
          // why: verify a part that ended normally, or one that finished every request as a limit tripped.
          if ((out.exitCode === 0 && !out.tripped) || (out.tripped && remaining.length === 0)) {
            const runs =
              checks.mode === 'approved'
                ? await this.verifyChecks(runId, dir, checks.commands)
                : [];
            verify = {
              done:
                remaining.length === 0 &&
                runs.every((r) => r.result !== 'failed' || alreadyFailing.includes(r.command)),
              remaining,
              runs,
              alreadyFailing,
            };
            this.record(runId, 'code.verify', { part, ...verify });
            if (verify.done) break;
          } else if (out.tripped) {
            // why: a part that stopped at a limit with requests left is not checked, but the next part is still told which.
            unmarked = remaining;
          }
        }
        const more = out.tripped !== null || (verify !== null && !verify.done);
        if (!more || part >= MAX_CODE_PARTS) break;
        // why: a part that changed nothing would spend the next part's limits the same way.
        if (!changed) break;
        // why: without an identity there is nobody to commit as; the commit request then says what to set.
        if (!(await git.identity(dir))) break;
        // why: a checkpoint is only ever made on the run's own branch, never on a branch the owner switched to.
        if (
          !start?.branch?.startsWith('incubator/') ||
          (await git.currentBranch(dir)) !== start.branch
        )
          break;
        // why: a Stop pressed as the limit tripped, or a plan already finished (cost arrives in the last event).
        if (
          this.#active.get(runId)?.controller.signal.aborted ||
          (!external && out.ticketState === 'READY_FOR_TEST')
        )
          break;
        await git.addAll(dir);
        const title = this.finishTitle(runId, this.state(runId));
        const unfinished = verify
          ? `${verify.remaining.length} request(s) not done, ${verify.runs.filter((r) => r.result === 'failed' && !alreadyFailing.includes(r.command)).length} check(s) failing`
          : null;
        const sha = await git.commit(
          dir,
          partMessage({ title, part, tripped: out.tripped, left: unfinished }, runId),
          {},
        );
        const done: CodePart = { part, sha, tripped: out.tripped };
        this.record(runId, 'code.part', { ...done });
        earlier.push(done);
      }
      // Plan 075: the bootstrap reads the code that now exists; a stopped run is not bootstrapped.
      if (!out.stopped && this.buildMemoryMode(runId) === 'repo')
        await this.memoryBuild(runId, 'bootstrap');
      else if (!out.stopped && this.buildMemoryMode(runId) === 'member')
        await this.memoryMemberSession(runId, 'bootstrap');
      const report = agentReport(out);
      // The verdict of an update run counts every request and the Incubator's own checks (plan 042).
      const verdict =
        external && verify
          ? verify.done
            ? 'ready'
            : report.verdict === 'ready'
              ? 'parked'
              : report.verdict
          : report.verdict;
      this.record(runId, 'step.ok', {
        step: 'code.done',
        data: {
          ...report,
          verdict,
          checks,
          parts: earlier.length + 1,
          ...(verify ? { verify } : {}),
        },
      });
    });
    this.enter(runId, 'COMMIT');
  }

  /** An update run's tickets with their requests, in plan order (plan 042). Empty for other runs. */
  private planTickets(runId: string): { id: string; summary: string }[] {
    const s = this.state(runId);
    const delivered = s.steps['enhance.plan']?.data as EnhancePlanRecord | undefined;
    if (s.input.kind !== 'enhance' || !delivered) return [];
    const features = this.finalSpec(runId)?.intent.coreFeatures ?? [];
    return delivered.features.map((f) => ({
      id: ticketId(f),
      summary: features.find((x) => x.id === f.id)?.summary ?? f.id,
    }));
  }

  /** Runs the approved check commands in the folder, with the PATH the agent had (plan 042). */
  private async verifyChecks(
    runId: string,
    dir: string,
    commands: readonly string[],
  ): Promise<CheckRun[]> {
    // why: an engine built without tools (every test engine) must not find the developer's real SDKs.
    const tools = this.tools() ?? {
      exec: this.deps.handoff!.exec,
      userHome: this.deps.store.runDir(runId),
    };
    const env = await toolPathEnv(commands, tools);
    const runs = await runChecks(commands, dir, tools, {
      ...(env ? { env } : {}),
      // Plan 046: a round of checks gets its own time, equal to the run's minutes limit, as each part of the agent's work does.
      budgetMs: checkBudgetMs(this.approvedSpec(runId).agents.runCeilings.minutes),
      ...this.sig(runId),
    });
    // why: a Stop pressed during the last command ends it early; that result says nothing about the code.
    this.throwIfStopped(runId);
    return runs;
  }

  /** The approved checks on the code before the agent's first part of the run, run once (plan 042). */
  private async checkBaseline(
    runId: string,
    dir: string,
    commands: readonly string[],
  ): Promise<CheckRun[]> {
    const entries = this.entries(runId);
    // why: a continued run (plan 037) keeps the baseline from before the agent's first part: the earlier
    // session's own failures are not excused. A continued run with no baseline excuses nothing.
    const known = entries.find((e) => e.type === 'code.baseline');
    if (known) return known['runs'] as CheckRun[];
    if (entries.some((e) => e.type === 'code.continue')) return [];
    const runs = await this.verifyChecks(runId, dir, commands);
    this.record(runId, 'code.baseline', { runs });
    return runs;
  }

  /**
   * Plan 056: a repository the Incubator built (checks mode `gate`) gets its dependencies installed before the agent's
   * first part, once per coding stage. The agent may not run an installer itself, and a gate that fails on missing
   * tools tells it nothing it can fix. The outcome is journaled; a problem never parks the run.
   */
  private async installDependencies(runId: string, dir: string, mode: string): Promise<void> {
    const install = this.deps.handoff?.install;
    if (!install || mode !== 'gate') return;
    const after = this.continuedAt(runId);
    if (this.entries(runId).some((e) => e.type === 'code.install' && e.seq > after)) return;
    const runs = await install(dir, this.sig(runId).signal);
    // why: a Stop pressed during the install ends it early; that result says nothing about the toolchain.
    this.throwIfStopped(runId);
    this.record(runId, 'code.install', { runs });
  }

  /** The coding parts already committed since coding last started (plan 036). */
  private codeParts(runId: string): CodePart[] {
    const entries = this.entries(runId);
    const from =
      entries.findLast((e) => e.type === 'step.ok' && e['step'] === 'code.start')?.seq ?? 0;
    return entries
      .filter((e) => e.type === 'code.part' && e.seq > from)
      .map((e) => ({
        part: Number(e['part']),
        sha: String(e['sha']),
        tripped: typeof e['tripped'] === 'string' ? e['tripped'] : null,
      }));
  }

  /** The review the owner needs at the commit request, computed from the folder as it is now. */
  async finishDetail(runId: string): Promise<FinishDetail | null> {
    const s = this.state(runId);
    if (!s.input.dir || !this.deps.publish || s.input.kind === 'memory') return null;
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
    // why: answers and outcomes from before "continue coding" (plan 037) were about the earlier code.
    const after = this.continuedAt(runId);
    const approved = this.entries(runId).findLast(
      (e) => e.type === 'finish.approve' && e.seq > after,
    );
    const progress = this.entries(runId).findLast(
      (e) => e.type === 'handoff.progress' && e.seq > after,
    );
    const pr = this.entries(runId).findLast((e) => e.type === 'finish.summary' && e.seq > after)?.[
      'pr'
    ] as { number: number; url: string } | undefined;
    const setup = this.setupProblem(runId);
    const detail: Omit<FinishDetail, 'whatNow'> = {
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
      setup,
      checkpoints: this.codeParts(runId).map(({ part, sha }) => ({ part, sha })),
      memory: this.buildMemoryDetail(runId),
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
    return { ...detail, whatNow: stage === 'done' ? this.whatNowFor(runId, s, detail) : null };
  }

  /** Plan 056: the first problem installing the dependencies before the agent coded, or null. */
  private setupProblem(runId: string): string | null {
    const after = this.continuedAt(runId);
    const installed = this.entries(runId).findLast(
      (e) => e.type === 'code.install' && e.seq > after,
    )?.['runs'] as InstallRun[] | undefined;
    return installed?.find((r) => r.result !== 'ok')?.note ?? null;
  }

  /** Plan 057: the operator's guide for this run, from the approved spec, the folder's tickets and the journal. */
  private whatNowFor(
    runId: string,
    s: RunState,
    d: Pick<FinishDetail, 'agent' | 'setup' | 'branch'> &
      Partial<Pick<FinishDetail, 'commit' | 'pr'>>,
  ): WhatNow {
    const spec = this.approvedSpec(runId);
    const warnings = this.entries(runId)
      .filter((e) => e.type === 'step.warn')
      .map((e) => {
        const data = e['data'] as { reason?: unknown } | undefined;
        const text = typeof e['message'] === 'string' ? e['message'] : data?.reason;
        return typeof text === 'string' ? text : '';
      })
      .filter((t) => t.length > 0);
    return whatNow({
      runId,
      name: spec.project.name,
      description: spec.project.description,
      platform: spec.platform,
      slug: spec.project.slug,
      pack: spec.stack.pack,
      gettingStarted: readGettingStarted(this.runDir(s)),
      deployTarget: spec.deploy.target,
      branch: d.branch,
      verdict: d.agent?.verdict ?? null,
      setup: d.setup,
      tickets: readTickets(this.runDir(s)),
      warnings: [...new Set(warnings)],
      ...(d.commit !== undefined ? { commit: d.commit } : {}),
      pr: d.pr ?? this.latestPr(runId),
      ...(this.memoryOffered(runId, s) ? { memoryOffer: true } : {}),
    });
  }

  /**
   * Plan 062: the pull request of the latest push, from any stage. A continued stage that changed nothing opens none of
   * its own, and the guide must not say the work is unpushed when an earlier stage pushed it.
   */
  private latestPr(runId: string): { number: number; url: string } | null {
    const e = this.entries(runId).findLast((x) => x.type === 'finish.summary');
    return (e?.['pr'] as { number: number; url: string } | undefined) ?? null;
  }

  /**
   * Plan 058: the stand-up guide for a finished run that has a project folder: what was built and the literal steps
   * to stand it up, as an executor plan. Written under the run's own directory, never into the project folder (an
   * untracked file there would make "continue coding" refuse with dirty_tree).
   */
  async standUpGuide(runId: string): Promise<StandUp> {
    const s = this.state(runId);
    if (!s.input.dir)
      throw new PolicyError(`run ${runId} has no project folder`, { code: 'no_folder' });
    if (!s.done || s.cancelled)
      throw new PolicyError(`run ${runId} is not finished`, { code: 'not_finished' });
    const guide = (await this.finishDetail(runId))?.whatNow;
    if (!guide)
      throw new PolicyError(`run ${runId} has no coding stage to describe`, { code: 'no_guide' });
    const spec = this.approvedSpec(runId);
    const out = standUp({
      runId,
      name: spec.project.name,
      slug: spec.project.slug,
      pack: spec.stack.pack,
      platform: spec.platform,
      guide,
    });
    const dir = path.join(this.deps.store.runDir(runId), 'guide');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, out.fileName), out.markdown);
    this.record(runId, 'guide.written', { file: out.fileName });
    return out;
  }

  /** Plan 064: what the stand-up steps need to know about a finished run's project. */
  private appFacts(runId: string): StandUpFacts {
    const s = this.state(runId);
    if (!s.input.dir)
      throw new PolicyError(`run ${runId} has no project folder`, { code: 'no_folder' });
    if (!s.done || s.cancelled)
      throw new PolicyError(`run ${runId} is not finished`, { code: 'not_finished' });
    const spec = this.approvedSpec(runId);
    // why: the app steps never read the guide, so an empty one is enough to satisfy the facts' type.
    return {
      runId,
      name: spec.project.name,
      slug: spec.project.slug,
      pack: spec.stack.pack,
      platform: spec.platform,
      guide: {} as StandUpFacts['guide'],
    };
  }

  /**
   * Plan 064: brings a finished project up on this machine by running its stand-up steps in order, and journals each.
   * It stops at the first step that fails. When the project has an address, waits for it to answer.
   */
  async startApp(runId: string): Promise<AppStatus> {
    const facts = this.appFacts(runId);
    const exec = this.deps.handoff?.exec;
    const dir = this.state(runId).input.dir!;
    const steps = appRunSteps(facts);
    if (!exec || steps.length === 0)
      throw new PolicyError(`${facts.pack} has nothing to start`, { code: 'nothing_to_start' });
    const url = appUrl(facts);
    // Plan 066: a project that is already up answers on its own address, so only check a stopped one.
    const wasUp = this.appStatus(runId).state === 'up';
    this.record(runId, 'app.begin', { steps: steps.map((x) => x.title) });
    const taken = wasUp ? null : await addressInUse(url, this.deps.handoff?.ping);
    if (taken) {
      this.record(runId, 'app.step', { ...taken });
      this.record(runId, 'app.failed', {});
      return this.appStatus(runId);
    }
    const ok = await runAppSteps(exec, dir, steps, this.sig(runId).signal, (r) =>
      this.record(runId, 'app.step', { ...r }),
    );
    if (!ok) this.record(runId, 'app.failed', {});
    else {
      const ping = this.deps.handoff?.ping;
      const signal = this.sig(runId).signal;
      // Plan 067: an answer counts only while the project's own containers are not known to be down.
      const up =
        url && ping
          ? await waitForUrl(url, ping, 120_000, 2000, () => projectContainersUp(exec, dir, signal))
          : true;
      this.record(runId, up ? 'app.started' : 'app.failed', { url });
    }
    return this.appStatus(runId);
  }

  /** Plan 064: takes the project's containers down (the data stays). */
  async stopApp(runId: string): Promise<AppStatus> {
    const facts = this.appFacts(runId);
    const exec = this.deps.handoff?.exec;
    const dir = this.state(runId).input.dir!;
    if (!exec || appRunSteps(facts).length === 0)
      throw new PolicyError(`${facts.pack} has nothing to stop`, { code: 'nothing_to_start' });
    this.record(runId, 'app.stopping', {});
    await runAppSteps(
      exec,
      dir,
      [{ title: 'Stop the app', command: 'docker compose down', expect: '', source: '' }],
      this.sig(runId).signal,
      (r) => this.record(runId, 'app.step', { ...r }),
    );
    this.record(runId, 'app.stopped', {});
    return this.appStatus(runId);
  }

  /** Plan 064: where the last start attempt stands, read from the journal. */
  appStatus(runId: string): AppStatus {
    const facts = this.appFacts(runId);
    const entries = this.entries(runId);
    const begin = entries.findLast((e) => e.type === 'app.begin');
    const last = entries.findLast((e) =>
      ['app.begin', 'app.started', 'app.failed', 'app.stopping', 'app.stopped'].includes(e.type),
    );
    const steps = begin
      ? entries
          .filter((e) => e.type === 'app.step' && e.seq > begin.seq)
          .map((e) => ({
            title: String(e['title']),
            ok: e['ok'] === true,
            tail: typeof e['tail'] === 'string' ? e['tail'] : '',
          }))
      : [];
    const state: AppStatus['state'] =
      last?.type === 'app.started'
        ? 'up'
        : last?.type === 'app.failed'
          ? 'failed'
          : last?.type === 'app.begin'
            ? 'starting'
            : 'down';
    return {
      state,
      url: state === 'up' ? appUrl(facts) : null,
      available: appRunSteps(facts).length > 0,
      steps,
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
      // why: after "continue coding" (plan 037) HEAD starts as the earlier finish commit; only a newer one counts.
      if (head !== start.base && (await git.headMessage(dir))?.includes(finishTrailer(runId))) {
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
      const after = this.continuedAt(runId);
      const approval = this.entries(runId).findLast(
        (e) => e.type === 'finish.approve' && e.seq > after,
      );
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
      // Plan 057: the operator's guide to what was built and what to do next, committed with the work.
      const guide = this.whatNowFor(runId, s, {
        agent: (s.steps['code.done']?.data as AgentReport | undefined) ?? null,
        setup: this.setupProblem(runId),
        branch: start.branch,
      });
      // ADR-030: a Backshack tool is one package in backshack-dev; the Incubator's guides stay in the run folder.
      if (!this.isBackshack(s)) {
        writeFileSync(path.join(dir, WHAT_NOW_FILE), whatNowMarkdown(guide));
        // Plan 065: the design and the stand-up steps travel with the code, not only in the run folder.
        const spec = this.approvedSpec(runId);
        mkdirSync(path.join(dir, 'docs'), { recursive: true });
        writeFileSync(path.join(dir, DESIGN_FILE), designMarkdown(spec));
        writeFileSync(
          path.join(dir, STAND_UP_FILE),
          standUp({
            runId,
            name: spec.project.name,
            slug: spec.project.slug,
            pack: spec.stack.pack,
            platform: spec.platform,
            guide,
          }).markdown,
        );
      }
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
    if (this.isBackshack(s)) {
      // ADR-030: committed on the worktree branch and parked for the owner, who runs the contract check, the
      // gate and the push to staging themselves.
      this.record(runId, 'run.done', {
        committedLocally: true,
        reason: `a Backshack tool is committed on ${committed.branch} only: the push to staging is yours`,
      });
      return;
    }
    const target = this.pushTarget(runId, s);
    if (!target.repo) {
      this.record(runId, 'run.done', { committedLocally: true, reason: target.reason });
      return;
    }
    const after = this.continuedAt(runId);
    const decision = this.entries(runId).findLast((e) => e.type === 'finish.push' && e.seq > after);
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

  // --- Add memory (plan 071, ADR-031) ----------------------------------------------------------

  /**
   * What the Add memory form starts from, for a portfolio project or a folder: the system name (the
   * solution's name, kebab-case), the isolation terms (every other solution's code identifiers), the shipped
   * seed version, and the memory already recorded, if any.
   */
  async memoryDefaults(target: { projectId?: string; dir?: string }): Promise<{
    system: string;
    isolationTerms: string[];
    seedVersion: string;
    installed: MemoryRecord | null;
    project: { id: string; name: string } | null;
  }> {
    const project = target.projectId
      ? this.portfolioGet(target.projectId)
      : target.dir
        ? await this.portfolioFor(path.resolve(target.dir))
        : undefined;
    if (target.projectId && !project)
      throw new PolicyError(`no project ${target.projectId}`, { code: 'not_found' });
    const name = project?.name ?? (target.dir ? path.basename(path.resolve(target.dir)) : '');
    const system = project?.memory?.system ?? (kebab(name) || 'solution');
    return {
      system,
      isolationTerms: prefillIsolationTerms(
        this.portfolioList(),
        project ? [project.id] : [],
        system,
      ),
      seedVersion: seedVersion(),
      installed: project?.memory ?? null,
      project: project ? { id: project.id, name: project.name } : null,
    };
  }

  /** The owner's list of a project's distinctive code identifiers (plan 071). */
  setIdentifiers(projectId: string, list: readonly string[]): PortfolioProject {
    const pf = this.deps.portfolio;
    if (!pf) throw new ToolError('the portfolio is off');
    const terms = checkTerms(list);
    const p = pf.update(projectId, (x) => {
      x.identifiers = terms;
    });
    if (!p) throw new PolicyError(`no project ${projectId}`, { code: 'not_found' });
    return p;
  }

  /** The mode the build's `memory.plan` chose, or null (no plan: the run has no coding session). */
  private buildMemoryMode(runId: string): MemoryPlan['mode'] | null {
    const e = this.entries(runId).find((x) => x.type === 'memory.plan') as
      { plan?: MemoryPlan } | undefined;
    return e?.plan?.mode ?? null;
  }

  /** What the scaffold session seeds `decisions.md` from: the owner's words and the approved spec's choices. */
  private buildMemoryFacts(runId: string): BuildMemoryFacts {
    const spec = this.approvedSpec(runId);
    const chosen = [
      `Project: ${spec.project.name} (${spec.project.slug})`,
      `Stack: ${spec.stack.pack}${spec.stack.framework ? `, framework ${spec.stack.framework}` : ''}${spec.stack.database ? `, database ${spec.stack.database}` : ''}`,
      `Deploy target: ${spec.deploy.target}`,
      `Tests live: ${spec.testing.home}`,
    ];
    return { narrative: this.state(runId).input.narrative ?? spec.intent.narrative, chosen };
  }

  /**
   * Plan 075: one of the two memory sessions of a new build. The scaffold runs before the first coding part and
   * commits the store on the build branch; the bootstrap runs after the last part and commits the filled store.
   * The Incubator checks each result itself; a broken rule parks the run and nothing is pushed.
   */
  private async memoryBuild(runId: string, phase: MemoryBuildPhase): Promise<void> {
    const done = `memory.${phase}`;
    if (this.state(runId).steps[done]?.status === 'ok') return;
    const earlier = this.state(runId).steps['memory.scaffold']?.data as
      { skipped?: boolean } | undefined;
    if (phase === 'bootstrap' && earlier?.skipped) {
      this.record(runId, 'step.ok', { step: done, data: { skipped: true } });
      return;
    }
    const git = this.deps.publish!.git;
    if (!this.deps.handoff) throw new ToolError('a build with memory needs a coding agent CLI');
    const dir = this.runDir(this.state(runId));
    const start = `${done}.start`;
    if (this.state(runId).steps[start]?.status !== 'ok') {
      if (!(await git.identity(dir))) {
        // why: the memory commits need an author; the commit request later says what to set. The build goes on.
        this.record(runId, 'step.warn', {
          step: `${done}.skipped`,
          message:
            'git does not know who you are, so the memory store was not made: set user.name and user.email, then run Add memory on this repository',
        });
        this.record(runId, 'step.ok', {
          step: done,
          data: {
            skipped: true,
            reason:
              'git does not know who you are, so the memory store was not made: set user.name and user.email, then run Add memory on this repository',
          },
        });
        return;
      }
      const seed = path.join(this.deps.store.runDir(runId), 'memory-seed');
      const version = existsSync(path.join(seed, 'VERSION')) ? seedVersion(seed) : copySeed(seed);
      this.record(runId, 'step.ok', {
        step: start,
        data: {
          seed,
          seedVersion: version,
          base: await git.headSha(dir),
          branch: await git.currentBranch(dir),
          // why: the coding session follows the store's own rules and writes its notes there; they stay uncommitted
          // for the owner's commit, so the bootstrap is only answerable for the memory files it leaves dirty itself.
          dirtyMemory: (await git.status(dir))
            .filter((e) => allowedMemoryPath(e.path))
            .map((e) => e.path),
        },
      });
    }
    if (this.state(runId).steps[`${done}.agent`]?.status !== 'ok') {
      const unsupported = await this.runMemoryBuildAgent(runId, phase);
      if (unsupported) {
        // why: a build that worked without memory must not stop because its agent CLI cannot make the store.
        this.record(runId, 'step.warn', { step: `${done}.skipped`, message: unsupported });
        this.record(runId, 'step.ok', { step: done, data: { skipped: true, reason: unsupported } });
        return;
      }
    }
    const result = await this.checkMemoryBuild(runId, phase);
    this.record(runId, 'step.ok', { step: done, data: result });
    // why: from here on the portfolio says the solution has memory, so later update runs read it.
    const spec = this.approvedSpec(runId);
    this.record(runId, 'memory.installed', {
      record: {
        mode: 'repo',
        system: spec.project.slug,
        store: REPO_STORE,
        seedVersion: result.seedVersion,
        commitPolicy: 'direct',
        installedAt: this.deps.clock.now().toISOString().slice(0, 10),
        report:
          phase === 'bootstrap'
            ? result.report
            : 'scaffold only; the bootstrap runs after the code',
      },
    });
  }

  /** Runs one memory session; returns why it cannot run with this agent CLI, or null when it ran. */
  private async runMemoryBuildAgent(
    runId: string,
    phase: MemoryBuildPhase,
  ): Promise<string | null> {
    const s = this.state(runId);
    const dir = this.runDir(s);
    const start = s.steps[`memory.${phase}.start`]!.data as { seed: string };
    const agent = this.cfg().agents?.primary ?? 'claude';
    const caps = await this.deps.handoff!.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    if (!caps.flags.allowedTools || !caps.flags.addDir || !caps.flags.model)
      return `${AGENT_ADAPTERS[agent]} cannot restrict its commands, read the memory seed and choose a model, so the memory store was not made: run Add memory with another agent CLI`;
    if (!caps.flags.effort)
      this.record(runId, 'step.warn', {
        step: `memory.${phase}.effort`,
        message: `${AGENT_ADAPTERS[agent]} has no flag for reasoning effort, so "${MEMORY_DEFAULT_EFFORT}" was not applied`,
      });
    // Skill stubs go outside the repo (Claude Code refuses writes under `.claude/`); the Incubator copies them in afterwards.
    const stubs = path.join(this.deps.store.runDir(runId), 'memory-stubs');
    mkdirSync(stubs, { recursive: true });
    const ceilings = { ...DEFAULT_RUN_CEILINGS };
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(caps, ceilings, MEMORY_BUILD_ALLOWED_TOOLS, MEMORY_DEFAULT_MODEL, {
        addDirs: [start.seed, stubs],
        available: MEMORY_AVAILABLE_TOOLS,
        isolateSettings: true,
        effort: MEMORY_DEFAULT_EFFORT,
      }),
      // The PowerShell tool is off as in repo mode (plan 079 WI-1, build).
      env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' },
      model: MEMORY_DEFAULT_MODEL,
      cwd: dir,
      planPath: path.join(start.seed, 'playbooks', 'deploy-repo.md'),
      ceilings,
      unenforceable: [],
    };
    const prompt = memoryBuildPrompt({
      phase,
      target: dir,
      seed: start.seed,
      stubs,
      terms: prefillIsolationTerms(this.portfolioList(), [], ''),
      today: this.deps.clock.now().toISOString().slice(0, 10),
      facts: this.buildMemoryFacts(runId),
    });
    let last = 0;
    const out = await this.runHandoff(
      runId,
      plan,
      prompt,
      null,
      { mode: 'none', commands: [] },
      {
        onProgress: (p) => {
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
        summaryMax: 20_000,
      },
    );
    if (out.stopped) throw new InterruptedError(`run ${runId} was stopped`);
    await this.installBuildMemoryProtected(runId, phase, start.seed, stubs, out);
    this.record(runId, 'step.ok', {
      step: `memory.${phase}.agent`,
      data: { ...agentReport(out), effortApplied: Boolean(caps.flags.effort) },
    });
    return null;
  }

  /**
   * The parts of a build's memory that Claude Code refuses an agent to write (`.claude/` and `.git/`): the skills,
   * the SessionEnd hook, the git pre-commit hook. The Incubator makes and commits them after the session stops
   * (acceptance build 1, 2026-11-07). The scaffold has no content to self-test yet; the bootstrap does.
   */
  private async installBuildMemoryProtected(
    runId: string,
    phase: MemoryBuildPhase,
    seed: string,
    stubs: string,
    out: Parameters<typeof agentReport>[0],
  ): Promise<void> {
    const dir = this.runDir(this.state(runId));
    const rep = agentReport(out);
    if (rep.tripped || rep.exitCode !== 0 || !existsSync(path.join(dir, '.memory', 'INDEX.md')))
      return;
    const result = await installMemoryProtected({
      exec: this.deps.handoff!.exec,
      git: this.deps.publish!.git,
      dir,
      seed,
      stubs,
      selfTests: phase === 'bootstrap' && this.deps.memorySelfTests !== false,
      ...(this.sig(runId).signal ? { signal: this.sig(runId).signal } : {}),
    });
    const failed = result.checks.filter((c) => c.status === 'failed');
    if (failed.length)
      throw new ParkError(
        'memory_verify_failed',
        `the Incubator's own checks of the ${phase} failed: ${failed
          .map((c) => `${c.step} (${c.detail})`)
          .join('; ')}. Fix the install and resume, or cancel the run.`,
        { problems: failed.map((c) => `${c.step}: ${c.detail}`) },
      );
    this.record(runId, 'step.ok', { step: `memory.${phase}.protected`, data: result });
  }

  /** The Incubator's own checks of one memory session of a build, run after the agent stops and on every resume. */
  private async checkMemoryBuild(
    runId: string,
    phase: MemoryBuildPhase,
  ): Promise<{ seedVersion: string; head: string; report: string }> {
    const s = this.state(runId);
    const git = this.deps.publish!.git;
    const dir = this.runDir(s);
    const start = s.steps[`memory.${phase}.start`]!.data as {
      seedVersion: string;
      base: string;
      branch: string | null;
      dirtyMemory?: string[];
    };
    const agent = s.steps[`memory.${phase}.agent`]!.data as AgentReport;
    const report = phase === 'bootstrap' ? parseMemoryReport(agent.summary) : null;
    const problems: string[] = [];
    if (agent.tripped) problems.push(`the agent stopped at a run limit (${agent.tripped})`);
    else if (agent.exitCode !== 0) problems.push(`the agent exited with code ${agent.exitCode}`);
    if (phase === 'bootstrap' && !report)
      problems.push("the agent did not end with the playbook's report");
    // why: the owner's build work stays uncommitted during the bootstrap; only memory paths must be committed.
    const before = new Set(start.dirtyMemory ?? []);
    const left = (await git.status(dir)).filter(
      (e) => allowedMemoryPath(e.path) && !before.has(e.path),
    );
    if (left.length)
      problems.push(
        `memory files were left uncommitted: ${left
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    const head = await git.headSha(dir);
    const branch = await git.currentBranch(dir);
    if (branch !== start.branch)
      problems.push(
        `the build is on ${start.branch ?? 'a detached HEAD'}, but the folder is on ${branch ?? 'a detached HEAD'}`,
      );
    const changed =
      head && head !== start.base
        ? (await git.diffNameStatus(dir, start.base, head)).map(([, p]) => p)
        : [];
    if (changed.length === 0) problems.push('nothing was committed');
    if (changed.includes('AGENTS.md')) problems.push('AGENTS.md was changed (it never may be)');
    const outside = changed.filter((p) => !allowedMemoryPath(p));
    if (outside.length)
      problems.push(`files outside the memory store changed: ${outside.slice(0, 8).join(', ')}`);
    if (phase === 'scaffold' && !existsSync(path.join(dir, '.memory', 'INDEX.md')))
      problems.push('.memory/INDEX.md does not exist');
    const policy = installedPolicy(dir);
    if (policy !== 'direct')
      problems.push(
        `.memory/memory.conf should name the direct commit policy, not ${policy ?? 'none'}`,
      );
    const text = report?.text ?? agent.summary ?? '';
    this.record(runId, 'memory.result', { phase, problems, report: text });
    if (problems.length)
      throw new ParkError(
        'memory_rules_broken',
        `the ${phase} of the memory store broke a rule: ${problems.join('; ')}. Fix the folder and resume, or cancel the run.`,
        { problems },
      );
    if (phase === 'bootstrap' && !report!.verificationPassed)
      throw new ParkError(
        'memory_verify_failed',
        "the playbook's own verification did not all pass (see its report). Fix the store and resume, or cancel the run.",
      );
    return { seedVersion: start.seedVersion, head: head!, report: text };
  }

  /** Plan 078: an update run on a project with no memory offers Add memory; it never installs it silently. */
  private memoryOffered(runId: string, s: RunState): boolean {
    if (s.input.kind !== 'enhance' || this.buildMemoryMode(runId) !== 'target') return false;
    const dir = this.runDir(s);
    return !existsSync(path.join(dir, '.memory')) && !existsSync(path.join(dir, '.memory-link'));
  }

  /** What the owner is shown about a build's memory: the plan, and the bootstrap report once it exists. */
  private buildMemoryDetail(runId: string): FinishDetail['memory'] {
    const e = this.entries(runId).find((x) => x.type === 'memory.plan') as
      { plan?: MemoryPlan } | undefined;
    if (!e?.plan) return null;
    const steps = this.state(runId).steps;
    if (e.plan.mode === 'target')
      return {
        mode: 'target',
        reason: e.plan.reason,
        scaffolded: false,
        bootstrapped: false,
        report: null,
        note: this.memoryOffered(runId, this.state(runId)) ? MEMORY_OFFER : null,
      };
    const member = e.plan.mode === 'member';
    const scaffold = steps[member ? 'memory.member.link' : 'memory.scaffold'];
    const boot = steps[member ? 'memory.member.bootstrap' : 'memory.bootstrap'];
    const skipped = (scaffold?.data as { skipped?: boolean } | undefined)?.skipped === true;
    return {
      mode: e.plan.mode,
      reason: e.plan.reason,
      scaffolded: scaffold?.status === 'ok' && !skipped,
      bootstrapped:
        boot?.status === 'ok' && (boot.data as { skipped?: boolean } | undefined)?.skipped !== true,
      report: (boot?.data as { report?: string } | undefined)?.report ?? null,
      note: skipped ? ((scaffold?.data as { reason?: string } | undefined)?.reason ?? null) : null,
    };
  }

  /**
   * CODE for an Add memory run: checks the folder, gives the agent a copy of the seed and the playbook's inputs,
   * then checks what it committed against the rules the Incubator must never break. The agent makes the
   * playbook's commits; it never pushes (ADR-031).
   */
  private async memoryRunStep(runId: string, s: RunState): Promise<void> {
    if (s.input.memory?.members) return this.memoryStoreStep(runId, s);
    if (s.input.memory?.joinSystem) return this.memoryMemberRun(runId, s);
    if (s.steps['memory.done']?.status === 'ok') return this.enter(runId, 'PUSH');
    const git = this.deps.publish?.git;
    if (!git || !this.deps.handoff)
      throw new ToolError('Add memory needs git and a coding agent CLI');
    const dir = this.runDir(s);
    await this.effect(runId, async () => {
      if (this.state(runId).steps['memory.start']?.status !== 'ok') {
        // Spec rule 2: a folder with uncommitted changes parks `dirty_tree` before anything runs.
        await this.checkOwnerFolder(runId, this.state(runId));
        const project = await this.portfolioFor(dir);
        if (project?.memory)
          throw new ParkError(
            'memory_installed',
            `${project.name} already has memory (${project.memory.mode} mode, seed ${project.memory.seedVersion})`,
          );
        if (existsSync(path.join(dir, '.memory')) || existsSync(path.join(dir, '.memory-link')))
          throw new ParkError(
            'memory_present',
            'the repository already has .memory/ or .memory-link: Add memory is a first install, not an upgrade',
          );
        if (!(await git.identity(dir)))
          throw new ParkError(
            'no_git_identity',
            'git does not know who you are, and the install is committed: run `git config --global user.name "Your Name"` and `git config --global user.email you@example.com`, then resume',
          );
        const seed = path.join(this.deps.store.runDir(runId), 'memory-seed');
        const version = copySeed(seed);
        const base = this.state(runId).steps['folder.base']!.data as {
          head: string;
          branch: string | null;
        };
        this.record(runId, 'step.ok', {
          step: 'memory.start',
          data: { seed, seedVersion: version, base: base.head, branch: base.branch },
        });
      }
      if (this.state(runId).steps['memory.agent']?.status !== 'ok')
        await this.runMemoryAgent(runId);
      await this.installMemoryProtected(runId);
      const done = await this.checkMemoryInstall(runId);
      this.record(runId, 'step.ok', { step: 'memory.done', data: done });
    });
    this.enter(runId, 'PUSH');
  }

  private async runMemoryAgent(runId: string): Promise<void> {
    const s = this.state(runId);
    const m = s.input.memory!;
    const dir = this.runDir(s);
    const start = s.steps['memory.start']!.data as { seed: string };
    const agent = this.cfg().agents?.primary ?? 'claude';
    const caps = await this.deps.handoff!.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    if (!caps.flags.allowedTools)
      throw new ParkError(
        'checks_unenforceable',
        `${AGENT_ADAPTERS[agent]} cannot restrict which commands an agent runs, so it cannot install memory`,
      );
    const model = m.model ?? MEMORY_DEFAULT_MODEL;
    const effort = m.effort ?? MEMORY_DEFAULT_EFFORT;
    if (!caps.flags.effort)
      this.record(runId, 'step.warn', {
        step: 'memory.effort',
        message: `${AGENT_ADAPTERS[agent]} has no flag for reasoning effort, so "${effort}" was not applied`,
      });
    const ceilings = { ...DEFAULT_RUN_CEILINGS };
    // Skill stubs go outside the repo (Claude Code refuses writes under `.claude/`); the Incubator copies them in afterwards.
    const stubs = path.join(this.deps.store.runDir(runId), 'memory-stubs');
    mkdirSync(stubs, { recursive: true });
    // The seed's index script fails when `.claude/skills/` is missing, and the agent may not create it. An empty folder is not a change.
    mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(caps, ceilings, MEMORY_ALLOWED_TOOLS, model, {
        addDirs: [start.seed, stubs],
        effort,
        available: MEMORY_AVAILABLE_TOOLS,
        isolateSettings: true,
      }),
      // Without `--tools` a Windows session still has the PowerShell tool, which no allow rule covers.
      env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' },
      model,
      cwd: dir,
      planPath: path.join(start.seed, 'playbooks', 'deploy-repo.md'),
      ceilings,
      unenforceable: [],
    };
    const prompt = memoryPrompt({
      target: dir,
      seed: start.seed,
      stubs,
      // Spec rule 5: the only thing another system contributes is this list of terms.
      terms: m.isolationTerms,
      policy: m.commitPolicy,
      today: this.deps.clock.now().toISOString().slice(0, 10),
    });
    let last = 0;
    const out = await this.runHandoff(
      runId,
      plan,
      prompt,
      null,
      { mode: 'none', commands: [] },
      {
        onProgress: (p) => {
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
        summaryMax: 20_000,
      },
    );
    if (out.stopped) throw new InterruptedError(`run ${runId} was stopped`);
    this.record(runId, 'step.ok', {
      step: 'memory.agent',
      data: { ...agentReport(out), effortApplied: Boolean(caps.flags.effort) },
    });
  }

  /**
   * After the agent: the parts Claude Code will not let it write (`.claude/`, the git hook), then the playbook's
   * verification steps that need them. Skipped when the agent already broke a rule; `checkMemoryInstall` then parks
   * with the reason. Safe to run again on resume.
   */
  private async installMemoryProtected(runId: string): Promise<void> {
    const s = this.state(runId);
    if (s.steps['memory.protected']?.status === 'ok') return;
    const git = this.deps.publish!.git;
    const dir = this.runDir(s);
    const agent = s.steps['memory.agent']!.data as AgentReport;
    const start = s.steps['memory.start']!.data as { seed: string; base: string };
    const report = parseMemoryReport(agent.summary);
    // Nothing is installed on a run that is already parked: the agent's own verification failed, or it broke a rule.
    if (agent.tripped || agent.exitCode !== 0 || !report?.verificationPassed) return;
    if ((await git.status(dir)).length) return;
    const head = await git.headSha(dir);
    if (!head || head === start.base) return;
    const changed = (await git.diffNameStatus(dir, start.base, head)).map(([, p]) => p);
    if (changed.includes('AGENTS.md') || changed.some((p) => !allowedMemoryPath(p))) return;
    const result = await installMemoryProtected({
      exec: this.deps.handoff!.exec,
      git,
      dir,
      seed: start.seed,
      stubs: path.join(this.deps.store.runDir(runId), 'memory-stubs'),
      selfTests: this.deps.memorySelfTests !== false,
      ...(this.sig(runId).signal ? { signal: this.sig(runId).signal } : {}),
    });
    const failed = result.checks.filter((c) => c.status === 'failed');
    if (failed.length)
      throw new ParkError(
        'memory_verify_failed',
        `the Incubator's own checks of the install failed, so nothing was pushed: ${failed
          .map((c) => `${c.step} (${c.detail})`)
          .join('; ')}. Fix the install and resume, or cancel the run.`,
        { problems: failed.map((c) => `${c.step}: ${c.detail}`) },
      );
    this.record(runId, 'step.ok', { step: 'memory.protected', data: result });
  }

  /**
   * The Incubator's own checks of the install (spec rules 2, 4a and 6, and the playbook's ground rule 2), run
   * after the agent stops and again on every resume: a broken rule parks, and nothing is pushed.
   */
  private async checkMemoryInstall(runId: string): Promise<MemoryDone> {
    const s = this.state(runId);
    const git = this.deps.publish!.git;
    const dir = this.runDir(s);
    const m = s.input.memory!;
    const start = s.steps['memory.start']!.data as {
      seedVersion: string;
      base: string;
      branch: string | null;
    };
    const agent = s.steps['memory.agent']!.data as AgentReport;
    const report = parseMemoryReport(agent.summary);
    const problems: string[] = [];
    if (agent.tripped) problems.push(`the agent stopped at a run limit (${agent.tripped})`);
    else if (agent.exitCode !== 0) problems.push(`the agent exited with code ${agent.exitCode}`);
    if (!report) problems.push("the agent did not end with the playbook's report");
    const changes = await git.status(dir);
    if (changes.length)
      problems.push(
        `uncommitted changes were left: ${changes
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    const head = await git.headSha(dir);
    const branch = await git.currentBranch(dir);
    const changed =
      head && head !== start.base
        ? (await git.diffNameStatus(dir, start.base, head)).map(([, p]) => p)
        : [];
    if (changed.length === 0) problems.push('nothing was committed');
    if (changed.includes('AGENTS.md')) problems.push('AGENTS.md was changed (it never may be)');
    const outside = changed.filter((p) => !allowedMemoryPath(p));
    if (outside.length)
      problems.push(`files outside the memory install changed: ${outside.slice(0, 8).join(', ')}`);
    const policy = installedPolicy(dir);
    if (!policy) problems.push('.memory/memory.conf names no commit policy');
    else if (m.commitPolicy !== 'auto' && policy !== m.commitPolicy)
      problems.push(`the install used the ${policy} policy, but ${m.commitPolicy} was chosen`);
    if (policy === 'pr' && branch !== MEMORY_BRANCH)
      problems.push(
        `the pr policy works on ${MEMORY_BRANCH}, but the folder is on ${branch ?? 'a detached HEAD'}`,
      );
    if (policy === 'direct' && branch !== start.branch)
      problems.push(
        `the direct policy commits to ${start.branch ?? 'the branch it started on'}, but the folder is on ${branch ?? 'a detached HEAD'}`,
      );
    const protectedChecks = (
      s.steps['memory.protected']?.data as { checks?: InstallCheck[] } | undefined
    )?.checks;
    const result = {
      report: `${report?.text ?? agent.summary ?? ''}${protectedChecks?.length ? `\n\n${checksReport(protectedChecks)}` : ''}`,
      policy,
      branch,
      head,
      seedVersion: start.seedVersion,
      kept: report?.kept ?? [],
      dropped: report?.dropped ?? [],
      verificationPassed: report?.verificationPassed ?? false,
      problems,
    };
    this.record(runId, 'memory.result', result);
    if (problems.length)
      throw new ParkError(
        'memory_rules_broken',
        `the install broke a rule, so nothing was pushed: ${problems.join('; ')}. Fix the folder and resume, or cancel the run.`,
        { problems },
      );
    if (!result.verificationPassed)
      throw new ParkError(
        'memory_verify_failed',
        "the playbook's own verification did not all pass (see its report), so nothing was pushed. Fix the install and resume, or cancel the run.",
      );
    return {
      seedVersion: start.seedVersion,
      policy: policy!,
      branch: branch!,
      head: head!,
      report: result.report ?? '',
      kept: result.kept,
      dropped: result.dropped,
    };
  }

  /**
   * PUSH for an Add memory run: the report is the review artifact. With a GitHub origin the owner decides the
   * push (and, for `pr`, the pull request); without one the install stays local. The Incubator never merges.
   */
  private async memoryPushStep(runId: string, s: RunState): Promise<void> {
    if (s.input.memory?.members) return this.memoryStorePushStep(runId, s);
    if (s.input.memory?.joinSystem) return this.memoryMemberPushStep(runId, s);
    const done = s.steps['memory.done']!.data as MemoryDone;
    const dir = this.runDir(s);
    const target = this.pushTarget(runId, s);
    const decision = target.repo
      ? this.entries(runId).findLast((e) => e.type === 'finish.push')
      : undefined;
    if (target.repo && !decision)
      throw new ParkError(
        'needs_push',
        `push ${done.branch} to ${target.repo.owner}/${target.repo.name}${done.policy === 'pr' ? ' and open a pull request' : ''}?`,
      );
    const pushed = decision?.['action'] === 'push';
    if (target.repo && pushed) {
      const repo = target.repo;
      await this.effect(runId, async () => {
        if (done.policy === 'pr') {
          const pr = await this.adopter().publish(
            this.adoptContext(runId),
            dir,
            repo,
            done.report,
            undefined,
            {
              prefix: 'memory',
              commitStep: 'memory.done',
              title: `Memory infrastructure v${done.seedVersion}`,
              fallbackBranch: MEMORY_BRANCH,
            },
          );
          this.record(runId, 'finish.summary', {
            pr,
            repo: `https://github.com/${repo.owner}/${repo.name}`,
          });
        } else if (this.state(runId).steps['memory.push']?.status !== 'ok') {
          const pub = this.deps.publish!;
          const token = await pub.resolveToken();
          if (!token) throw new PolicyError('no GitHub token to push with', { code: 'no_token' });
          await pub.git.push(
            dir,
            pub.github(token.token).remoteUrl(repo),
            `HEAD:refs/heads/${done.branch}`,
            token.token,
          );
          this.record(runId, 'step.ok', { step: 'memory.push', data: { branch: done.branch } });
        }
      });
    }
    const record: NonNullable<PortfolioProject['memory']> = {
      mode: 'repo',
      system: s.input.memory!.system,
      store: REPO_STORE,
      seedVersion: done.seedVersion,
      commitPolicy: done.policy,
      installedAt: this.deps.clock.now().toISOString().slice(0, 10),
      report: done.report,
    };
    this.record(runId, 'memory.installed', { record });
    this.record(runId, 'run.done', {
      ...(pushed ? {} : { committedLocally: true, local: dir }),
      ...(target.repo ? {} : { reason: target.reason }),
    });
  }

  // --- Store mode (plan 076): several repositories, one `<system>-memory` store ----------------------------

  /**
   * CODE for a store-mode Add memory run. Run 1 is the playbook's discovery: it proposes a `system.yaml` and the
   * run parks `memory_manifest`. Nothing is written until the owner confirms the manifest (`confirmMemoryManifest`,
   * never automatic). Run 2 builds the store and links every member; the Incubator then checks both.
   */
  private async memoryStoreStep(runId: string, s: RunState): Promise<void> {
    if (s.steps['memory.done']?.status === 'ok') return this.enter(runId, 'PUSH');
    if (!this.deps.publish?.git || !this.deps.handoff)
      throw new ToolError('Add memory needs git and a coding agent CLI');
    await this.effect(runId, async () => {
      const m = this.state(runId).input.memory!;
      if (this.state(runId).steps['memory.start']?.status !== 'ok')
        await this.memoryStoreStart(runId, m);
      const confirmed = this.entries(runId).findLast((e) => e.type === 'memory.manifest');
      if (!confirmed) {
        if (this.state(runId).steps['memory.discover']?.status !== 'ok')
          await this.runMemoryStoreAgent(runId, 'discover');
        const found = this.state(runId).steps['memory.discover']!.data as {
          proposed: string | null;
        };
        throw new ParkError(
          'memory_manifest',
          found.proposed
            ? 'the discovery proposed a system.yaml: confirm or edit it, then resume. Nothing is written before you do.'
            : 'the discovery did not propose a system.yaml: write one, then resume. Nothing is written before you do.',
          { proposed: found.proposed },
        );
      }
      if (this.state(runId).steps['memory.agent']?.status !== 'ok')
        await this.runMemoryStoreAgent(runId, 'install');
      await this.installMemorySystem(runId);
      const done = await this.checkMemoryStore(runId);
      this.record(runId, 'step.ok', { step: 'memory.done', data: done });
    });
    this.enter(runId, 'PUSH');
  }

  /** The owner's confirmed (or edited) manifest for a parked store-mode run. Checks it, then journals it. */
  async confirmMemoryManifest(runId: string, yaml: string): Promise<void> {
    const s = this.state(runId);
    const m = s.input.memory;
    const joining = this.joiningMember(runId);
    if (!joining && (s.input.kind !== 'memory' || !m?.members))
      throw new PolicyError('this run has no manifest to confirm', { code: 'no_manifest' });
    if (s.parked?.reason !== 'memory_manifest')
      throw new PolicyError('this run is not waiting for a manifest', { code: 'not_waiting' });
    if (joining) return this.confirmMemberManifest(runId, yaml, joining);
    if (!m?.members) return;
    const text = yaml.replace(/\r\n?/g, '\n').trim();
    if (text.length > 20_000)
      throw new PolicyError('the manifest is too long', { code: 'bad_manifest' });
    const names = manifestMembers(text);
    if (new Set(names).size !== names.length || names.length < 2)
      throw new PolicyError('the manifest needs two or more different members', {
        code: 'bad_manifest',
      });
    if (!new RegExp(`^system:\\s*${m.system}\\s*$`, 'm').test(text))
      throw new PolicyError(`the manifest must name the system "${m.system}"`, {
        code: 'bad_manifest',
      });
    const start = s.steps['memory.start']!.data as { workspace: string };
    const git = this.deps.publish!.git;
    const chosen = new Set(m.members.map((x) => x.name));
    for (const n of names) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(n))
        throw new PolicyError(`"${n}" is not a repository folder name`, { code: 'bad_manifest' });
      if (chosen.has(n)) continue;
      // why: a repository the discovery found is an addition the owner chose; it gets the same checks.
      const dir = path.join(start.workspace, n);
      const v = await inspectFolder(git, dir, 'existing');
      if (!v.ok) throw new PolicyError(`${n}: ${v.problems.join(' ')}`, { code: 'bad_manifest' });
      if (existsSync(path.join(dir, '.memory')) || existsSync(path.join(dir, '.memory-link')))
        throw new PolicyError(`${n} already has memory`, { code: 'bad_manifest' });
    }
    this.record(runId, 'memory.manifest', { yaml: text, members: names, by: 'owner' });
  }

  /** The system a run adds a member to (an Add member run, or a new build that joins one), or null. */
  private joiningMember(runId: string): MemberFacts | null {
    const s = this.state(runId);
    const build = s.input.kind === 'new' && this.buildMemoryMode(runId) === 'member';
    if (!build && !(s.input.kind === 'memory' && s.input.memory?.joinSystem)) return null;
    return this.memberFacts(runId);
  }

  /** The owner's confirmed manifest for an Add member run: the store's members, plus exactly the new one. */
  private confirmMemberManifest(runId: string, yaml: string, f: MemberFacts): void {
    const text = yaml.replace(/\r\n?/g, '\n').trim();
    if (text.length > 20_000)
      throw new PolicyError('the manifest is too long', { code: 'bad_manifest' });
    if (!new RegExp(`^system:\\s*${f.system}\\s*$`, 'm').test(text))
      throw new PolicyError(`the manifest must name the system "${f.system}"`, {
        code: 'bad_manifest',
      });
    const names = manifestMembers(text);
    const want = [...f.members, f.name].sort();
    if (names.length !== want.length || [...names].sort().join('\n') !== want.join('\n'))
      throw new PolicyError(
        `the manifest must list exactly the system's members and the new one (${want.join(', ')})`,
        { code: 'bad_manifest' },
      );
    this.record(runId, 'memory.manifest', { yaml: text, members: names, by: 'owner' });
  }

  private async memoryStoreStart(runId: string, m: MemoryRunInput): Promise<void> {
    const git = this.deps.publish!.git;
    const members = m.members!;
    const workspace = path.dirname(path.resolve(members[0]!.dir));
    const storeDir = path.join(workspace, `${m.system}-memory`);
    if (existsSync(storeDir))
      throw new ParkError(
        'memory_store_exists',
        `${storeDir} already exists: store mode is a first install. Move it away or choose another system name, then resume.`,
      );
    const bases: Record<string, { head: string | null; branch: string | null }> = {};
    for (const mem of members) {
      if (!path.isAbsolute(mem.dir))
        throw new PolicyError(`${mem.name}: the folder must be an absolute path`, {
          code: 'bad_members',
        });
      const v = await inspectFolder(git, mem.dir, 'existing');
      // Spec rule 2: any member with uncommitted changes parks before anything runs.
      if (!v.ok)
        throw new ParkError(
          v.git && !v.git.clean ? 'dirty_tree' : 'folder_invalid',
          `${mem.name}: ${v.problems.join(' ')}`,
          { path: v.path, changed: v.git?.changed ?? [] },
        );
      if (
        existsSync(path.join(mem.dir, '.memory')) ||
        existsSync(path.join(mem.dir, '.memory-link'))
      )
        throw new ParkError(
          'memory_present',
          `${mem.name} already has .memory/ or .memory-link: store mode is a first install`,
        );
      const project = await this.portfolioFor(path.resolve(mem.dir));
      if (project?.memory)
        throw new ParkError('memory_installed', `${project.name} already has memory`);
      if (!(await git.identity(mem.dir)))
        throw new ParkError(
          'no_git_identity',
          `git does not know who you are in ${mem.name}, and the link is committed: set user.name and user.email there, then resume`,
        );
      bases[mem.name] = { head: v.git!.head, branch: v.git!.branch };
    }
    const seed = path.join(this.deps.store.runDir(runId), 'memory-seed');
    const version = copySeed(seed);
    this.record(runId, 'step.ok', {
      step: 'memory.start',
      data: { seed, seedVersion: version, workspace, storeDir, bases },
    });
  }

  private async runMemoryStoreAgent(runId: string, phase: 'discover' | 'install'): Promise<void> {
    const s = this.state(runId);
    const m = s.input.memory!;
    const start = s.steps['memory.start']!.data as {
      seed: string;
      workspace: string;
      storeDir: string;
    };
    const manifest = this.entries(runId).findLast((e) => e.type === 'memory.manifest') as
      { yaml?: string; members?: string[] } | undefined;
    const agent = this.cfg().agents?.primary ?? 'claude';
    const caps = await this.deps.handoff!.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    if (!caps.flags.allowedTools)
      throw new ParkError(
        'checks_unenforceable',
        `${AGENT_ADAPTERS[agent]} cannot restrict which commands an agent runs, so it cannot install memory`,
      );
    const model = m.model ?? MEMORY_DEFAULT_MODEL;
    const effort = m.effort ?? MEMORY_DEFAULT_EFFORT;
    if (!caps.flags.effort)
      this.record(runId, 'step.warn', {
        step: `memory.${phase}.effort`,
        message: `${AGENT_ADAPTERS[agent]} has no flag for reasoning effort, so "${effort}" was not applied`,
      });
    const dirs = [
      ...(phase === 'install' ? (manifest?.members ?? []) : m.members!.map((x) => x.name)).map(
        (n) => path.join(start.workspace, n),
      ),
      ...(phase === 'install' ? [start.storeDir] : []),
    ];
    const ceilings = { ...DEFAULT_RUN_CEILINGS };
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(caps, ceilings, memoryStoreAllowedTools(dirs, phase), model, {
        addDirs: [start.seed],
        effort,
        available: MEMORY_AVAILABLE_TOOLS,
        isolateSettings: true,
      }),
      // Without `--tools` a Windows session still has the PowerShell tool, which no allow rule covers (plan 079 WI-1, store).
      env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' },
      model,
      cwd: start.workspace,
      planPath: path.join(start.seed, 'playbooks', 'deploy-system.md'),
      ceilings,
      unenforceable: [],
    };
    const prompt = memoryStorePrompt({
      phase,
      workspace: start.workspace,
      seed: start.seed,
      system: m.system,
      entry: m.members![0]!.dir,
      terms: m.isolationTerms,
      today: this.deps.clock.now().toISOString().slice(0, 10),
      storeCommitPolicy: m.storeCommitPolicy ?? 'pr',
      ...(m.storeRemote ? { storeRemote: m.storeRemote } : {}),
      ...(phase === 'install' && manifest?.yaml ? { manifest: manifest.yaml } : {}),
    });
    let last = 0;
    const out = await this.runHandoff(
      runId,
      plan,
      prompt,
      null,
      { mode: 'none', commands: [] },
      {
        onProgress: (p) => {
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
        summaryMax: 20_000,
      },
    );
    if (out.stopped) throw new InterruptedError(`run ${runId} was stopped`);
    const report = agentReport(out);
    if (phase === 'discover') {
      if (report.tripped || report.exitCode !== 0)
        throw new ParkError(
          'memory_rules_broken',
          `the discovery did not finish (${report.tripped ? `run limit ${report.tripped}` : `exit code ${report.exitCode}`}). Resume to run it again, or cancel the run.`,
          { problems: ['the discovery did not finish'] },
        );
      this.record(runId, 'step.ok', {
        step: 'memory.discover',
        data: {
          proposed: parseProposedManifest(report.summary),
          evidence: report.summary,
          effortApplied: Boolean(caps.flags.effort),
        },
      });
      return;
    }
    this.record(runId, 'step.ok', {
      step: 'memory.agent',
      data: { ...report, effortApplied: Boolean(caps.flags.effort) },
    });
  }

  /**
   * After the store agent: what Claude Code refuses it to write in every repository (`.claude/` and `.git/`). The
   * Incubator installs each member's SessionEnd hook, its settings and this machine's store path, and the store's git
   * hook, then runs the playbook's verification steps 5 and 6 (plan 079 WI-1). Safe to run again on resume.
   */
  private async installMemorySystem(runId: string): Promise<void> {
    const s = this.state(runId);
    if (s.steps['memory.system.protected']?.status === 'ok') return;
    const agent = s.steps['memory.agent']!.data as AgentReport;
    const report = parseMemoryReport(agent.summary);
    // Nothing is installed on a run the agent left unfinished or unverified: `checkMemoryStore` parks with the reason.
    if (agent.tripped || agent.exitCode !== 0 || !report?.verificationPassed) return;
    const start = s.steps['memory.start']!.data as {
      seed: string;
      workspace: string;
      storeDir: string;
    };
    const manifest = this.entries(runId).findLast((e) => e.type === 'memory.manifest') as
      { yaml?: string; members?: string[] } | undefined;
    const members = (manifest?.members ?? []).map((name) => ({
      name,
      dir: path.join(start.workspace, name),
    }));
    if (
      !members.length ||
      !existsSync(path.join(start.storeDir, 'INDEX.md')) ||
      members.some((x) => !existsSync(path.join(x.dir, '.memory-link')))
    )
      return;
    const result = await installMemorySystemProtected({
      exec: this.deps.handoff!.exec,
      git: this.deps.publish!.git,
      seed: start.seed,
      store: start.storeDir,
      members,
      selfTests: this.deps.memorySelfTests !== false,
      ...(this.sig(runId).signal ? { signal: this.sig(runId).signal } : {}),
    });
    const failed = result.checks.filter((c) => c.status === 'failed');
    if (failed.length)
      throw new ParkError(
        'memory_verify_failed',
        `the Incubator's own checks of the store install failed, so nothing was pushed: ${failed
          .map((c) => `${c.step} (${c.detail})`)
          .join('; ')}. Fix the install and resume, or cancel the run.`,
        { problems: failed.map((c) => `${c.step}: ${c.detail}`) },
      );
    this.record(runId, 'step.ok', { step: 'memory.system.protected', data: result });
  }

  /** The Incubator's own checks of a store-mode install (spec rules 2 and 4a, ground rules 2 and 3). */
  private async checkMemoryStore(runId: string): Promise<MemoryStoreDone> {
    const s = this.state(runId);
    const git = this.deps.publish!.git;
    const m = s.input.memory!;
    const start = s.steps['memory.start']!.data as {
      seedVersion: string;
      workspace: string;
      storeDir: string;
      bases: Record<string, { head: string | null; branch: string | null }>;
    };
    const manifest = this.entries(runId).findLast(
      (e) => e.type === 'memory.manifest',
    ) as unknown as { yaml: string; members: string[] };
    const agent = s.steps['memory.agent']!.data as AgentReport;
    const report = parseMemoryReport(agent.summary);
    const problems: string[] = [];
    if (agent.tripped) problems.push(`the agent stopped at a run limit (${agent.tripped})`);
    else if (agent.exitCode !== 0) problems.push(`the agent exited with code ${agent.exitCode}`);
    if (!report) problems.push("the agent did not end with the playbook's report");
    const storePolicy = m.storeCommitPolicy ?? 'pr';
    const store = start.storeDir;
    for (const f of ['system.yaml', 'memory.conf', 'INDEX.md'])
      if (!existsSync(path.join(store, f))) problems.push(`the store has no ${f}`);
    const conf = existsSync(path.join(store, 'memory.conf'))
      ? readFileSync(path.join(store, 'memory.conf'), 'utf8')
      : '';
    const confPolicy = /^\s*commit_policy\s*=\s*(pr|direct)\s*$/m.exec(conf)?.[1];
    if (confPolicy !== storePolicy)
      problems.push(
        `the store's memory.conf names the ${confPolicy ?? 'no'} policy, but ${storePolicy} was chosen`,
      );
    const storeLeft = existsSync(path.join(store, '.git')) ? await git.status(store) : [];
    if (storeLeft.length)
      problems.push(
        `the store has uncommitted changes: ${storeLeft
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    const storeBranch = existsSync(path.join(store, '.git'))
      ? await git.currentBranch(store)
      : null;
    const storeHead = existsSync(path.join(store, '.git')) ? await git.headSha(store) : null;
    const wantBranch = storePolicy === 'pr' ? MEMORY_BRANCH : 'main';
    if (storeBranch !== wantBranch)
      problems.push(
        `the ${storePolicy} policy leaves the store on ${wantBranch}, but it is on ${storeBranch ?? 'no branch'}`,
      );
    const members: MemoryStoreDone['members'] = [];
    for (const name of manifest.members) {
      const dir = path.join(start.workspace, name);
      const base = start.bases[name] ?? {
        head: await git.headSha(dir),
        branch: await git.currentBranch(dir),
      };
      const left = (await git.status(dir)).filter((e) => e.path !== '.claude/settings.local.json');
      if (left.length)
        problems.push(
          `${name}: uncommitted changes were left: ${left
            .slice(0, 8)
            .map((e) => e.path)
            .join(', ')}`,
        );
      const head = await git.headSha(dir);
      const branch = await git.currentBranch(dir);
      const changed =
        head && base.head && head !== base.head
          ? (await git.diffNameStatus(dir, base.head, head)).map(([, p]) => p)
          : [];
      if (changed.length === 0) problems.push(`${name}: nothing was committed`);
      if (changed.includes('AGENTS.md'))
        problems.push(`${name}: AGENTS.md was changed (it never may be)`);
      const outside = changed.filter((p) => !allowedMemberPath(p));
      if (outside.length)
        problems.push(`${name}: files outside the link changed: ${outside.slice(0, 8).join(', ')}`);
      if (!existsSync(path.join(dir, '.memory-link')))
        problems.push(`${name}: .memory-link does not exist`);
      const linked = branch === 'memory/link' ? 'pr' : branch === base.branch ? 'direct' : null;
      if (!linked)
        problems.push(
          `${name}: on ${branch ?? 'a detached HEAD'}, expected ${base.branch ?? 'its own branch'} or memory/link`,
        );
      members.push({
        name,
        dir,
        branch: branch ?? '',
        head: head ?? '',
        policy: linked ?? 'direct',
      });
    }
    this.record(runId, 'memory.result', {
      problems,
      report: report?.text ?? agent.summary,
      policy: storePolicy,
      branch: storeBranch,
      verificationPassed: report?.verificationPassed ?? false,
      kept: report?.kept ?? [],
      dropped: report?.dropped ?? [],
    });
    if (problems.length)
      throw new ParkError(
        'memory_rules_broken',
        `the install broke a rule, so nothing was pushed: ${problems.join('; ')}. Fix the folders and resume, or cancel the run.`,
        { problems },
      );
    if (!report!.verificationPassed)
      throw new ParkError(
        'memory_verify_failed',
        "the playbook's own verification did not all pass (see its report), so nothing was pushed. Fix the install and resume, or cancel the run.",
      );
    return {
      seedVersion: start.seedVersion,
      policy: storePolicy,
      branch: storeBranch!,
      head: storeHead!,
      report: report!.text,
      kept: report!.kept,
      dropped: report!.dropped,
      storeDir: store,
      manifest: manifest.yaml,
      members,
    };
  }

  /**
   * PUSH for a store-mode run: the store and every link stay local commits (the Incubator pushes nothing and
   * opens no pull request in store mode); the portfolio learns the system and each member's record.
   */
  private async memoryStorePushStep(runId: string, s: RunState): Promise<void> {
    const done = s.steps['memory.done']!.data as MemoryStoreDone;
    const m = s.input.memory!;
    const pf = this.deps.portfolio;
    const today = this.deps.clock.now().toISOString().slice(0, 10);
    if (pf) {
      const linked: { name: string; dir: string; projectId: string | null }[] = [];
      for (const mem of done.members) {
        let project = await this.portfolioFor(path.resolve(mem.dir));
        if (!project)
          project = pf.create({
            name: mem.name,
            summary: '',
            origin: 'existing',
            repo: { dir: mem.dir, remote: await this.remoteOf(mem.dir), ref: null, url: null },
            stack: null,
          });
        const record: NonNullable<PortfolioProject['memory']> = {
          mode: 'member',
          system: m.system,
          store: done.storeDir,
          seedVersion: done.seedVersion,
          commitPolicy: mem.policy,
          installedAt: today,
          report: done.report,
        };
        pf.update(project.id, (p) => {
          p.memory = record;
        });
        linked.push({ name: mem.name, dir: mem.dir, projectId: project.id });
      }
      pf.saveSystem({
        name: m.system,
        store: done.storeDir,
        remote: m.storeRemote ?? null,
        seedVersion: done.seedVersion,
        storeCommitPolicy: done.policy,
        manifest: done.manifest,
        members: linked,
      });
    }
    this.record(runId, 'memory.system', {
      system: m.system,
      store: done.storeDir,
      members: done.members.map((x) => x.name),
    });
    this.record(runId, 'run.done', { committedLocally: true, local: done.storeDir });
  }

  private memoryStoreDetail(runId: string, s: RunState): NonNullable<MemoryDetail['store']> {
    const m = s.input.memory!;
    const joinName = m.joinSystem ? path.basename(this.runDir(s)) : null;
    const discover = s.steps['memory.discover']?.data as
      { proposed?: string | null; evidence?: string } | undefined;
    const confirmed = this.entries(runId).findLast((e) => e.type === 'memory.manifest') as
      { yaml?: string } | undefined;
    const start = s.steps['memory.start']?.data as { storeDir?: string } | undefined;
    const joinStore = m.joinSystem ? this.deps.portfolio?.system(m.joinSystem)?.store : undefined;
    return {
      members: m.members ? m.members.map((x) => x.name) : [joinName ?? ''],
      proposed: discover?.proposed ?? null,
      evidence: discover?.evidence ?? null,
      confirmed: confirmed?.yaml ?? null,
      awaitingManifest: s.parked?.reason === 'memory_manifest',
      storeDir: start?.storeDir ?? joinStore ?? null,
      remote: m.storeRemote ?? null,
    };
  }

  // --- Add member (plan 077): one more repository joins a system that already has a store --------------------

  /** The repository, the system and the store of an Add member run (an existing repo, or a new build joining). */
  private memberFacts(runId: string): MemberFacts {
    const s = this.state(runId);
    const build = s.input.kind === 'new';
    const system = build
      ? ((
          this.entries(runId).find((e) => e.type === 'memory.plan') as
            { plan?: MemoryPlan } | undefined
        )?.plan?.system ?? '')
      : (s.input.memory?.joinSystem ?? '');
    const known = this.deps.portfolio?.system(system);
    if (!known || !existsSync(known.store))
      throw new ParkError(
        'memory_system_missing',
        `the memory store of the system "${system}" is not on this computer any more, so the repository cannot join it`,
      );
    const dir = this.runDir(s);
    return {
      dir,
      name: path.basename(dir),
      system,
      store: known.store,
      storePolicy: known.storeCommitPolicy,
      members: known.members.map((x) => x.name),
      build,
    };
  }

  /** CODE for an Add member run on an existing repository (plan 077): the whole "Adding a member later". */
  private async memoryMemberRun(runId: string, s: RunState): Promise<void> {
    if (s.steps['memory.member.full']?.status === 'ok') return this.enter(runId, 'PUSH');
    if (!this.deps.publish?.git || !this.deps.handoff)
      throw new ToolError('Add memory needs git and a coding agent CLI');
    await this.effect(runId, () => this.memoryMemberSession(runId, 'full'));
    this.enter(runId, 'PUSH');
  }

  /** PUSH for an Add member run: the store and the link stay local commits; the portfolio already knows the member. */
  private memoryMemberPushStep(runId: string, s: RunState): void {
    const done = s.steps['memory.member.full']!.data as { store: string };
    this.record(runId, 'run.done', { committedLocally: true, local: done.store });
  }

  /**
   * One Add member session, with the Incubator's checks. Always parks `memory_manifest` first, showing the
   * store's `system.yaml` with the new member added: the owner confirms it before anything is written.
   */
  private async memoryMemberSession(runId: string, phase: MemoryMemberPhase): Promise<void> {
    const key = `memory.member.${phase}`;
    if (this.state(runId).steps[key]?.status === 'ok') return;
    const git = this.deps.publish!.git;
    if (!this.deps.handoff) throw new ToolError('a build with memory needs a coding agent CLI');
    const f = this.memberFacts(runId);
    if (
      phase === 'bootstrap' &&
      (this.state(runId).steps['memory.member.link']?.data as { skipped?: boolean } | undefined)
        ?.skipped
    ) {
      this.record(runId, 'step.ok', { step: key, data: { skipped: true } });
      return;
    }
    if (this.state(runId).steps[`${key}.start`]?.status !== 'ok') {
      if (phase !== 'bootstrap') {
        const v = await inspectFolder(git, f.dir, 'existing');
        if (!f.build && !v.ok)
          throw new ParkError(
            v.git && !v.git.clean ? 'dirty_tree' : 'folder_invalid',
            `${f.name}: ${v.problems.join(' ')}`,
            { path: v.path, changed: v.git?.changed ?? [] },
          );
        if (f.members.includes(f.name))
          throw new ParkError('memory_installed', `${f.name} is already a member of ${f.system}`);
        if (existsSync(path.join(f.dir, '.memory')) || existsSync(path.join(f.dir, '.memory-link')))
          throw new ParkError(
            'memory_present',
            `${f.name} already has .memory/ or .memory-link: joining a system is a first install`,
          );
        if ((await git.status(f.store)).length)
          throw new ParkError(
            'dirty_tree',
            `the store ${f.store} has uncommitted changes: commit or discard them first`,
          );
        if (!(await git.identity(f.dir))) {
          const why =
            'git does not know who you are, so the memory link was not made: set user.name and user.email, then run Add memory on this repository';
          if (!f.build) throw new ParkError('no_git_identity', why);
          // why: a build that worked without memory must not stop because git has no author.
          this.record(runId, 'step.warn', { step: `${key}.skipped`, message: why });
          this.record(runId, 'step.ok', { step: key, data: { skipped: true, reason: why } });
          return;
        }
      }
      const seed = path.join(this.deps.store.runDir(runId), 'memory-seed');
      const version = existsSync(path.join(seed, 'VERSION')) ? seedVersion(seed) : copySeed(seed);
      this.record(runId, 'step.ok', {
        step: `${key}.start`,
        data: {
          seed,
          seedVersion: version,
          storeHead: await git.headSha(f.store),
          storeBranch: await git.currentBranch(f.store),
          memberHead: await git.headSha(f.dir),
          memberBranch: await git.currentBranch(f.dir),
        },
      });
    }
    const confirmed = this.entries(runId).findLast(
      (e) => e.type === 'memory.manifest',
    ) as unknown as { yaml: string } | undefined;
    if (!confirmed && phase !== 'bootstrap') {
      const proposed = proposeMemberManifest(
        readFileSync(path.join(f.store, 'system.yaml'), 'utf8'),
        f.name,
        path.relative(f.store, f.dir).replace(/\\/g, '/'),
      );
      if (this.state(runId).steps['memory.discover']?.status !== 'ok')
        this.record(runId, 'step.ok', {
          step: 'memory.discover',
          data: {
            proposed,
            evidence: `Adding ${f.name} to the system ${f.system} (members now: ${f.members.join(', ')}). Only a new entry is added to the store's system.yaml.`,
          },
        });
      throw new ParkError(
        'memory_manifest',
        `${f.name} would join the system ${f.system}: confirm or edit the updated system.yaml, then resume. Nothing is written before you do.`,
        { proposed },
      );
    }
    if (!confirmed) throw new ToolError('the member manifest is missing');
    if (this.state(runId).steps[`${key}.agent`]?.status !== 'ok')
      await this.runMemoryMemberAgent(runId, phase, f, confirmed.yaml);
    if (phase !== 'bootstrap') await this.installMemoryMemberProtected(runId, phase, f);
    const result = await this.checkMemoryMember(runId, phase, f);
    this.record(runId, 'step.ok', { step: key, data: result });
    if (phase === 'bootstrap') return;
    const pf = this.deps.portfolio;
    const known = pf?.system(f.system);
    const yaml = (
      this.entries(runId).findLast((e) => e.type === 'memory.manifest') as unknown as {
        yaml: string;
      }
    ).yaml;
    if (pf && known)
      pf.saveSystem({
        name: known.name,
        store: known.store,
        remote: known.remote,
        seedVersion: known.seedVersion,
        storeCommitPolicy: known.storeCommitPolicy,
        manifest: yaml,
        members: [
          ...known.members.filter((x) => x.name !== f.name),
          { name: f.name, dir: f.dir, projectId: pf.forRun(runId)?.id ?? null },
        ],
      });
    // why: from here on the portfolio says the solution has memory, so later update runs read the shared store.
    this.record(runId, 'memory.installed', {
      record: {
        mode: 'member',
        system: f.system,
        store: f.store,
        seedVersion: result.seedVersion,
        commitPolicy: result.memberPolicy,
        installedAt: this.deps.clock.now().toISOString().slice(0, 10),
        report:
          phase === 'full'
            ? result.report
            : 'linked; the store is filled in after the code is written',
      },
    });
  }

  private async runMemoryMemberAgent(
    runId: string,
    phase: MemoryMemberPhase,
    f: MemberFacts,
    manifest: string,
  ): Promise<void> {
    const key = `memory.member.${phase}`;
    const start = this.state(runId).steps[`${key}.start`]!.data as { seed: string };
    const agent = this.cfg().agents?.primary ?? 'claude';
    const caps = await this.deps.handoff!.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    if (!caps.flags.allowedTools || !caps.flags.addDir || !caps.flags.model)
      throw new ParkError(
        'checks_unenforceable',
        `${AGENT_ADAPTERS[agent]} cannot restrict its commands, read the memory seed and choose a model, so it cannot add a member`,
      );
    const m = this.state(runId).input.memory;
    const model = m?.model ?? MEMORY_DEFAULT_MODEL;
    const effort = m?.effort ?? MEMORY_DEFAULT_EFFORT;
    if (!caps.flags.effort)
      this.record(runId, 'step.warn', {
        step: `${key}.effort`,
        message: `${AGENT_ADAPTERS[agent]} has no flag for reasoning effort, so "${effort}" was not applied`,
      });
    const ceilings = { ...DEFAULT_RUN_CEILINGS };
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(
        caps,
        ceilings,
        memoryStoreAllowedTools([f.dir, f.store], 'install'),
        model,
        { addDirs: [start.seed], effort, available: MEMORY_AVAILABLE_TOOLS, isolateSettings: true },
      ),
      // Without `--tools` a Windows session still has the PowerShell tool, which no allow rule covers (plan 079 WI-1, member).
      env: { CLAUDE_CODE_USE_POWERSHELL_TOOL: '0' },
      model,
      cwd: path.dirname(f.store),
      planPath: path.join(start.seed, 'playbooks', 'deploy-system.md'),
      ceilings,
      unenforceable: [],
    };
    const prompt = memoryMemberPrompt({
      phase,
      system: f.system,
      repo: f.name,
      repoDir: f.dir,
      store: f.store,
      seed: start.seed,
      terms: m?.isolationTerms ?? prefillIsolationTerms(this.portfolioList(), [], f.system),
      today: this.deps.clock.now().toISOString().slice(0, 10),
      storeCommitPolicy: f.storePolicy,
      manifest,
    });
    let last = 0;
    const out = await this.runHandoff(
      runId,
      plan,
      prompt,
      null,
      { mode: 'none', commands: [] },
      {
        onProgress: (p) => {
          if (last && Date.now() - last < 1000) return;
          last = Date.now();
          this.record(runId, 'handoff.progress', { ...p });
        },
        summaryMax: 20_000,
      },
    );
    if (out.stopped) throw new InterruptedError(`run ${runId} was stopped`);
    this.record(runId, 'step.ok', {
      step: `${key}.agent`,
      data: { ...agentReport(out), effortApplied: Boolean(caps.flags.effort) },
    });
  }

  /**
   * After an Add member agent: the new member's SessionEnd hook, settings and this machine's store path, which Claude
   * Code refuses the agent to write (plan 079 WI-1). The store's git hook is already installed. Safe to run again.
   */
  private async installMemoryMemberProtected(
    runId: string,
    phase: MemoryMemberPhase,
    f: MemberFacts,
  ): Promise<void> {
    const key = `memory.member.${phase}`;
    const s = this.state(runId);
    if (s.steps[`${key}.protected`]?.status === 'ok') return;
    const agent = s.steps[`${key}.agent`]!.data as AgentReport;
    if (agent.tripped || agent.exitCode !== 0) return;
    if (!existsSync(path.join(f.dir, '.memory-link'))) return;
    const start = s.steps[`${key}.start`]!.data as { seed: string };
    const result = await installMemorySystemProtected({
      exec: this.deps.handoff!.exec,
      git: this.deps.publish!.git,
      seed: start.seed,
      store: f.store,
      members: [{ name: f.name, dir: f.dir }],
      storeHook: false,
      selfTests: phase === 'full' && this.deps.memorySelfTests !== false,
      ...(this.sig(runId).signal ? { signal: this.sig(runId).signal } : {}),
    });
    const failed = result.checks.filter((c) => c.status === 'failed');
    if (failed.length)
      throw new ParkError(
        'memory_verify_failed',
        `the Incubator's own checks of the new member failed, so nothing was pushed: ${failed
          .map((c) => `${c.step} (${c.detail})`)
          .join('; ')}. Fix the install and resume, or cancel the run.`,
        { problems: failed.map((c) => `${c.step}: ${c.detail}`) },
      );
    this.record(runId, 'step.ok', { step: `${key}.protected`, data: result });
  }

  /** The Incubator's own checks of one Add member session: the link only touches the allowed paths, the store only moves forward. */
  private async checkMemoryMember(
    runId: string,
    phase: MemoryMemberPhase,
    f: MemberFacts,
  ): Promise<{ seedVersion: string; report: string; memberPolicy: 'pr' | 'direct' }> {
    const key = `memory.member.${phase}`;
    const s = this.state(runId);
    const git = this.deps.publish!.git;
    const start = s.steps[`${key}.start`]!.data as {
      seedVersion: string;
      storeHead: string | null;
      storeBranch: string | null;
      memberHead: string | null;
      memberBranch: string | null;
    };
    const agent = s.steps[`${key}.agent`]!.data as AgentReport;
    const report = phase === 'link' ? null : parseMemoryReport(agent.summary);
    const problems: string[] = [];
    if (agent.tripped) problems.push(`the agent stopped at a run limit (${agent.tripped})`);
    else if (agent.exitCode !== 0) problems.push(`the agent exited with code ${agent.exitCode}`);
    if (phase !== 'link' && !report)
      problems.push("the agent did not end with the playbook's report");
    const storeLeft = await git.status(f.store);
    if (storeLeft.length)
      problems.push(
        `the store has uncommitted changes: ${storeLeft
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    const storeHead = await git.headSha(f.store);
    const storeBranch = await git.currentBranch(f.store);
    if (!storeHead || storeHead === start.storeHead)
      problems.push('nothing was committed to the store');
    if (storeBranch !== start.storeBranch && !storeBranch?.startsWith('memory/'))
      problems.push(
        `the store was on ${start.storeBranch ?? 'a detached HEAD'} and is now on ${storeBranch ?? 'a detached HEAD'}`,
      );
    if (
      phase !== 'bootstrap' &&
      !new RegExp(
        `^\\s*-\\s*repo:\\s*${f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
        'm',
      ).test(
        existsSync(path.join(f.store, 'system.yaml'))
          ? readFileSync(path.join(f.store, 'system.yaml'), 'utf8')
          : '',
      )
    )
      problems.push(`the store's system.yaml does not list ${f.name}`);
    const left = (await git.status(f.dir)).filter(
      (e) =>
        e.path !== '.claude/settings.local.json' &&
        (phase !== 'bootstrap' || allowedMemberPath(e.path)),
    );
    if (left.length && phase !== 'bootstrap')
      problems.push(
        `${f.name}: uncommitted changes were left: ${left
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    if (left.length && phase === 'bootstrap')
      problems.push(
        `${f.name}: memory files were left uncommitted: ${left
          .slice(0, 8)
          .map((e) => e.path)
          .join(', ')}`,
      );
    const head = await git.headSha(f.dir);
    const branch = await git.currentBranch(f.dir);
    const changed =
      head && start.memberHead && head !== start.memberHead
        ? (await git.diffNameStatus(f.dir, start.memberHead, head)).map(([, p]) => p)
        : [];
    if (phase !== 'bootstrap' && changed.length === 0)
      problems.push(`${f.name}: nothing was committed`);
    if (changed.includes('AGENTS.md'))
      problems.push(`${f.name}: AGENTS.md was changed (it never may be)`);
    const outside = changed.filter((p) => !allowedMemberPath(p));
    if (outside.length)
      problems.push(`${f.name}: files outside the link changed: ${outside.slice(0, 8).join(', ')}`);
    if (phase !== 'bootstrap') {
      const link = path.join(f.dir, '.memory-link');
      if (
        !existsSync(link) ||
        !new RegExp(`^system=${f.system}\\s*$`, 'm').test(readFileSync(link, 'utf8'))
      )
        problems.push(`${f.name}: .memory-link does not name the system ${f.system}`);
    }
    const memberPolicy: 'pr' | 'direct' = branch === 'memory/link' ? 'pr' : 'direct';
    if (branch !== start.memberBranch && branch !== 'memory/link')
      problems.push(
        `${f.name}: on ${branch ?? 'a detached HEAD'}, expected ${start.memberBranch ?? 'its own branch'} or memory/link`,
      );
    const text = report?.text ?? agent.summary ?? '';
    this.record(runId, 'memory.result', {
      phase,
      problems,
      report: text,
      policy: f.storePolicy,
      branch: storeBranch,
      verificationPassed: report?.verificationPassed ?? true,
      kept: report?.kept ?? [],
      dropped: report?.dropped ?? [],
    });
    if (problems.length)
      throw new ParkError(
        'memory_rules_broken',
        `adding ${f.name} broke a rule: ${problems.join('; ')}. Fix the folders and resume, or cancel the run.`,
        { problems },
      );
    if (phase !== 'link' && !report!.verificationPassed)
      throw new ParkError(
        'memory_verify_failed',
        "the playbook's own verification did not all pass (see its report). Fix the store and resume, or cancel the run.",
      );
    return { seedVersion: start.seedVersion, report: text, memberPolicy };
  }

  /** The run page's view of an Add memory run (plan 071); null for other runs. */
  memoryDetail(runId: string): MemoryDetail | null {
    const s = this.state(runId);
    const m = s.input.memory;
    // A new build that joins a system parks for the owner's manifest in the middle of its code step (plan 077).
    if (
      s.input.kind === 'new' &&
      s.parked?.reason === 'memory_manifest' &&
      this.buildMemoryMode(runId) === 'member'
    ) {
      const f = this.memberFacts(runId);
      const found = s.steps['memory.discover']?.data as
        { proposed?: string | null; evidence?: string } | undefined;
      return {
        stage: 'checks',
        dir: f.dir,
        system: f.system,
        isolationTerms: [],
        seedVersion: null,
        policy: null,
        branch: null,
        report: null,
        verificationPassed: null,
        kept: [],
        dropped: [],
        problems: [],
        effortApplied: null,
        target: { repo: null, reason: null },
        store: {
          members: [f.name],
          proposed: found?.proposed ?? null,
          evidence: found?.evidence ?? null,
          confirmed: null,
          awaitingManifest: true,
          storeDir: f.store,
          remote: null,
        },
        pr: null,
        pushed: false,
        progress: null,
      };
    }
    if (s.input.kind !== 'memory' || !m) return null;
    const at = s.state === 'PARKED' ? s.parked?.state : s.state;
    const entries = this.entries(runId);
    const result = entries.findLast((e) => e.type === 'memory.result');
    const agent = s.steps['memory.agent']?.data as { effortApplied?: boolean } | undefined;
    const progress = entries.findLast((e) => e.type === 'handoff.progress');
    const pr = entries.findLast((e) => e.type === 'finish.summary')?.['pr'] as
      { number: number; url: string } | undefined;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    const stage: MemoryDetail['stage'] = s.done
      ? 'done'
      : at === 'PUSH'
        ? 'push'
        : result && s.parked?.reason.startsWith('memory_')
          ? 'checks'
          : 'running';
    return {
      stage,
      dir: s.input.dir ?? '',
      system: m.system,
      isolationTerms: m.isolationTerms,
      seedVersion:
        (s.steps['memory.start']?.data as { seedVersion?: string } | undefined)?.seedVersion ??
        null,
      policy: (result?.['policy'] as 'pr' | 'direct' | null | undefined) ?? null,
      branch: (result?.['branch'] as string | null | undefined) ?? null,
      report: typeof result?.['report'] === 'string' ? result['report'] : null,
      verificationPassed:
        typeof result?.['verificationPassed'] === 'boolean' ? result['verificationPassed'] : null,
      kept: strings(result?.['kept']),
      dropped: strings(result?.['dropped']),
      problems: strings(result?.['problems']),
      effortApplied: agent ? agent.effortApplied !== false : null,
      target:
        m.members || m.joinSystem
          ? { repo: null, reason: 'store mode keeps everything local' }
          : this.pushTarget(runId, s),
      store: m.members || m.joinSystem ? this.memoryStoreDetail(runId, s) : null,
      pr: pr ?? null,
      pushed: s.steps['memory.push']?.status === 'ok' || s.steps['memory.pr']?.status === 'ok',
      progress:
        stage === 'running' && progress
          ? {
              turns: Number(progress['turns'] ?? 0),
              toolCalls: Number(progress['toolCalls'] ?? 0),
              costUsd: typeof progress['costUsd'] === 'number' ? progress['costUsd'] : null,
              snippet: typeof progress['snippet'] === 'string' ? progress['snippet'] : null,
            }
          : null,
    };
  }

  /**
   * Prepares `incubator handoff`: the repository (scaffold-only output, or a fresh clone of the
   * published repo), the agent's headless argv from its probed capabilities, the ceilings and the
   * prompt with the executor plan inlined.
   */
  async prepareHandoff(
    runId: string,
    opts: { agent?: HandoffAgent; continuation?: Parameters<typeof continuationText>[0] } = {},
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
    // The owner's own choice (Settings, ADR-029) wins over what the spec says; unset means the spec decides.
    const chosen = this.cfg().agents;
    const agent = opts.agent ?? chosen?.primary ?? spec.agents.primary;
    const codingModel = chosen?.model ?? null;
    const caps = await this.deps.handoff.probe(AGENT_ADAPTERS[agent]);
    if (!caps.installed || !caps.path)
      throw new PolicyError(`${AGENT_ADAPTERS[agent]} is not installed`, { code: 'agent_missing' });
    const c = spec.agents.runCeilings;
    const ceilings = {
      turns: c.turns > 0 ? c.turns : DEFAULT_RUN_CEILINGS.turns,
      toolCalls: c.toolCalls > 0 ? c.toolCalls : 400,
      minutes: c.minutes > 0 ? c.minutes : DEFAULT_RUN_CEILINGS.minutes,
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
    // ADR-030: read before anything starts, so a missing contract parks the run instead of coding without it.
    const contract = this.backshackContract(s);
    const tools = this.tools();
    const env = external && tools ? await toolPathEnv(checks.commands, tools) : null;
    const plan: HandoffPlan = {
      agent,
      bin: caps.path,
      argv: buildHandoffArgv(
        caps,
        ceilings,
        external ? externalTools(checks.commands) : undefined,
        codingModel ?? undefined,
        // why: the allow list names Bash commands only. With the PowerShell tool on offer the agent used it and
        // every `node scripts/check.mjs` was refused, and the operator's user-level hooks make allowed Bash
        // commands unverifiable, so the coding session offers Bash alone and ignores user settings.
        { available: MEMORY_AVAILABLE_TOOLS, isolateSettings: true },
      ),
      ...(codingModel ? { model: codingModel } : {}),
      cwd: repo,
      planPath,
      ceilings,
      ...(env ? { env } : {}),
      unenforceable: [],
    };
    // Plan 071 (spec §6): a solution with memory reads it first and writes back to it at the end.
    const memory = this.deps.portfolio?.forRun(runId)?.memory;
    const built = this.state(runId).steps['memory.scaffold']?.status === 'ok';
    const linked = this.state(runId).steps['memory.member.link'];
    const memberBuilt =
      linked?.status === 'ok' &&
      (linked.data as { skipped?: boolean } | undefined)?.skipped !== true;
    // Plan 076: a member of a system reads the shared store its `.memory-link` points to.
    const store = memory ? memoryStoreFor(repo, memory.store) : null;
    const memoryLine = built
      ? memoryBuildLine(REPO_STORE)
      : memberBuilt && store
        ? memoryBuildLine(store)
        : memory && store
          ? memoryConsumptionLine(store)
          : '';
    return {
      plan,
      prompt:
        (memoryLine
          ? `${memoryLine}

`
          : '') +
        handoffPrompt(
          readFileSync(planPath, 'utf8'),
          external ? { checks: checks.commands } : undefined,
          contract !== null ? { contract } : undefined,
        ) +
        (opts.continuation ? `\n${continuationText(opts.continuation)}` : ''),
      ticket: activeTicket(repo, spec, delivered?.features.map(ticketId)),
      checks,
    };
  }

  /** `incubator handoff --launch`: runs the agent headless, bounded by the ceilings, logged per run. */
  async launchHandoff(
    runId: string,
    opts: {
      agent?: HandoffAgent;
      /** A continuing part (plan 036): the prompt then lists what the earlier parts committed. */
      continuation?: Parameters<typeof continuationText>[0];
      onEvent?: (chunk: string) => void;
      onProgress?: (p: HandoffProgress) => void;
      /** Stops the agent; when absent the run's own stop (Stop in the app) applies. */
      signal?: AbortSignal;
    } = {},
  ): Promise<HandoffOutcome> {
    const { plan, prompt, ticket, checks } = await this.prepareHandoff(runId, opts);
    // why: `incubator handoff --launch` runs the agent outside `advance`; a stop (Ctrl+C) must still reach it.
    const own = !this.#active.has(runId);
    if (own) this.#active.set(runId, { controller: new AbortController(), by: null });
    try {
      return await this.runHandoff(runId, plan, prompt, ticket, checks, opts);
    } finally {
      if (own) this.#active.delete(runId);
    }
  }

  private async runHandoff(
    runId: string,
    plan: HandoffPlan,
    prompt: string,
    ticket: string | null,
    checks: AgentChecks,
    opts: {
      onEvent?: (chunk: string) => void;
      onProgress?: (p: HandoffProgress) => void;
      signal?: AbortSignal;
      summaryMax?: number;
    },
  ): Promise<HandoffOutcome> {
    this.record(runId, 'handoff.launch', {
      agent: plan.agent,
      argv: plan.argv,
      model: plan.model ?? null,
      ceilings: plan.ceilings,
      ticket,
      checks,
    });
    const outcome = await launchHandoff(this.deps.handoff!.exec, plan, prompt, {
      logFile: path.join(this.deps.store.runDir(runId), 'logs', 'handoff.log'),
      ticket,
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
      ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      ...(opts.signal ? { signal: opts.signal } : this.sig(runId)),
      ...(opts.summaryMax ? { summaryMax: opts.summaryMax } : {}),
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
    // why: answers given before a refresh (plan 025) are asked again, not taken as decisions.
    const cut = this.since(runId);
    for (const e of this.entries(runId)) {
      if (e.seq <= cut) continue;
      if (e.type === 'answers') answers.push(...(e['answers'] as Answer[]));
      if (e.type === 'answers.superseded') {
        // why: a field the owner corrected at review no longer takes the answer given before it (plan 021).
        const gone = new Set(e['keys'] as string[]);
        answers.splice(0, answers.length, ...answers.filter((a) => !gone.has(a.key)));
      }
      if (e.type === 'questions')
        for (const q of e['questions'] as AskedQuestion[])
          questions.set(q.key, {
            question: q.question,
            labels: Object.fromEntries(q.options.map((o) => [o.value, o.label])),
          });
    }
    return { answers, questions };
  }

  /**
   * After a refresh (plan 026): every question the owner answered before it, in the order first asked, with
   * its exact options and the earlier answer marked recommended. Answers given before a correction at review
   * are not carried: the correction travels in the confirmed request and may override any of them (request.*
   * keys are never superseded field by field).
   */
  private carriedQuestions(runId: string): AskedQuestion[] {
    const cut = this.since(runId);
    const asked = new Map<string, AskedQuestion>();
    const answered = new Map<string, string>();
    for (const e of this.entries(runId)) {
      if (e.seq >= cut) break;
      if (e.type === 'questions')
        for (const q of e['questions'] as AskedQuestion[]) asked.set(q.key, q);
      if (e.type === 'answers')
        for (const a of e['answers'] as Answer[]) answered.set(a.key, a.value);
      if (e.type === 'answers.superseded')
        for (const key of e['keys'] as string[]) answered.delete(key);
      // why: a correction at review may override any earlier answer; it travels in the confirmed request.
      if (e.type === 'review.feedback') answered.clear();
    }
    const out: AskedQuestion[] = [];
    for (const [key, q] of asked) {
      const value = answered.get(key);
      if (value === undefined || !q.options.some((o) => o.value === value)) continue;
      out.push({ ...q, options: q.options.map((o) => ({ ...o, recommended: o.value === value })) });
    }
    return out;
  }

  /** The latest answer to each question before the latest refresh (plan 027), with its source. */
  private answersBeforeRefresh(runId: string): Map<string, Answer> {
    const cut = this.since(runId);
    const out = new Map<string, Answer>();
    for (const e of this.entries(runId)) {
      if (e.seq >= cut) break;
      if (e.type === 'answers') for (const a of e['answers'] as Answer[]) out.set(a.key, a);
    }
    return out;
  }

  /** The text `intent.narrative` carries: the owner's change request on an update run, else the idea. */
  private narrativeFor(runId: string, s: RunState): string {
    return s.input.kind === 'enhance' ? this.requestText(runId) : (s.input.narrative ?? '');
  }

  /**
   * Plan 054: a new project is owned by the GitHub account of the token, so the model is never asked who owns it.
   * Skipped when publishing is not configured, when no account can be read, or when an owner is already set or decided.
   */
  private async defaultOwner(runId: string, s: RunState): Promise<void> {
    if (s.input.kind !== 'new' || !this.deps.publish) return;
    const draft = this.draft(runId);
    const decisions = draft.decisions ?? [];
    const project = (draft['project'] ?? {}) as { owner?: { login?: string } };
    if (project.owner?.login || decisions.some((d) => d.key.startsWith('project.owner'))) return;
    const login = await this.publisher().accountLogin();
    if (!login) return;
    this.writeRevision(runId, {
      ...draft,
      project: { ...project, owner: { type: 'user', login } },
      decisions: [
        ...decisions,
        {
          key: 'project.owner.type',
          question: 'Who owns the GitHub repository?',
          answer: 'user',
          source: 'default',
        },
        {
          key: 'project.owner.login',
          question: 'Which GitHub account owns the repository?',
          answer: login,
          source: 'default',
        },
      ],
    });
  }

  private async draftStep(runId: string, s: RunState): Promise<void> {
    await this.defaultOwner(runId, s);
    const adapter = await this.deps.llm.select(
      'discovery',
      s.input.adapter as LlmAdapterId | undefined,
    );
    const enhance = s.input.kind === 'enhance';
    const prompt = loadPrompt(enhance ? 'enhance' : 'discovery');
    const before = this.draft(runId);
    const narrative = this.narrativeFor(runId, s);
    const baseline = enhance ? this.enhanceBaseline(runId) : [];
    const corrections = this.reviewFeedback(runId);
    const user = buildUserPrompt({
      round: s.round,
      narrative,
      ...(enhance ? { narrativeHeading: 'Change request', enhance: true } : {}),
      analysis: enhance ? scanDigest(this.readScan(runId)) : null,
      draft: enhance ? withoutTargets(before) : before,
      decisions: before.decisions ?? [],
      ...(corrections.length ? { corrections } : {}),
    });
    const gate = await complete<DiscoveryTurn>(
      adapter,
      {
        schemaName: 'DiscoveryTurn',
        schema: discoveryTurnWireSchema,
        system: prompt.body,
        user,
        promptVersion: prompt.version,
        timeoutMs: this.llmTimeout(),
        ...this.sig(runId),
      },
      {
        log: this.deps.log,
        extraCheck: (turn) => [
          ...questionIssues(turn.questions, { enhance }),
          ...attributionIssues(before, turn, { nameKey: enhance }),
          ...(enhance
            ? [...featureIssues(turn.draftSpec, baseline), ...outsideIntentIssues(before, turn)]
            : [...otherIssues(turn), ...deployClassIssues(before, turn)]),
        ],
      },
    );
    // Plan 050: targets come from the scan; ones the model set are dropped here, before the merge.
    const turn = enhance
      ? { ...gate.value, draftSpec: withoutTargets(gate.value.draftSpec) }
      : gate.value;
    this.record(runId, 'llm.turn', {
      round: s.round,
      adapter: adapter.id,
      model: gate.model ?? null,
      attempts: gate.attempts,
      costUsd: gate.costUsd,
      questions: turn.questions.length,
      done: turn.done,
    });
    let base = before;
    if (corrections.length) {
      // why: after the owner's corrections, a field this turn changed wins over an answer given before
      // review, and that answer no longer stands as the owner's decision.
      const keys = supersededAnswers(before, turn, this.answers(runId).answers);
      if (keys.length) {
        this.record(runId, 'answers.superseded', { keys });
        base = {
          ...before,
          decisions: (before.decisions ?? []).filter((d) => !keys.includes(d.key)),
        };
      }
    }
    const { answers, questions } = this.answers(runId);
    const merged = mergeTurn({
      before: base,
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
    // why: an earlier answer confirmed after a refresh (plan 026) keeps the source it had then, even when --yes took
    // it now: the owner's choice stays the owner's, and a default the owner never chose stays a default.
    const earlier = s.carriedQuestions ? this.answersBeforeRefresh(runId) : null;
    const recorded = earlier
      ? answers.map((a) => {
          const was = earlier.get(a.key);
          return a.source === 'default' && was?.value === a.value
            ? { ...a, source: was.source }
            : a;
        })
      : answers;
    this.record(runId, 'answers', { round: s.round, answers: recorded });
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
    // A Leantime tracker without its address and project can never validate, so every resume would park
    // again: use local tickets and say why; the owner can add tracker.leantime at review (plan 045).
    const tracker = withReachableTracker(spec);
    if (tracker.fellBack) {
      spec = tracker.spec;
      this.record(runId, 'step.warn', {
        step: 'spec.tracker',
        data: { reason: LEANTIME_FALLBACK },
      });
    }
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

  /**
   * The owner's corrections at REVIEW (plan 021): recorded, then the run drafts the spec again with them and
   * comes back to REVIEW with a new plan and a new brief. Only for runs that plan through discovery.
   */
  requestChanges(runId: string, text: string): void {
    const s = this.state(runId);
    if (s.input.kind !== 'new' && s.input.kind !== 'enhance')
      throw new PolicyError(`run ${runId} has no plan to revise`, { code: 'no_discovery' });
    if (s.state !== 'REVIEW' && !(s.state === 'PARKED' && s.parked?.state === 'REVIEW'))
      throw new PolicyError(`run ${runId} is not at review`, { code: 'not_at_review' });
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const clean = sanitizeRequest(text, 2000);
    if (!clean) throw new PolicyError('describe what to change', { code: 'empty_feedback' });
    this.record(runId, 'review.feedback', { text: clean, rev: s.rev });
    this.enter(runId, 'DRAFT_SPEC', MAX_ROUNDS);
  }

  /** The owner's corrections at review, oldest first (plan 021); after a refresh, only those since (plan 025). */
  private reviewFeedback(runId: string): string[] {
    const cut = this.since(runId);
    return this.entries(runId)
      .filter((e) => e.type === 'review.feedback' && e.seq > cut && typeof e['text'] === 'string')
      .map((e) => e['text'] as string);
  }

  /**
   * Whether the repository an update run read has moved on since (plan 025): new commits, or another branch
   * checked out in the owner's folder. Only asked while the run is planning; otherwise it says not moved.
   */
  async repoMoved(runId: string): Promise<RepoMove> {
    const none: RepoMove = {
      moved: false,
      recorded: null,
      current: null,
      branch: null,
      commits: null,
    };
    const s = this.state(runId);
    const at = s.state === 'PARKED' ? s.parked?.state : s.state;
    const pub = this.deps.publish;
    const repo = s.input.repo;
    if (s.input.kind !== 'enhance' || !repo || s.done || !pub || !at) return none;
    if (!PLANNING_STATES.includes(at)) return none;
    try {
      if (s.input.dir) {
        const base = s.steps['folder.base']?.data as
          { head?: string; branch?: string | null } | undefined;
        if (!base?.head) return none;
        return await this.compareHead(pub.git, this.runDir(s), base.head, base.branch ?? null);
      }
      const existing = (
        this.draft(runId) as { existingRepo?: { baseSha?: string; defaultBranch?: string } }
      ).existingRepo;
      const recorded = existing?.baseSha;
      if (!recorded || /^0+$/.test(recorded)) return none;
      if (!/^[a-z]+:\/\//i.test(repo) && !repo.startsWith('git@'))
        return await this.compareHead(pub.git, path.resolve(repo), recorded, undefined);
      const branch = existing?.defaultBranch ?? 'main';
      const token = await pub.resolveToken();
      const current = await pub.git.remoteSha(repo, `refs/heads/${branch}`, token?.token);
      const moved = current !== null && current !== recorded;
      return { moved, recorded, current, branch, commits: null };
    } catch {
      return none;
    }
  }

  /** A local repository's HEAD against the recorded commit, and its branch when one was recorded (plan 025). */
  private async compareHead(
    git: GitOps,
    dir: string,
    recorded: string,
    branchWas: string | null | undefined,
  ): Promise<RepoMove> {
    const current = await git.headSha(dir);
    const branch = await git.currentBranch(dir);
    const moved =
      current !== null &&
      (current !== recorded || (branchWas !== undefined && branch !== branchWas));
    const commits = moved && current !== null ? await git.countBetween(dir, recorded, current) : 0;
    return { moved, recorded, current, branch, commits };
  }

  /** Before the plan is built (plan 025): an update run whose repository moved on parks until it is refreshed. */
  private async guardRepo(runId: string): Promise<void> {
    const m = await this.repoMoved(runId);
    if (!m.moved) return;
    const count = m.commits ? ` (${m.commits} new commit${m.commits === 1 ? '' : 's'})` : '';
    throw new ParkError(
      'repo_moved',
      `the repository changed since this run read it${count}: refresh the run to read it again`,
      { recorded: m.recorded, current: m.current, commits: m.commits },
    );
  }

  /**
   * Reads an update run's repository again (plan 025). The run goes back to ANALYZE: a fresh copy, scan and
   * summary, a new draft from them, and the owner confirms the change request again. Only while planning.
   */
  async refreshRepo(runId: string): Promise<RepoMove> {
    const s = this.state(runId);
    if (s.input.kind !== 'enhance' || !s.input.repo)
      throw new PolicyError(`run ${runId} is not an update of an existing repository`, {
        code: 'not_enhance',
      });
    const at = s.state === 'PARKED' ? s.parked?.state : s.state;
    if (s.done || !at || !PLANNING_STATES.includes(at))
      throw new PolicyError(
        `run ${runId} ${s.cancelled ? 'was cancelled' : 'is past planning: its plan is already being built'}`,
        { code: 'too_late' },
      );
    const m = await this.repoMoved(runId);
    // why: the run may have been cancelled, or moved past planning, while git was reading (plan 029).
    const now = this.state(runId);
    const atNow = now.state === 'PARKED' ? now.parked?.state : now.state;
    if (now.done || !atNow || !PLANNING_STATES.includes(atNow))
      throw new PolicyError(
        `run ${runId} ${now.cancelled ? 'was cancelled' : 'is past planning'} while the repository was read`,
        { code: 'too_late' },
      );
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const asked = this.requestText(runId);
    const corrections = this.reviewFeedback(runId);
    const withCorrections = corrections.length
      ? `${asked}\n\nCorrections you gave at review:\n${corrections.map((c) => `- ${c}`).join('\n')}`
      : asked;
    // why: a second refresh before the request was confirmed keeps the text from the first.
    const previous = asked
      ? sanitizeRequest(withCorrections, REQUEST_MAX)
      : (this.previousRequest(runId) ?? '');
    // why: the summary is only rewritten when the model call succeeds; the old snapshot's must not survive.
    rmSync(this.enhanceFile(runId, 'analysis-summary.md'), { force: true });
    this.record(runId, 'repo.refresh', {
      from: m.recorded,
      to: m.current,
      commits: m.commits,
      previous,
    });
    this.enter(runId, 'ANALYZE');
    return m;
  }

  /**
   * Continue coding (plan 037): a finished folder run whose agent did not finish the plan goes back to CODE on the
   * same branch. Its parts continue from the folder as it is now; the owner reviews the commit and the push again,
   * and the push updates the same pull request.
   */
  async continueCoding(runId: string): Promise<void> {
    const s = this.state(runId);
    if (!s.input.dir || !this.deps.publish)
      throw new PolicyError(`run ${runId} did not code in a folder`, { code: 'not_folder' });
    if (!s.done || s.cancelled)
      throw new PolicyError(`run ${runId} ${s.cancelled ? 'was cancelled' : 'is not finished'}`, {
        code: 'not_done',
      });
    const agent = s.steps['code.done']?.data as AgentReport | undefined;
    if (!agent) throw new PolicyError(`run ${runId} never reached coding`, { code: 'not_coded' });
    if (agent.verdict === 'ready')
      throw new PolicyError(
        `the agent finished the plan of run ${runId}: there is nothing to continue`,
        {
          code: 'finished',
        },
      );
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is working`, { code: 'working' });
    const dir = this.runDir(s);
    const git = this.deps.publish.git;
    const committed = s.steps['finish.commit']?.data as { branch?: string | null } | undefined;
    const start = s.steps['code.start']?.data as { branch?: string | null } | undefined;
    const branch = committed?.branch ?? start?.branch ?? null;
    const current = await git.currentBranch(dir);
    if (!branch || current !== branch)
      throw new PolicyError(
        `the folder is on ${current ?? 'a detached HEAD'}, not the run's branch ${branch ?? '(unknown)'}: check it out, then continue (if it was deleted after a merge, start a new update run instead)`,
        { code: 'wrong_branch' },
      );
    if ((await git.status(dir)).length > 0)
      throw new PolicyError(
        'the folder has uncommitted changes: commit or stash them first, then continue',
        { code: 'dirty_tree' },
      );
    const first = this.entries(runId).find(
      (e) => e.type === 'step.ok' && e['step'] === 'code.start',
    )?.['data'] as { base?: string | null } | undefined;
    this.record(runId, 'code.continue', {
      branch,
      from: await git.headSha(dir),
      since: first?.base ?? null,
      verdict: agent.verdict,
      tripped: agent.tripped,
    });
    this.enter(runId, 'CODE');
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
    const before = this.state(runId);
    if (before.cancelled) return before;
    if (this.#active.has(runId))
      throw new PolicyError(`run ${runId} is already working`, { code: 'working' });
    this.#active.set(runId, { controller: new AbortController(), by: null });
    try {
      return await this.advanceLoop(runId, prompter);
    } finally {
      this.#active.delete(runId);
    }
  }

  private async advanceLoop(runId: string, prompter: Prompter): Promise<RunState> {
    await this.linkPortfolio(runId);
    try {
      for (;;) {
        this.throwIfStopped(runId);
        const s = this.state(runId);
        switch (s.state) {
          case 'INTAKE':
            // Plan 071: an Add memory run plans nothing; the seed's playbook is its plan.
            if (s.input.kind === 'memory') this.enter(runId, 'CODE');
            else if (s.input.repo) this.enter(runId, 'ANALYZE');
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
            // why: the plan must be built on the repository as it is now, not as it was read (plan 025).
            if (s.input.kind === 'enhance') await this.guardRepo(runId);
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
            if (s.input.kind === 'memory') await this.memoryRunStep(runId, s);
            else await this.codeStep(runId, s);
            break;
          case 'COMMIT':
            await this.commitStep(runId, s);
            break;
          case 'PUSH':
            if (s.input.kind === 'memory') await this.memoryPushStep(runId, s);
            else await this.pushStep(runId, s);
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
      if (err instanceof InterruptedError)
        this.record(runId, 'interrupted', {
          by: this.#active.get(runId)?.by ?? 'signal',
          state: this.state(runId).state,
        });
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
