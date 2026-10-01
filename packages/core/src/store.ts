import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { RUN_ID_PATTERN, ToolError, incubatorHome, newRunId, type Clock } from '@incubator/runtime';
import { serializeSpec } from '@incubator/spec';
import { Journal } from './journal.js';

export interface RunInput {
  kind: 'new' | 'adopt' | 'enhance' | 'scaffold';
  narrative?: string;
  repo?: string;
  specOnly?: boolean;
  yes?: boolean;
  adapter?: string;
  surface: 'cli' | 'web' | 'desktop' | 'test';
  /** Scaffold-only: write the rendered tree here and stop (no verify, no publish). */
  out?: string;
  /** Keep the run workspace after publishing. */
  keep?: boolean;
  /** adopt: the GitHub repository to open the PR against when `repo` is not a GitHub URL. */
  repoRef?: { owner: string; name: string };
  ownerType?: 'user' | 'org';
  /** adopt and enhance: stop after writing the branch locally (no push, no PR). */
  noPublish?: boolean;
  /** enhance: what the owner wants to change (asked for at REQUEST when absent). */
  request?: string;
  /** enhance: also deliver the canonical-pattern gaps, as a separate commit. */
  withGaps?: boolean;
  /**
   * A local folder chosen by the owner (ADR-023). `new`: the folder itself becomes the repository
   * (empty or missing). `enhance`: the existing repository the agent works in, on a new branch. After the
   * agent stops, the run asks for the commit and the push.
   */
  dir?: string;
}

/** `~/.incubator` layout (TDD §2.5): config.json, runs/<id>/{run.json,journal.jsonl,spec/,workspace/,logs/}, cache/. */
export class RunStore {
  readonly home: string;
  constructor(
    private readonly clock: Clock,
    home?: string,
  ) {
    this.home = home ?? incubatorHome();
  }

  private ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') chmodSync(dir, 0o700);
  }

  runsDir(): string {
    return path.join(this.home, 'runs');
  }

  runDir(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId))
      throw new ToolError(`invalid run id: ${runId}`, { code: 'bad_run_id' });
    return path.join(this.runsDir(), runId);
  }

  create(
    input: RunInput,
    versions: Record<string, string>,
  ): { runId: string; dir: string; journal: Journal } {
    this.ensureDir(this.home);
    this.ensureDir(this.runsDir());
    let runId = newRunId(this.clock);
    while (existsSync(path.join(this.runsDir(), runId))) runId = newRunId(this.clock);
    const dir = this.runDir(runId);
    this.ensureDir(dir);
    for (const sub of ['spec/history', 'logs']) this.ensureDir(path.join(dir, sub));
    writeFileSync(
      path.join(dir, 'run.json'),
      `${JSON.stringify({ runId, input, versions }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return { runId, dir, journal: new Journal(path.join(dir, 'journal.jsonl'), this.clock) };
  }

  open(runId: string): {
    dir: string;
    journal: Journal;
    header: { runId: string; input: RunInput; versions: Record<string, string> };
  } {
    const dir = this.runDir(runId);
    if (!existsSync(path.join(dir, 'run.json')))
      throw new ToolError(`no such run: ${runId}`, { code: 'no_run' });
    const header = JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as {
      runId: string;
      input: RunInput;
      versions: Record<string, string>;
    };
    return { dir, journal: new Journal(path.join(dir, 'journal.jsonl'), this.clock), header };
  }

  writeSpecRevision(runId: string, rev: number, spec: unknown): string {
    const dir = this.runDir(runId);
    const text = serializeSpec(spec as Record<string, unknown>);
    writeFileSync(path.join(dir, 'spec', 'history', `${String(rev).padStart(3, '0')}.json`), text, {
      mode: 0o600,
    });
    writeFileSync(path.join(dir, 'spec', 'incubator.json'), text, { mode: 0o600 });
    return text;
  }

  readSpecRevision(runId: string, rev: number): Record<string, unknown> {
    const file = path.join(
      this.runDir(runId),
      'spec',
      'history',
      `${String(rev).padStart(3, '0')}.json`,
    );
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  }

  list(): string[] {
    if (!existsSync(this.runsDir())) return [];
    return readdirSync(this.runsDir())
      .filter((d) => RUN_ID_PATTERN.test(d))
      .sort();
  }

  /** Last activity: the journal's mtime (falls back to run.json). */
  lastActivity(runId: string): Date {
    const dir = this.runDir(runId);
    const file = existsSync(path.join(dir, 'journal.jsonl'))
      ? path.join(dir, 'journal.jsonl')
      : path.join(dir, 'run.json');
    return statSync(file).mtime;
  }

  remove(runId: string): void {
    rmSync(this.runDir(runId), { recursive: true, force: true });
  }
}
