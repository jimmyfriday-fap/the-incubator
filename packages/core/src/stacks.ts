import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { PolicyError, ToolError, which, type Exec } from '@incubator/runtime';
import type { GitIdentity, GitOps } from '@incubator/git';
import {
  STACK_CATALOG,
  validStackNames,
  type StackEntry,
  type StackPrerequisite,
} from '@incubator/spec';
import { clean } from '@incubator/analyzer';

/**
 * Retrieved stacks (ADR-027): find the stack's own tool, probe it, run its official generator in an empty
 * folder, and commit the result as the project's base commit. The Incubator never installs software and
 * never passes free text to a generator: arguments are built by the catalog from validated names.
 */

export interface ToolsDeps {
  exec: Exec;
  /** The owner's home directory, where a tool that is not on PATH is commonly unpacked. */
  userHome: string;
  /** `toolPaths` from `~/.incubator/config.json`: the owner's own statement of where a tool lives. */
  toolPaths?: Readonly<Record<string, string>>;
}

export interface ToolLocation {
  path: string;
  via: 'path' | 'config' | 'home';
}

/** PATH first, then the owner's configured path, then the directories the catalog names under home. */
export async function locateTool(
  pre: StackPrerequisite,
  deps: ToolsDeps,
): Promise<ToolLocation | null> {
  const onPath = await deps.exec.which(pre.tool);
  if (onPath) return { path: onPath.path, via: 'path' };
  const configured = deps.toolPaths?.[pre.tool];
  if (configured && path.isAbsolute(configured) && existsSync(configured))
    return { path: configured, via: 'config' };
  for (const d of pre.homeDirs) {
    const dir = path.join(deps.userHome, ...d.split('/'));
    if (!existsSync(dir)) continue;
    const found = await which(pre.tool, { env: { PATH: dir } });
    if (found) return { path: found.path, via: 'home' };
  }
  return null;
}

export type StackProbe =
  | {
      ok: true;
      stack: string;
      tool: string;
      path: string;
      via: ToolLocation['via'];
      version: string;
    }
  | {
      ok: false;
      stack: string;
      tool: string;
      install: string;
      reason: 'missing' | 'failed';
      detail?: string;
    };

/** Is the stack's tool installed and does it run? Reads nothing from any repository. */
export async function probeStack(entry: StackEntry, deps: ToolsDeps): Promise<StackProbe> {
  const pre = entry.prerequisites?.[0];
  if (!pre)
    throw new PolicyError(`${entry.id} has no prerequisite to probe`, { code: 'not_retrieved' });
  const base = { stack: entry.id, tool: pre.tool, install: pre.install };
  const loc = await locateTool(pre, deps);
  if (!loc) return { ok: false, ...base, reason: 'missing' };
  try {
    const r = await deps.exec.run(loc.path, pre.probe, { timeoutMs: 180_000, allowBatch: true });
    if (r.code !== 0 || r.timedOut)
      return {
        ok: false,
        ...base,
        reason: 'failed',
        detail: clean(r.timedOut ? 'timed out' : `${r.stderr}${r.stdout}`, 300),
      };
    const version = clean(r.stdout.split(/\r?\n/).find((l) => l.trim()) ?? '', 120);
    return { ok: true, stack: entry.id, tool: pre.tool, path: loc.path, via: loc.via, version };
  } catch (e) {
    return {
      ok: false,
      ...base,
      reason: 'failed',
      detail: clean(e instanceof Error ? e.message : String(e), 300),
    };
  }
}

export interface CreateDeps extends ToolsDeps {
  git: GitOps;
  identity?: () => Promise<GitIdentity | null>;
}

export type StackCreateResult =
  | { status: 'missing'; probe: Extract<StackProbe, { ok: false }> }
  | {
      status: 'created';
      stack: string;
      dir: string;
      commit: string;
      files: number;
      version: string;
    };

function countFiles(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
}

/**
 * Creates a project in `dir` with the stack's generator and commits it. The folder must be empty (or not
 * exist). When the tool is missing nothing is written and the result says where to get it.
 */
export async function createStackProject(
  entry: StackEntry,
  input: { dir: string; name: string; org: string },
  deps: CreateDeps,
): Promise<StackCreateResult> {
  const create = entry.create;
  if (entry.kind !== 'retrieved' || !create)
    throw new PolicyError(`${entry.id} is not a retrieved stack`, { code: 'not_retrieved' });
  if (!path.isAbsolute(input.dir))
    throw new PolicyError('choose a folder with its full path', { code: 'bad_folder' });
  const names = validStackNames(input.name, input.org);
  if (!names)
    throw new PolicyError(
      'the project name or organisation cannot be used: use letters and digits, and an organisation like com.example',
      { code: 'bad_stack_names' },
    );
  if (existsSync(input.dir) && readdirSync(input.dir).length > 0)
    throw new PolicyError(
      `${input.dir} is not empty: ${entry.label} must be created in an empty folder`,
      {
        code: 'folder_not_empty',
      },
    );

  const probe = await probeStack(entry, deps);
  if (!probe.ok) return { status: 'missing', probe };

  mkdirSync(input.dir, { recursive: true });
  const r = await deps.exec.run(probe.path, create.args(names), {
    cwd: input.dir,
    timeoutMs: 15 * 60_000,
    allowBatch: true,
  });
  if (r.code !== 0 || r.timedOut)
    throw new ToolError(
      `${create.tool} could not create the project: ${clean(r.timedOut ? 'timed out' : `${r.stderr}${r.stdout}`, 400)}`,
      { code: 'generator_failed' },
    );
  const missing = create.expects.filter((f) => !existsSync(path.join(input.dir, ...f.split('/'))));
  if (missing.length)
    throw new ToolError(`${create.tool} finished but did not create ${missing.join(', ')}`, {
      code: 'generator_incomplete',
    });

  if (!existsSync(path.join(input.dir, '.git'))) await deps.git.init(input.dir, 'main');
  await deps.git.addAll(input.dir);
  const identity = await deps.identity?.();
  const commit = await deps.git.commit(
    input.dir,
    `chore: ${create.tool} create`,
    identity ? { identity } : {},
  );
  return {
    status: 'created',
    stack: entry.id,
    dir: input.dir,
    commit,
    files: countFiles(input.dir),
    version: probe.version,
  };
}

/**
 * The environment a coding agent needs to run the check commands the owner approved: when a tool such as
 * `flutter` was found by a configured path or under the owner's home rather than on PATH, its directory is put in
 * front of PATH for the agent, so `flutter analyze` works there as it does for the owner. Null when
 * nothing needs adding.
 */
export async function toolPathEnv(
  commands: readonly string[],
  deps: ToolsDeps,
  base: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, string> | null> {
  const known = STACK_CATALOG.flatMap((s) => s.prerequisites ?? []);
  const dirs = new Set<string>();
  for (const bin of new Set(commands.map((c) => c.trim().split(/\s+/)[0] ?? ''))) {
    const pre = known.find((p) => p.tool === bin);
    if (!pre) continue;
    const loc = await locateTool(pre, deps);
    if (loc && loc.via !== 'path') dirs.add(path.dirname(loc.path));
  }
  if (dirs.size === 0) return null;
  // Windows keeps the variable as `Path`: set the key that is already there, never a second spelling.
  const key = Object.keys(base).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  return { [key]: [...dirs, base[key] ?? ''].filter(Boolean).join(path.delimiter) };
}
