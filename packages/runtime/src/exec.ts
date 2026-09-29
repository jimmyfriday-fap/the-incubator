// The only module allowed to import node:child_process (enforced by ESLint no-restricted-imports).
import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ToolError } from './errors.js';
import type { Logger } from './log.js';

export type BinKind = 'native' | 'cmd-shim' | 'script';

export interface ResolvedBin {
  /** Absolute path of what was found on PATH. */
  path: string;
  kind: BinKind;
  /** For cmd shims: the script to run with node, or a native exe the shim wraps. */
  target?: string;
}

export interface ExecOptions {
  /** Required: every subprocess has a deadline. */
  timeoutMs: number;
  cwd?: string;
  /** Merged over process.env unless `inheritEnv` is false. */
  env?: Record<string, string | undefined>;
  /** When false, only `env` plus a minimal allowlist (PATH, HOME, locale) is passed. */
  inheritEnv?: boolean;
  stdin?: string | Uint8Array;
  /** Cap on captured bytes per stream. Default 16 MiB. */
  maxBuffer?: number;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Tee output lines through this logger (redacted at its sink). */
  log?: Logger;
  /** Never log output (e.g. `gh auth token`). */
  secretOutput?: boolean;
  signal?: AbortSignal;
}

export interface ExecResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface Exec {
  run(bin: string, args: readonly string[], opts: ExecOptions): Promise<ExecResult>;
  which(name: string): Promise<ResolvedBin | null>;
}

const ENV_ALLOWLIST = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'SystemRoot',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TERM',
];

async function isExecutableFile(p: string, windows: boolean): Promise<boolean> {
  try {
    await access(p, windows ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parses npm / pnpm style `.cmd` shims and returns the script (or exe) they launch, resolved
 * against the shim's directory. Returns null if the shim is not in a recognised format.
 */
export function parseCmdShim(content: string, shimPath: string): string | null {
  const re = /"%(?:~dp0|dp0)%?\\?([^"]+)"\s+%\*/g;
  let last: string | null = null;
  for (const m of content.matchAll(re)) {
    const rel = m[1];
    if (rel !== undefined && !/(^|\\)node(\.exe)?$/i.test(rel)) last = rel;
  }
  if (last === null) return null;
  return path.win32.normalize(path.win32.join(path.win32.dirname(shimPath), last));
}

export interface WhichOptions {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  readText?: (p: string) => Promise<string>;
  exists?: (p: string) => Promise<boolean>;
}

/** PATH (+PATHEXT on Windows) lookup that prefers `.exe` over `.cmd` shims. Never uses a shell. */
export async function which(name: string, opts: WhichOptions = {}): Promise<ResolvedBin | null> {
  const platform = opts.platform ?? process.platform;
  const windows = platform === 'win32';
  const env = opts.env ?? process.env;
  const p = windows ? path.win32 : path.posix;
  const exists = opts.exists ?? ((f: string) => isExecutableFile(f, windows));
  const readText = opts.readText ?? ((f: string) => readFile(f, 'utf8'));
  const pathVar = env['PATH'] ?? env['Path'] ?? '';
  const dirs = name.includes('/') || name.includes('\\') ? [''] : pathVar.split(p.delimiter);
  const exts = windows
    ? [
        '',
        '.exe',
        '.com',
        ...(env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((e) => e.toLowerCase())
          .filter((e) => e && e !== '.exe' && e !== '.com'),
      ]
    : [''];
  for (const dir of dirs) {
    if (dirs.length > 1 && !dir) continue;
    for (const ext of exts) {
      if (windows && ext === '' && !/\.[a-z0-9]+$/i.test(name)) continue;
      const candidate = dir ? p.join(dir, name + ext) : name + ext;
      if (!(await exists(candidate))) continue;
      const lower = candidate.toLowerCase();
      if (windows && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
        const target = parseCmdShim(await readText(candidate), candidate);
        return target === null
          ? { path: candidate, kind: 'cmd-shim' }
          : { path: candidate, kind: 'cmd-shim', target };
      }
      return {
        path: candidate,
        kind: lower.endsWith('.js') || lower.endsWith('.mjs') ? 'script' : 'native',
      };
    }
  }
  return null;
}

/** Turns a resolved binary into the argv that spawn() can run without a shell. */
export function commandFor(resolved: ResolvedBin, args: readonly string[]): [string, string[]] {
  if (resolved.kind === 'native') return [resolved.path, [...args]];
  if (resolved.kind === 'script') return [process.execPath, [resolved.path, ...args]];
  if (resolved.target === undefined) {
    throw new ToolError(
      `cannot run ${resolved.path} without a shell: unrecognised .cmd shim format`,
      { code: 'cmd_shim_unparseable', details: { shim: resolved.path } },
    );
  }
  if (/\.(exe|com)$/i.test(resolved.target)) return [resolved.target, [...args]];
  return [process.execPath, [resolved.target, ...args]];
}

/** Kills a process and its children. Windows: taskkill /T /F (spawned shell-less). */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      return;
    }
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 5000).unref();
}

