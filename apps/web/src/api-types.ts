// Shapes of the localhost API, shared by the server and the React UI (types only).

export interface SessionInfo {
  csrf: string;
  version: string;
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
}

export interface RunDetail {
  runId: string;
  kind: 'new' | 'adopt' | 'enhance' | 'scaffold';
  state: string;
  done: boolean;
  busy: boolean;
  error: string | null;
  input: { narrative?: string; repo?: string; repoRef?: { owner: string; name: string } };
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
}
