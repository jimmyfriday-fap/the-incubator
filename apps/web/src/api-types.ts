// Shapes of the localhost API, shared by the server and the React UI (types only).

export interface SessionInfo {
  csrf: string;
  version: string;
  /** What the host (the desktop app, or `incubator ui`) can do for the page. */
  capabilities: { pickFolder: boolean };
}

export type FolderPurpose = 'new' | 'existing';

/** The answer to "can I use this folder?" (`POST /api/folders/inspect`). */
export interface FolderCheck {
  purpose: FolderPurpose;
  path: string;
  ok: boolean;
  exists: boolean;
  empty: boolean | null;
  git: {
    branch: string | null;
    head: string | null;
    clean: boolean;
    changed: string[];
    origin: { owner: string; name: string } | null;
    /** A GitHub repository on a remote other than `origin`, offered as the push target. */
    suggested: { remote: string; ref: { owner: string; name: string } } | null;
  } | null;
  /** Whether a stack pack fits the repository; without one the canonical files are unavailable. */
  stack: { supported: boolean; label: string } | null;
  /** The portfolio project this folder already is (ADR-028); absent when the portfolio is off. */
  project?: { id: string; name: string } | null;
  problems: string[];
  warnings: string[];
}

/** The end-of-iteration review: what the agent did, what changed, and the commit and push requests. */
export interface FinishInfo {
  stage: 'coding' | 'commit' | 'push' | 'done';
  dir: string;
  branch: string | null;
  agent: {
    verdict: 'ready' | 'parked' | 'ceiling' | 'failed' | 'stopped';
    summary: string | null;
    tripped: string | null;
    exitCode: number | null;
    turns: number;
    toolCalls: number;
    costUsd: number | null;
    /** What the agent could run to check its work (absent on runs from before ADR-025). */
    checks?: { mode: 'gate' | 'approved' | 'none'; commands: string[] };
  } | null;
  files: { code: string; path: string }[];
  message: string;
  identity: { name: string; email: string } | null;
  commit: { sha: string | null; branch: string | null; none?: boolean; left?: boolean } | null;
  target: { repo: { owner: string; name: string } | null; reason: string | null };
  pr: { number: number; url: string } | null;
  progress: {
    turns: number;
    toolCalls: number;
    costUsd: number | null;
    snippet: string | null;
  } | null;
}

export interface Question {
  key: string;
  question: string;
  impact: number;
  options: { value: string; label: string; recommended: boolean }[];
}

export interface RunListItem {
  runId: string;
  kind: 'new' | 'adopt' | 'enhance' | 'scaffold';
  state: string;
  done: boolean;
  parked: string | null;
  title: string;
  /** adopt and enhance: the source repository, so a finished run can offer "Enhance". */
  repo: string | null;
  /** adopt and enhance: owner/name when the source is not a GitHub URL. */
  repoRef: string | null;
  /** Folder runs: the folder the owner chose. */
  dir: string | null;
  cancelled: boolean;
  /** The portfolio project the run belongs to, when it has been filed. */
  project: { id: string; name: string } | null;
}

export interface RunDetail {
  runId: string;
  kind: 'new' | 'adopt' | 'enhance' | 'scaffold';
  state: string;
  done: boolean;
  busy: boolean;
  error: string | null;
  input: {
    narrative?: string;
    repo?: string;
    repoRef?: { owner: string; name: string };
    dir?: string;
  };
  parked: { state: string; reason: string; message: string; evidence?: unknown } | null;
  /** The last attempt stopped on an error; Resume retries `state`. Survives a restart. */
  failure: { state: string; message: string } | null;
  questions: Question[] | null;
  /** The questions are earlier answers, asked again to confirm after a refresh (plan 026). */
  carriedQuestions: boolean;
  round: number;
  rev: number;
  /** The latest revision is a complete spec, so the tree preview is available. */
  specComplete: boolean;
  publish: {
    repo: string;
    pairedRepo?: string;
    commit: string;
    secretsToSet: { name: string; repo: string; description: string }[];
    warnings: string[];
  } | null;
  adopt: { compliant: boolean; pr?: { number: number; url: string }; report: string | null } | null;
  enhance: EnhanceDetail | null;
  /** The owner abandoned the run: it is done and cannot be resumed. */
  cancelled: boolean;
  /** The work was stopped and has not been resumed (by the owner, a signal or the app closing). */
  stopped: { by: string; state: string } | null;
  /** Folder runs: the coding, commit and push stages. */
  finish: FinishInfo | null;
  /** The portfolio project this run belongs to (null until it is filed, or when the portfolio is off). */
  project: ProjectBrief | null;
  /** Which tool and model did each kind of work so far (ADR-029). */
  models: ModelUse[];
}

/** Whether an update run's repository moved on since the run read it (GET /api/runs/:id/repo-status). */
export interface RepoStatus {
  moved: boolean;
  /** The commit the run read. */
  recorded: string | null;
  /** The commit there now. */
  current: string | null;
  branch: string | null;
  /** New commits; null when they cannot be counted (a GitHub repository). */
  commits: number | null;
}

export interface ModelUse {
  job: 'planning' | 'analysis' | 'review-summary' | 'coding';
  tool: string;
  /** The model the tool reported or was asked for; null when it did not say. */
  model: string | null;
  calls: number;
  costUsd: number | null;
}

