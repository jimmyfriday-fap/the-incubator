import { Eta } from 'eta/core';
import { ToolError, sha256Hex, stableJson } from '@incubator/runtime';
import { serializeSpec, specHash, type IncubatorSpec } from '@incubator/spec';
import { makeHelpers } from './helpers.js';
import { applyJsonPatch } from './json-patch.js';
import { applyMarkerPatch, scanMarkers } from './markers.js';
import { looksBinary, normalizeText } from './normalize.js';
import type { Pack } from './pack.js';
import { loadRegistry, packRefs, selectPacks, type PackRegistry } from './registry.js';
import { SHADOWED_GLOBALS } from './template-lint.js';
import { evaluateWhen } from './when.js';

export interface RenderedFile {
  path: string;
  bytes: Buffer;
  mode: '0644' | '0755';
  pack: string;
  role?: string;
}

export interface LockFile {
  lockVersion: 1;
  incubatorVersion: string;
  specHash: string;
  packs: { id: string; version: string; integrity: string }[];
  files: Record<string, { sha256: string; pack: string; mode: string }>;
}

export interface RenderResult {
  files: Map<string, RenderedFile>;
  packs: Pack[];
  lock: LockFile;
}

export const PAIRED_PREFIX = '@paired/';
export const LOCK_PATH = '.incubator/lock.json';

const eta = new Eta({
  autoEscape: false,
  useWith: false,
  autoTrim: false,
  cache: false,
  // why: runtime shadowing of time/random/env/IO globals behind the template lint (ADR-003).
  functionHeader: `const ${SHADOWED_GLOBALS.map((g) => `${g} = undefined`).join(', ')};`,
});

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

function lookup(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      obj,
    );
}

interface Ctx {
  spec: IncubatorSpec;
  names: Record<string, string>;
  v: Record<string, unknown>;
  h: ReturnType<typeof makeHelpers>;
  features: { id: string; summary: string; lane: string; builtin: boolean }[];
  pack: { id: string; version: string };
  [k: string]: unknown;
}

function baseContext(spec: IncubatorSpec, reg: PackRegistry): Omit<Ctx, 'pack'> {
  const h = makeHelpers(reg.actionsLock);
  const slug = spec.project.slug;
  const names = {
    slug,
    pascal: h.pascal(slug),
    camel: h.camel(slug),
    snake: h.snake(slug),
    upperSnake: h.upperSnake(slug),
    title: h.safeText(spec.project.name, 100),
    description: h.safeText(spec.project.description, 500),
    pairedName: spec.testing.pairedRepo?.name ?? `${slug}-tests`,
  };
  const features = [
    {
      id: 'health',
      summary: 'Service health and readiness',
      lane: 'enhancement/new',
      builtin: true,
    },
    ...spec.intent.coreFeatures.map((f) => ({
      id: f.id,
      summary: h.safeText(f.summary, 300),
      lane: f.lane,
      builtin: false,
    })),
  ];
  return deepFreeze({
    spec: structuredClone(spec),
    names,
    v: structuredClone(reg.versions),
    h,
    features,
  });
}

function renderString(template: string, data: Record<string, unknown>, where: string): string {
  try {
    return eta.renderString(template, data);
  } catch (e) {
    throw new ToolError(
      `template ${where} failed: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`,
      { code: 'template_error' },
    );
  }
}

function isMarkdown(p: string): boolean {
  return /\.(md|mdc)$/i.test(p);
}

function textOf(f: RenderedFile): string {
  return f.bytes.toString('utf8');
}

/**
 * Pure render (ADR-004): spec + pack set → files. No clock, no env, no network. The same inputs give
 * byte-identical output.
 */
