#!/usr/bin/env node
// Downloads hash-pinned tool binaries (tools/tools.lock.json) into .tools/, verifying SHA-256 before
// extraction. Nothing is piped into a shell. Python tools install with `pip --require-hashes`.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, inflateRawSync } from 'node:zlib';
import { EXIT, isMain, parseArgs, readJson } from './guard/lib/common.mjs';
import { run, which } from './guard/lib/proc.mjs';

export function platformKey(platform = process.platform, arch = process.arch) {
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[platform];
  const cpu = { x64: 'x64', arm64: 'arm64' }[arch];
  return os && cpu ? `${os}-${cpu}` : null;
}

/** Minimal ustar reader: returns Map<basename, Buffer> of regular files. */
export function untar(buf) {
  const files = new Map();
  let off = 0;
  let longName = null;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const str = (s, e) => header.subarray(s, e).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const prefix = str(345, 500);
    let name = longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    const data = buf.subarray(off + 512, off + 512 + size);
    if (type === 'L') longName = data.toString('utf8').replace(/\0.*$/s, '');
    else if (type === '0' || type === '\0') files.set(path.posix.basename(name), Buffer.from(data));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Minimal zip reader (stored + deflate): returns Map<basename, Buffer>. */
export function unzip(buf) {
  const files = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    if (!name.endsWith('/'))
      files.set(path.posix.basename(name), method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function fetchBinaryTool(root, name, tool) {
  const key = platformKey();
  const art = key && tool.platforms[key];
  if (!art) {
    process.stdout.write(
      `- ${name}: no pinned build for ${key ?? `${process.platform}-${process.arch}`}; skipped\n`,
    );
    return EXIT.OK;
  }
  const dir = path.join(root, '.tools', name);
  const marker = path.join(dir, '.installed');
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === art.sha256) {
    process.stdout.write(`✔ ${name} ${tool.version} (cached)\n`);
    return EXIT.OK;
  }
  const res = await fetch(art.url);
  if (!res.ok) throw new Error(`${name}: download failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const digest = createHash('sha256').update(buf).digest('hex');
  if (digest !== art.sha256)
    throw new Error(`${name}: SHA-256 mismatch (got ${digest}, pinned ${art.sha256})`);
  const entries = art.url.endsWith('.zip') ? unzip(buf) : untar(gunzipSync(buf));
  const exe = process.platform === 'win32' ? `${tool.binary}.exe` : tool.binary;
  const data = entries.get(exe);
  if (!data) throw new Error(`${name}: ${exe} not found in archive`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, exe), data);
  chmodSync(path.join(dir, exe), 0o755);
  writeFileSync(marker, `${art.sha256}\n`);
  process.stdout.write(`✔ ${name} ${tool.version} (verified ${digest.slice(0, 12)}…)\n`);
  return EXIT.OK;
}

async function installPythonTool(root, name, tool) {
  if (!tool.platforms.includes(process.platform)) {
    process.stdout.write(
      `- ${name}: not supported on ${process.platform}; skipped (runs in CI on Linux)\n`,
    );
    return EXIT.OK;
  }
  const reqs = readFileSync(path.join(root, tool.requirements), 'utf8');
  const want = createHash('sha256').update(reqs).digest('hex');
  const venv = path.join(root, '.tools', 'venv');
  const marker = path.join(venv, `.${name}-installed`);
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === want) {
    process.stdout.write(`✔ ${name} ${tool.version} (cached)\n`);
    return EXIT.OK;
  }
  const py = which('python3') ?? which('python');
  if (!py) throw new Error(`${name}: python3 is required to install it`);
  if (!existsSync(path.join(venv, 'pyvenv.cfg'))) {
    const r = await run(py[0], [...py[1], '-m', 'venv', venv], { capture: true });
    if (r.code !== 0) throw new Error(`${name}: venv creation failed: ${r.stderr}`);
  }
  const pip = path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin', 'pip');
  const r = await run(
    pip,
    [
      'install',
      '--quiet',
      '--disable-pip-version-check',
      '--require-hashes',
      '--only-binary',
      ':all:',
      '-r',
      path.join(root, tool.requirements),
    ],
    { capture: true },
  );
  if (r.code !== 0) throw new Error(`${name}: pip install failed:\n${r.stderr.slice(-2000)}`);
  writeFileSync(marker, `${want}\n`);
  process.stdout.write(`✔ ${name} ${tool.version} (hash-verified wheels)\n`);
  return EXIT.OK;
}

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const lock = readJson(root, 'tools/tools.lock.json');
  const wanted = positional.length
    ? positional
    : [...Object.keys(lock.binaries), ...Object.keys(lock.python)];
  for (const name of wanted) {
    if (lock.binaries[name]) await fetchBinaryTool(root, name, lock.binaries[name]);
    else if (lock.python[name]) await installPythonTool(root, name, lock.python[name]);
    else throw new Error(`unknown tool ${name}`);
  }
  return EXIT.OK;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`tools-fetch: ${err.message}\n`);
      process.exit(EXIT.TOOL);
    },
  );
}
