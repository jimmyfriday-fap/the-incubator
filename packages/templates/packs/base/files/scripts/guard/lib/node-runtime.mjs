// Which Node runs the repository's own scripts. Hooks (Claude Code, lefthook) start them with the
// first `node` on PATH, which need not be the version .nvmrc pins: pnpm then refuses to install
// (engine-strict) and version-sensitive tests fail. INCUBATOR_NODE names a binary of the pinned
// version; the entry scripts re-run themselves under it.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './proc.mjs';

export const NODE_VAR = 'INCUBATOR_NODE';

function major(version) {
  const m = /^v?(\d+)/.exec(String(version).trim());
  return m ? Number(m[1]) : null;
}

/** The major version .nvmrc pins, or null when there is no file or no numeric pin (`lts/*`). */
export function pinnedNodeMajor(root) {
  const file = path.join(root, '.nvmrc');
  return existsSync(file) ? major(readFileSync(file, 'utf8')) : null;
}

async function versionOfBinary(bin) {
  const r = await run(bin, ['--version'], { capture: true, timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * `stay`: this Node is the pinned one, or nothing is pinned. `switch`: INCUBATOR_NODE is the pinned
 * version, run under `bin`. `warn`: the pinned Node is not available; carry on and say so.
 */
export async function nodeChoice(
  root,
  { current = process.version, env = process.env, versionOf = versionOfBinary } = {},
) {
  const want = pinnedNodeMajor(root);
  if (want === null || major(current) === want) return { action: 'stay' };
  const bin = env[NODE_VAR];
  if (!bin)
    return {
      action: 'warn',
      message: `node ${current} is running but .nvmrc pins ${want}: set ${NODE_VAR} to a Node ${want} binary`,
    };
  const version = await versionOf(bin);
  if (version !== null && major(version) === want) return { action: 'switch', bin, version };
  return {
    action: 'warn',
    message: `${NODE_VAR} (${bin}) is ${version ?? 'not runnable'} but .nvmrc pins ${want}`,
  };
}

/** An env override that puts `dir` first on PATH, keeping the key's existing spelling (Path on Windows). */
export function pathFirst(dir, env = process.env) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  return { [key]: env[key] ? `${dir}${path.delimiter}${env[key]}` : dir };
}

/**
 * Re-runs this script (`argv` = process.argv) under the pinned Node when this one is not it.
 * `code` is the child's exit code, or null when the caller should carry on in this process;
 * `warning` is set when it carries on under a Node .nvmrc does not pin.
 */
export async function runUnderPinnedNode(root, argv = process.argv, opts = {}) {
  const choice = await nodeChoice(root, opts);
  if (choice.action === 'stay') return { code: null, warning: null };
  if (choice.action === 'warn') return { code: null, warning: choice.message };
  const r = await run(choice.bin, argv.slice(1), {
    cwd: root,
    env: pathFirst(path.dirname(choice.bin), opts.env),
  });
  return { code: r.code ?? 1, warning: null };
}