export function render(
  spec: IncubatorSpec,
  reg: PackRegistry = loadRegistry(),
  opts: { incubatorVersion?: string } = {},
): RenderResult {
  const packs = selectPacks(reg, spec);
  const base = baseContext(spec, reg);
  const whenCtx = { ...(spec as unknown as Record<string, unknown>), spec, names: base.names };
  const files = new Map<string, RenderedFile>();
  const put = (f: RenderedFile) => {
    const prev = files.get(f.path);
    if (prev)
      throw new ToolError(
        `${f.pack} emits ${f.path}, already owned by ${prev.pack}; later packs patch through markers`,
        { code: 'pack_collision' },
      );
    files.set(f.path, f);
  };

  for (const pack of packs) {
    const packCtx = { ...base, pack: { id: pack.manifest.id, version: pack.manifest.version } };
    for (const entry of pack.manifest.files) {
      if (entry.when && !entry.each && !evaluateWhen(entry.when, whenCtx)) continue;
      const items: unknown[] = entry.each
        ? ((lookup({ ...whenCtx, features: base.features }, entry.each) as unknown[] | undefined) ??
          [])
        : [undefined];
      for (const item of items) {
        const data: Record<string, unknown> = {
          ...packCtx,
          ...(entry.vars ? { vars: entry.vars } : {}),
        };
        if (entry.each) data[entry.as ?? 'item'] = item;
        if (
          entry.each &&
          entry.when &&
          !evaluateWhen(entry.when, { ...whenCtx, [entry.as ?? 'item']: item })
        )
          continue;
        const sources = entry.src.endsWith('/**')
          ? [...pack.files.keys()]
              .filter((k) => k.startsWith(entry.src.slice(0, -2)))
              .map((k) => [k, k.slice(entry.src.length - 2)] as const)
          : [[entry.src, ''] as const];
        for (const [src, rel] of sources) {
          const destTemplate = entry.src.endsWith('/**') ? entry.dest + rel : entry.dest;
          const dest = renderString(
            destTemplate,
            data,
            `${pack.manifest.id}:${src} (dest)`,
          ).replace(/\.eta$/, '');
          const raw = pack.files.get(src)!;
          const bytes = src.endsWith('.eta')
            ? Buffer.from(
                renderString(raw.toString('utf8'), data, `${pack.manifest.id}:${src}`),
                'utf8',
              )
            : raw;
          put({
            path: dest,
            bytes,
            mode: entry.mode ?? '0644',
            pack: pack.manifest.id,
            ...(entry.role ? { role: entry.role } : {}),
          });
        }
      }
    }
  }

  // Relocations (paired tests repository) happen before patches so patches can target either root.
  for (const pack of packs) {
    for (const r of pack.manifest.relocate ?? []) {
      if (r.when && !evaluateWhen(r.when, whenCtx)) continue;
      for (const f of [...files.values()]) {
        if (f.role !== r.role || f.path.startsWith('@')) continue;
        files.delete(f.path);
        put({ ...f, path: `${r.to}${f.path}` });
      }
    }
  }

  for (const pack of packs) {
    const packCtx = { ...base, pack: { id: pack.manifest.id, version: pack.manifest.version } };
    for (const mp of pack.manifest.markerPatches ?? []) {
      if (mp.when && !evaluateWhen(mp.when, whenCtx)) continue;
      const target = files.get(mp.file);
      if (!target)
        throw new ToolError(`${pack.manifest.id}: marker patch targets missing file ${mp.file}`, {
          code: 'patch_target',
        });
      const entries = mp.entries
        .filter((e) => !e.when || evaluateWhen(e.when, whenCtx))
        .map((e) => ({
          id: e.id,
          text: e.src
            ? renderString(
                pack.files.get(e.src)?.toString('utf8') ?? '',
                packCtx,
                `${pack.manifest.id}:${e.src}`,
              )
            : (e.text ?? ''),
        }));
      target.bytes = Buffer.from(
        applyMarkerPatch(mp.file, textOf(target), mp.region, entries),
        'utf8',
      );
    }
    for (const jp of pack.manifest.jsonPatches ?? []) {
      if (jp.when && !evaluateWhen(jp.when, whenCtx)) continue;
      const target = files.get(jp.file);
      if (!target)
        throw new ToolError(`${pack.manifest.id}: JSON patch targets missing file ${jp.file}`, {
          code: 'patch_target',
        });
      const ops = jp.ops
        .filter((o) => !o.when || evaluateWhen(o.when, whenCtx))
        .map((o) => ({
          op: o.op,
          pointer: o.pointer,
          value: o.valueSrc
            ? (JSON.parse(
                renderString(
                  pack.files.get(o.valueSrc)?.toString('utf8') ?? 'null',
                  packCtx,
                  o.valueSrc,
                ),
              ) as unknown)
            : o.value,
        }));
      const doc = applyJsonPatch(jp.file, JSON.parse(textOf(target)) as unknown, ops);
      target.bytes = Buffer.from(`${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    }
  }

  for (const f of files.values()) {
    if (!looksBinary(f.bytes))
      f.bytes = Buffer.from(normalizeText(textOf(f), { markdown: isMarkdown(f.path) }), 'utf8');
  }

  put({
    path: 'incubator.json',
    bytes: Buffer.from(serializeSpec(spec), 'utf8'),
    mode: '0644',
    pack: 'engine',
  });
  addContractsLock(files, '');
  if ([...files.keys()].some((k) => k.startsWith(PAIRED_PREFIX)))
    addContractsLock(files, PAIRED_PREFIX);

  const drift: string[] = [];
  for (const f of files.values()) {
    if (looksBinary(f.bytes)) continue;
    const t = textOf(f);
    if (!t.includes('scaffold:')) continue;
    for (const e of scanMarkers(t).errors) drift.push(`${f.path}: ${e}`);
  }
  if (drift.length)
    throw new ToolError(`rendered output has malformed scaffold markers:\n${drift.join('\n')}`, {
      code: 'render_drift',
    });

  const sorted = new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const lock: LockFile = {
    lockVersion: 1,
    incubatorVersion: opts.incubatorVersion ?? '0.1.0',
    specHash: specHash(spec),
    packs: packs.map((p) => ({
      id: p.manifest.id,
      version: p.manifest.version,
      integrity: p.integrity,
    })),
    files: Object.fromEntries(
      [...sorted.values()].map((f) => [
        f.path,
        { sha256: sha256Hex(f.bytes), pack: f.pack, mode: f.mode },
      ]),
    ),
  };
  sorted.set(LOCK_PATH, {
    path: LOCK_PATH,
    bytes: Buffer.from(stableJson(lock), 'utf8'),
    mode: '0644',
    pack: 'engine',
  });
  return {
    files: new Map([...sorted.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    packs,
    lock,
  };
}

/** contracts.lock.json for one root, mirroring scripts/guard/contracts-pin.mjs. */
function addContractsLock(files: Map<string, RenderedFile>, prefix: string): void {
  const cfg = files.get(`${prefix}config/contracts.json`);
  if (!cfg) return;
  const pinned = (JSON.parse(textOf(cfg)) as { pinned: string[] }).pinned.map(globToRegExp);
  const entries: Record<string, string> = {};
  for (const [p, f] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!p.startsWith(prefix)) continue;
    const rel = p.slice(prefix.length);
    if (rel.startsWith('@')) continue;
    if (pinned.some((re) => re.test(rel)))
      entries[rel] = sha256Hex(textOf(f).replace(/\r\n?/g, '\n'));
  }
  files.set(`${prefix}contracts.lock.json`, {
    path: `${prefix}contracts.lock.json`,
    bytes: Buffer.from(`${JSON.stringify({ files: entries }, null, 2)}\n`, 'utf8'),
    mode: '0644',
    pack: 'engine',
  });
}

/** Same glob dialect as the guard toolkit. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        re += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += `(?:${glob
        .slice(i + 1, end)
        .split(',')
        .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
        .join('|')})`;
      i = end;
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export { packRefs };
