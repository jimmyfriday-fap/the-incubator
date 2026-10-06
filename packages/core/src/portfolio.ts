import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The portfolio (ADR-028): one entry per project the Incubator has worked on, with the runs that worked on
 * it. It lives in `~/.incubator/portfolio.json`, outside the run folders, so it survives `incubator gc`.
 * A repository the Incubator has worked on carries a marker (`.incubator/project.json`) so a later run
 * recognises it, even from another folder or after a rename.
 */

export interface PortfolioRun {
  runId: string;
  kind: string;
  /** What the owner asked for (the idea, or the change request). */
  request: string | null;
  startedAt: string;
  /** The run's state when last seen: a state name, `PARKED`, or `FAILED`. */
  state: string;
  done: boolean;
  outcome: {
    commit?: string;
    branch?: string;
    pr?: { number: number; url: string };
    /** The folder the work landed in, when it stayed local. */
    local?: string;
  } | null;
}

export interface PortfolioProject {
  id: string;
  name: string;
  summary: string;
  /** How the Incubator first met it: made by it, adopted into its conventions, or already existing. */
  origin: 'created' | 'adopted' | 'existing';
  repo: {
    dir: string | null;
    /** The git remote URL as configured. */
    remote: string | null;
    ref: { owner: string; name: string } | null;
    /** The GitHub address, once known. */
    url: string | null;
  };
  /** A human label: "Dart/Flutter", "Node web app". */
  stack: string | null;
  createdAt: string;
  updatedAt: string;
  /** Newest first. */
  runs: PortfolioRun[];
}

interface PortfolioFile {
  version: 1;
  projects: PortfolioProject[];
}

export const MARKER_PATH = '.incubator/project.json';

/** What the marker says: the project id, and a name for a human reading it. */
export function markerText(project: Pick<PortfolioProject, 'id' | 'name'>): string {
  return `${JSON.stringify({ incubatorProject: project.id, name: project.name }, null, 2)}\n`;
}

/** The project id a repository's marker names, or null (no marker, or one that is not ours). */
export function readMarker(dir: string): string | null {
  const file = path.join(dir, ...MARKER_PATH.split('/'));
  if (!existsSync(file)) return null;
  try {
    const v: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const id = (v as { incubatorProject?: unknown } | null)?.incubatorProject;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** One spelling of a git remote, so `git@github.com:o/r.git` and `https://github.com/o/r` compare equal. */
export function normalizeRemote(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u);
  if (scp) u = `${scp[1]!}/${scp[2]!}`;
  u = u
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return u ? u.toLowerCase() : null;
}

function sameDir(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

export interface MatchQuery {
  markerId?: string | null;
  remote?: string | null;
  dir?: string | null;
}

export class Portfolio {
  readonly file: string;

  constructor(
    home: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.file = path.join(home, 'portfolio.json');
  }

  /** True once the file exists, so a first use can fill it from the runs already on disk. */
  exists(): boolean {
    return existsSync(this.file);
  }

  private read(): PortfolioFile {
    if (!existsSync(this.file)) return { version: 1, projects: [] };
    try {
      const v = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<PortfolioFile>;
      return { version: 1, projects: Array.isArray(v.projects) ? v.projects : [] };
    } catch {
      // why: a damaged file must not lose the owner's history silently, nor stop a run.
      renameSync(this.file, `${this.file}.damaged-${Date.now()}`);
      return { version: 1, projects: [] };
    }
  }

  private write(data: PortfolioFile): void {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  list(): PortfolioProject[] {
    return this.read()
      .projects.slice()
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  get(id: string): PortfolioProject | undefined {
    return this.read().projects.find((p) => p.id === id);
  }

  /** The marker first, then the git remote, then the folder. Never a guess from a name. */
  match(q: MatchQuery): PortfolioProject | undefined {
    const projects = this.read().projects;
    if (q.markerId) {
      const hit = projects.find((p) => p.id === q.markerId);
      if (hit) return hit;
    }
    const remote = normalizeRemote(q.remote);
    if (remote) {
      const hit = projects.find((p) => normalizeRemote(p.repo.remote) === remote);
      if (hit) return hit;
    }
    return q.dir ? projects.find((p) => sameDir(p.repo.dir, q.dir ?? null)) : undefined;
  }

  /** A new project. `id` is chosen here so it can be written into the repository's marker. */
  create(
    input: Omit<PortfolioProject, 'id' | 'createdAt' | 'updatedAt' | 'runs'> & { id?: string },
  ): PortfolioProject {
    const data = this.read();
    const at = this.now();
    const project: PortfolioProject = {
      ...input,
      id: input.id ?? randomUUID(),
      createdAt: at,
      updatedAt: at,
      runs: [],
    };
    data.projects.push(project);
    this.write(data);
    return project;
  }

  /** Reads, changes and writes one project; the run list stays newest first. */
  update(id: string, change: (p: PortfolioProject) => void): PortfolioProject | undefined {
    const data = this.read();
    const project = data.projects.find((p) => p.id === id);
    if (!project) return undefined;
    change(project);
    project.updatedAt = this.now();
    project.runs.sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
    );
    this.write(data);
    return project;
  }

  /** The project a run belongs to, if any. */
  forRun(runId: string): PortfolioProject | undefined {
    return this.read().projects.find((p) => p.runs.some((r) => r.runId === runId));
  }

  /** Adds a run to a project, or refreshes it when it is already there. */
  attachRun(id: string, run: PortfolioRun): PortfolioProject | undefined {
    return this.update(id, (p) => {
      const i = p.runs.findIndex((r) => r.runId === run.runId);
      if (i >= 0) p.runs[i] = { ...p.runs[i]!, ...run };
      else p.runs.push(run);
    });
  }
}