const live = new Set<number>();

/** PIDs of children still running; the interrupt handler kills these trees. */
export function liveChildren(): readonly number[] {
  return [...live];
}

function buildEnv(opts: ExecOptions): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  if (opts.inheritEnv === false) {
    for (const key of ENV_ALLOWLIST) {
      const v = process.env[key];
      if (v !== undefined) base[key] = v;
    }
  } else {
    Object.assign(base, process.env);
  }
  for (const [k, v] of Object.entries(opts.env ?? {})) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

class Capture {
  #chunks: Buffer[] = [];
  #size = 0;
  #pending = '';
  constructor(
    private readonly max: number,
    private readonly onLine: ((line: string) => void) | undefined,
  ) {}
  push(buf: Buffer): void {
    if (this.#size < this.max) {
      const slice = buf.subarray(0, this.max - this.#size);
      this.#chunks.push(slice);
      this.#size += slice.length;
    }
    if (this.onLine) {
      const text = this.#pending + buf.toString('utf8');
      const lines = text.split(/\r?\n/);
      this.#pending = lines.pop() ?? '';
      for (const line of lines) this.onLine(line);
    }
  }
  finish(): string {
    if (this.onLine && this.#pending) this.onLine(this.#pending);
    return Buffer.concat(this.#chunks).toString('utf8');
  }
}

export async function runProcess(
  bin: string,
  args: readonly string[],
  opts: ExecOptions,
  resolver: (name: string) => Promise<ResolvedBin | null> = which,
): Promise<ExecResult> {
  const resolved = await resolver(bin);
  if (resolved === null) {
    throw new ToolError(`binary not found on PATH: ${bin}`, {
      code: 'binary_not_found',
      details: { bin },
    });
  }
  const [command, argv] = commandFor(resolved, args);
  const max = opts.maxBuffer ?? 16 * 1024 * 1024;
  const log = opts.secretOutput ? undefined : opts.log;
  const outLine = log ? (l: string) => log.debug(l, { stream: 'stdout', bin }) : undefined;
  const errLine = log ? (l: string) => log.debug(l, { stream: 'stderr', bin }) : undefined;
  const out = new Capture(max, outLine);
  const err = new Capture(max, errLine);

  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn(command, argv, {
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      cwd: opts.cwd,
      env: buildEnv(opts),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, opts.timeoutMs);
    const onAbort = (): void => {
      if (child.pid !== undefined) killTree(child.pid);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    if (child.pid !== undefined) live.add(child.pid);

    child.stdout.on('data', (b: Buffer) => {
      out.push(b);
      opts.onStdout?.(b.toString('utf8'));
    });
    child.stderr.on('data', (b: Buffer) => {
      err.push(b);
      opts.onStderr?.(b.toString('utf8'));
    });
    child.stdin.on('error', () => undefined);
    child.on('error', (e) => {
      clearTimeout(timer);
      if (child.pid !== undefined) live.delete(child.pid);
      reject(
        new ToolError(`failed to spawn ${bin}: ${e.message}`, { code: 'spawn_failed', cause: e }),
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (child.pid !== undefined) live.delete(child.pid);
      resolve({ code, signal, stdout: out.finish(), stderr: err.finish(), timedOut });
    });
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
    else child.stdin.end();
  });
}

/** Default Exec implementation. */
export const nodeExec: Exec = {
  run: (bin, args, opts) => runProcess(bin, args, opts),
  which: (name) => which(name),
};