/** The Settings page (GET and PUT /api/settings; ADR-029). */
export interface SettingsView {
  chosen: {
    planning: { tool: string; model: string | null };
    coding: { agent: string; model: string | null };
    limits: { timeoutSeconds: number | null; gcDays: number | null };
    toolPaths: Record<string, string>;
  };
  effective: {
    planning: { tool: string | null; model: string | null; problem?: string };
    coding: { agent: string; model: string | null; installed: boolean };
  };
  adapters: {
    id: string;
    installed: boolean;
    version: string | null;
    canPlan: boolean;
    canCode: boolean;
    takesModel: boolean;
  }[];
  credentials: { account: string; source: string | null }[];
  about: { home: string; keychain: boolean };
}

export interface SettingsPatch {
  planning?: { tool?: string; model?: string | null };
  coding?: { agent?: string; model?: string | null };
  limits?: { timeoutSeconds?: number | null; gcDays?: number | null };
  toolPaths?: Record<string, string>;
}

/** A project of the portfolio (ADR-028), as the run page shows it. */
export interface ProjectBrief {
  id: string;
  name: string;
  summary: string;
  stack: string | null;
  repo: { dir: string | null; url: string | null };
  runCount: number;
}

/** One card on the dashboard home (GET /api/portfolio). */
export interface ProjectCard extends ProjectBrief {
  origin: 'created' | 'adopted' | 'existing';
  updatedAt: string;
  latest: { runId: string; kind: string; state: string; done: boolean; startedAt: string } | null;
}

export interface ProjectRunInfo {
  runId: string;
  kind: string;
  request: string | null;
  startedAt: string;
  state: string;
  done: boolean;
  outcome: {
    commit?: string;
    branch?: string;
    pr?: { number: number; url: string };
    local?: string;
  } | null;
  /** The run's folder still exists, so it can be opened. */
  available: boolean;
}

/** A project and its run history (GET /api/portfolio/:id). */
export interface ProjectDetail extends ProjectBrief {
  origin: 'created' | 'adopted' | 'existing';
  createdAt: string;
  updatedAt: string;
  repo: { dir: string | null; url: string | null; remote: string | null };
  runs: ProjectRunInfo[];
}

/** What an enhance run shows: the scan, the request, and the outcome. */
export interface EnhanceDetail {
  /** The owner's change request so far (empty until it is given). */
  request: string;
  /** Why nothing was delivered, when that is the outcome. */
  noop: string | null;
  pr?: { number: number; url: string };
  plan: {
    planPath: string;
    create: string[];
    proposed: string[];
    gaps: { create: string[]; proposed: string[] } | null;
    features: { id: string; lane: string; targets: string[] }[];
  } | null;
  /**
   * Folder runs on a repository with no Incubator gate: the check commands proposed for the coding
   * agent, and what the owner approved (null until they decide). Null when it does not apply.
   */
  checks: {
    /** `what` is absent from nothing the server sends: older runs are filled in server-side. */
    proposed: { command: string; what: string; why: string }[];
    approved: string[] | null;
  } | null;
  /** What the scan recognised the repository as, and whether the Incubator has a pack for it. */
  stack: { label: string; evidence: string[]; packed: boolean } | null;
  /** The deterministic scan report (first line: scanned N of M files). */
  scanReport: string | null;
}

/** The plain-English brief above the spec at REVIEW (GET /api/runs/:id/review-summary). */
export interface ReviewSummary {
  headline: string;
  changes: string[];
  approach: string;
  notIncluded: string[];
  watchFor: string[];
}
export type ReviewSummaryResponse =
  | { status: 'ready'; summary: ReviewSummary }
  | { status: 'pending' }
  | { status: 'failed'; message: string }
  | { status: 'unavailable' };

/** A stack the Incubator knows (ADR-027). */
export interface StackInfo {
  id: string;
  label: string;
  kind: 'built-in' | 'retrieved';
  summary: string;
  platforms: string[];
  /** Retrieved stacks: where the owner gets the tool. */
  install?: string;
}
export type StackRecommendResponse =
  | {
      status: 'ready';
      recommendation: {
        stack: string;
        reasons: string[];
        alternatives: { stack: string; tradeoff: string }[];
      };
    }
  | { status: 'failed'; message: string };
export type StackProbeResponse =
  | { ok: true; stack: string; tool: string; version: string }
  | {
      ok: false;
      stack: string;
      tool: string;
      install: string;
      reason: 'missing' | 'failed';
      detail?: string;
    };
export type StackCreateResponse =
  | { status: 'missing'; probe: Extract<StackProbeResponse, { ok: false }> }
  | {
      status: 'created';
      stack: string;
      dir: string;
      commit: string;
      files: number;
      version: string;
    };

export interface Revision {
  rev: number;
  final: boolean;
  edited: boolean;
  inferred: boolean;
}

export interface SpecChange {
  pointer: string;
  op: 'add' | 'remove' | 'replace';
  before?: unknown;
  after?: unknown;
}

export interface TreeFile {
  path: string;
  bytes: number;
  mode: '0644' | '0755';
  pack: string;
  status?: 'create' | 'identical' | 'proposed' | 'owned';
}

export interface LogEntry {
  seq: number;
  ts: string;
  type: string;
  [field: string]: unknown;
}

export interface StartRunBody {
  kind: 'new' | 'adopt' | 'enhance';
  narrative?: string;
  repo?: string;
  /** adopt and enhance: owner/name when the source is not a GitHub URL. */
  repoRef?: string;
  org?: boolean;
  noPublish?: boolean;
  /** enhance: what to change; when absent the run parks at "What do you want to change?". */
  request?: string;
  /** enhance: also deliver the canonical-pattern gaps, as a separate commit. */
  withGaps?: boolean;
  /**
   * The folder the owner chose. `new`: the folder becomes the repository. `enhance`: the existing
   * repository to update in place (then `repo` is ignored and taken from `dir`).
   */
  dir?: string;
}
