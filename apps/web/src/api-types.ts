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
  kind: 'new' | 'adopt';
  narrative?: string;
  repo?: string;
  /** adopt: owner/name when the source is not a GitHub URL. */
  repoRef?: string;
  org?: boolean;
  noPublish?: boolean;
}
