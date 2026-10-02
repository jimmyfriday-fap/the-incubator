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
  problems: string[];
  warnings: string[];
}

/** The end-of-iteration review: what the agent did, what changed, and the commit and push requests. */
export interface FinishInfo {
  stage: 'coding' | 'commit' | 'push' | 'done';
  dir: string;
  branch: string | null;
  agent: {
    verdict: 'ready' | 'parked' | 'ceiling' | 'failed';
    summary: string | null;
    tripped: string | null;
    exitCode: number | null;
    turns: number;
    toolCalls: number;
    costUsd: number | null;
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
  questions: Question[] | null;
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
  /** Folder runs: the coding, commit and push stages. */
  finish: FinishInfo | null;
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
  /** The deterministic scan report (first line: scanned N of M files). */
  scanReport: string | null;
}

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
