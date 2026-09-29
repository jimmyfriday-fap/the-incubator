// Shell-less subprocess helpers for the guard toolkit (mirror of @incubator/runtime exec, ADR-008).
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function parseCmdShim(content, shimPath) {
  const re = /"%(?:~dp0|dp0)%?\\?([^"]+)"\s+%\*/g;
  let last = null;
  for (const m of content.matchAll(re)) {
    if (!/(^|\\)node(\.exe)?$/i.test(m[1])) last = m[1];
  }
  return last === null
    ? null
    : path.win32.normalize(path.win32.join(path.win32.dirname(shimPath), last));
}

/** PATH lookup; returns [command, prefixArgs] runnable with shell:false, or null. */
export function which(name, env = process.env) {
  const windows = process.platform === 'win32';
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const exts = windows ? ['.exe', '.com', '.cmd', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        accessSync(candidate, windows ? constants.F_OK : constants.X_OK);
      } catch {
        continue;
      }
      if (windows && /\.(cmd|bat)$/i.test(candidate)) {
        const target = parseCmdShim(readFileSync(candidate, 'utf8'), candidate);
        if (target === null) continue;
        return /\.(exe|com)$/i.test(target) ? [target, []] : [process.execPath, [target]];
      }
      return [candidate, []];
    }
  }
  return null;
}

/** Resolves a package's bin script from node_modules and returns [node, [script]]. */
export function nodeBin(root, pkg, bin) {
  const pj = path.join(root, 'node_modules', pkg, 'package.json');
  if (!existsSync(pj)) return null;
  const meta = JSON.parse(readFileSync(pj, 'utf8'));
  const rel = typeof meta.bin === 'string' ? meta.bin : meta.bin?.[bin ?? pkg];
  if (!rel) return null;
  return [process.execPath, [path.join(root, 'node_modules', pkg, rel)]];
}

/** The package manager that launched us (npm_execpath), else pnpm/npm on PATH. */
export function packageManager(preferred = 'pnpm') {
  const execpath = process.env.npm_execpath;
  if (execpath && /\.(c?js|mjs)$/.test(execpath) && existsSync(execpath))
    return [process.execPath, [execpath]];
  return which(preferred) ?? which('npm');
}

/** Spawns without a shell. Resolves {code, stdout, stderr}; stdio inherited unless capture. */
export function run(
  command,
  args,
  { cwd, env, capture = false, timeoutMs = 30 * 60 * 1000, input } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      windowsHide: true,
      stdio: [
        input === undefined ? 'ignore' : 'pipe',
        capture ? 'pipe' : 'inherit',
        capture ? 'pipe' : 'inherit',
      ],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b) => (stdout += b));
    child.stderr?.on('data', (b) => (stderr += b));
    if (input !== undefined) child.stdin.end(input);
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${e.message}`, error: e });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
