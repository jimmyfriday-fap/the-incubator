import { canonicalize, sha256Hex } from '@incubator/runtime';
import { analyze, type Analysis } from './detectors.js';
import type { RepoView, ViewStats } from './repo-view.js';

/**
 * Deep scan (TDD §7.4, ADR-021). Pure and deterministic: manifest parsing and regexes over the
 * files a `RepoView` exposes. Nothing here executes repository code, and every string that came out
 * of the repository is cleaned and length-capped before it is stored (threat T6).
 */

export const SCAN_CAPS = {
  entryPoints: 40,
  edges: 500,
  modules: 200,
  dependencies: 150,
  routes: 200,
  commands: 100,
  models: 200,
  screens: 200,
  roles: 20,
  workflows: 50,
  topDirs: 30,
  largest: 10,
  /** Source files read for imports, routes and models. */
  sourceReads: 3000,
  text: 160,
} as const;

export interface EntryPoint {
  file: string;
  kind: 'package-main' | 'package-bin' | 'script' | 'conventional' | 'docker' | 'plugin';
  note: string;
}
export interface ModuleInfo {
  dir: string;
  files: number;
  languages: string[];
}
export interface ModuleEdge {
  from: string;
  to: string;
  count: number;
}
export interface DependencyList {
  file: string;
  manager: 'npm' | 'pip' | 'composer' | 'pub';
  runtime: string[];
  dev: string[];
}
export interface RouteInfo {
  method: string;
  path: string;
  file: string;
  framework: string;
}
export interface CommandInfo {
  name: string;
  file: string;
  kind: string;
}
export interface ModelInfo {
  name: string;
  file: string;
  kind: string;
}
/** A screen of an app: the route that opens it, its widget, the file it lives in, and its feature area. */
export interface ScreenInfo {
  path: string | null;
  widget: string;
  file: string;
  area: string | null;
}
/** A user-role enumeration the app declares (SQL enum or Dart enum), with its values. */
export interface RoleInfo {
  name: string;
  values: string[];
  file: string;
  kind: 'sql-enum' | 'dart-enum';
}
export interface CiInfo {
  file: string;
  system: string;
  triggers: string[];
}
export interface Conventions {
  lint: string[];
  format: string[];
  typecheck: string[];
  hooks: string[];
  fileNaming: string;
}
export interface Inventory {
  languages: { language: string; files: number }[];
  topDirs: { dir: string; files: number }[];
  largest: { file: string; chars: number }[];
}

export interface RepoScan {
  /** What the view could and could not show (ADR-021). */
  coverage: ViewStats;
  analysis: Analysis;
  entryPoints: EntryPoint[];
  modules: ModuleInfo[];
  edges: ModuleEdge[];
  dependencies: DependencyList[];
  routes: RouteInfo[];
  commands: CommandInfo[];
  dataModel: ModelInfo[];
  /** Present only when screens were found (Dart/Flutter today): what the app shows. */
  screens?: ScreenInfo[];
  /** Present only when role enumerations were found: who the app is for. */
  roles?: RoleInfo[];
  tests: {
    runners: string[];
    files: number;
    count: number;
    dirs: string[];
    coverageSignals: string[];
  };
  ci: CiInfo[];
  conventions: Conventions;
  inventory: Inventory;
  /** Every list that was cut short, and how. */
  notes: string[];
}

/** Strips control and bidi characters and caps length: repository text is data, never instructions. */
export function clean(value: string, max: number = SCAN_CAPS.text): string {
  const s = value.replace(
    // eslint-disable-next-line no-control-regex -- why: control characters are exactly what is stripped.
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
    ' ',
  );
  // The digest is fenced with <<< … >>> markers; repository text must not be able to forge one.
  const t = s
    .replace(/<<<|>>>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  php: 'PHP',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  rb: 'Ruby',
  cs: 'C#',
  sql: 'SQL',
  sh: 'Shell',
  css: 'CSS',
  scss: 'CSS',
  html: 'HTML',
  md: 'Markdown',
  json: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  prisma: 'Prisma',
  dart: 'Dart',
};
const SOURCE_LANGS = new Set(['TypeScript', 'JavaScript', 'Python', 'PHP', 'Dart']);

/** Code-unit order: identical on every platform, unlike `localeCompare` (ICU-dependent). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ext(file: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(file);
  return m ? m[1]!.toLowerCase() : '';
}
function language(file: string): string | null {
  return LANGUAGES[ext(file)] ?? null;
}
function dirOf(file: string): string {
  const i = file.lastIndexOf('/');
  return i < 0 ? '.' : file.slice(0, i);
}
/**
 * A module is a source file's directory, cut at two levels (`src/routes/users.js` → `src/routes`).
 * A Dart package keeps its code under `lib/`, and a feature there is a module of its own
 * (`lib/features/meet/meet_screen.dart` → `lib/features/meet`, `cli/lib/src/commands/x.dart` →
 * `cli/lib/src/commands`), which a two-level cut would collapse into one.
 */
function moduleOf(file: string): string {
  const d = dirOf(file);
  if (d === '.') return '.';
  const parts = d.split('/');
  if (file.endsWith('.dart')) {
    const lib = parts.indexOf('lib');
    if (lib >= 0) {
      const rest = parts.slice(lib + 1);
      const keep = rest[0] === 'features' || rest[0] === 'src' ? 2 : 1;
      return parts.slice(0, lib + 1 + Math.min(keep, rest.length)).join('/');
    }
  }
  return parts.slice(0, 2).join('/');
}
/** Joins a relative import onto a file's directory without touching the filesystem. */
function resolveRel(from: string, rel: string): string {
  const parts = from === '.' ? [] : from.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

function json(view: RepoView, file: string): Record<string, unknown> | null {
  const t = view.read(file);
  if (t === null) return null;
  try {
    const v: unknown = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function record(v: unknown): Record<string, string> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
}

class Capped<T> {
  readonly items: T[] = [];
  seen = 0;
  constructor(private readonly cap: number) {}
  add(item: T): void {
    this.seen++;
    if (this.items.length < this.cap) this.items.push(item);
  }
  note(label: string, notes: string[]): void {
    if (this.seen > this.items.length)
      notes.push(`${label} truncated at ${this.cap} (of ${this.seen})`);
  }
}

// --- entry points ---------------------------------------------------------------------------

function entryPoints(view: RepoView): EntryPoint[] {
  const out: EntryPoint[] = [];
  const pkg = json(view, 'package.json');
  if (pkg) {
    for (const key of ['main', 'module']) {
      const v = pkg[key];
      if (typeof v === 'string')
        out.push({ file: clean(v), kind: 'package-main', note: `package.json ${key}` });
    }
    const bin = pkg['bin'];
    if (typeof bin === 'string') out.push({ file: clean(bin), kind: 'package-bin', note: 'bin' });
    else
      for (const [name, file] of Object.entries(record(bin)))
        out.push({
          file: clean(String(file)),
          kind: 'package-bin',
          note: `bin ${clean(name, 60)}`,
        });
    const scripts = record(pkg['scripts']);
    for (const key of ['start', 'dev', 'serve', 'build', 'test'])
      if (typeof scripts[key] === 'string')
        out.push({ file: 'package.json', kind: 'script', note: `${key}: ${clean(scripts[key])}` });
  }
  const conventional =
    /^(?:src\/)?(?:index|main|server|app|cli)\.(?:ts|tsx|js|mjs|cjs)$|^(?:main|app|manage|wsgi|asgi|__main__)\.py$|^src\/[\w-]+\/(?:main|app|__main__)\.py$/;
  for (const f of view.files)
    if (conventional.test(f))
      out.push({ file: f, kind: 'conventional', note: 'conventional name' });
  for (const f of view.files)
    if (/(?:^|\/)lib\/main\.dart$/.test(f) || /(?:^|\/)bin\/[\w-]+\.dart$/.test(f))
      out.push({ file: f, kind: 'conventional', note: 'Dart entry point' });
  for (const f of view.glob('**/Dockerfile*')) {
    const cmd = /^\s*(?:CMD|ENTRYPOINT)\s+(.+)$/m.exec(view.read(f) ?? '');
    if (cmd) out.push({ file: f, kind: 'docker', note: clean(cmd[0]) });
  }
  for (const f of view.files.filter((x) => /^[^/]+\.php$/.test(x)))
    if (/^[ \t/*#]*Plugin Name:/im.test(view.read(f) ?? ''))
      out.push({ file: f, kind: 'plugin', note: 'Plugin Name header' });
  const seen = new Set<string>();
  return out
    .filter((e) => {
      const k = `${e.kind}|${e.file}|${e.note}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => cmp(a.file, b.file) || cmp(a.note, b.note));
}

// --- dependencies -------------------------------------------------------------------------

function pyRequirements(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l && !l.startsWith('-'))
    .map((l) => clean(l, 80));
}

/**
 * The `dependencies:` and `dev_dependencies:` blocks of a pubspec, line by line (no YAML parser). An
 * entry is `name@version` when the line carries a version, else just the name (`sdk: flutter`, `git:`
 * and `path:` forms nest a deeper block, which is skipped).
 */
function pubDependencies(text: string): { runtime: string[]; dev: string[] } {
  const lists: Record<'runtime' | 'dev', string[]> = { runtime: [], dev: [] };
  let into: string[] | null = null;
  let indent: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const lead = raw.length - raw.trimStart().length;
    if (lead === 0) {
      const head = /^(dependencies|dev_dependencies):\s*(?:#.*)?$/.exec(raw);
      into = head ? (head[1] === 'dependencies' ? lists.runtime : lists.dev) : null;
      indent = null;
      continue;
    }
    if (!into) continue;
    indent ??= lead;
    if (lead !== indent) continue;
    const m = /^\s*([A-Za-z_][\w]*):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const version = m[2]!
      .replace(/\s+#.*$/, '')
      .replace(/^['"]|['"]$/g, '')
      .trim();
    into.push(clean(version ? `${m[1]!}@${version}` : m[1]!, 80));
  }
  return { runtime: lists.runtime.sort(), dev: lists.dev.sort() };
}

function dependencies(view: RepoView): DependencyList[] {
  const out: DependencyList[] = [];
  for (const file of view.glob('**/pubspec.yaml')) {
    const text = view.read(file);
    if (text !== null) out.push({ file, manager: 'pub', ...pubDependencies(text) });
  }
  for (const file of view.glob('**/package.json')) {
    const pkg = json(view, file);
    if (!pkg) continue;
    const fmt = (o: Record<string, string>): string[] =>
      Object.entries(o)
        .map(([n, v]) => clean(`${n}@${v}`, 80))
        .sort();
    out.push({
      file,
      manager: 'npm',
      runtime: fmt(record(pkg['dependencies'])),
      dev: fmt(record(pkg['devDependencies'])),
    });
  }
  for (const file of view.glob('**/requirements*.txt')) {
    const text = view.read(file);
    if (text !== null)
      out.push({
        file,
        manager: 'pip',
        runtime: pyRequirements(text).sort(),
        dev: [],
      });
  }
  for (const file of view.glob('**/pyproject.toml')) {
    const text = view.read(file) ?? '';
    const m = /^dependencies\s*=\s*\[([^\]]*)\]/m.exec(text);
    if (m)
      out.push({
        file,
        manager: 'pip',
        runtime: [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => clean(x[1]!, 80)).sort(),
        dev: [],
      });
  }
  for (const file of view.glob('**/composer.json')) {
    const c = json(view, file);
    if (!c) continue;
    const fmt = (o: Record<string, string>): string[] =>
      Object.entries(o)
        .map(([n, v]) => clean(`${n}@${v}`, 80))
        .sort();
    out.push({
      file,
      manager: 'composer',
      runtime: fmt(record(c['require'])),
      dev: fmt(record(c['require-dev'])),
    });
  }
  return out.sort((a, b) => cmp(a.file, b.file));
}

// --- source extraction --------------------------------------------------------------------

const JS_EXT = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Classes a go_router builder wraps a screen in; the screen is the class inside them. */
const DART_PAGE_WRAPPERS = new Set([
  'MaterialPage',
  'CupertinoPage',
  'NoTransitionPage',
  'CustomTransitionPage',
  'Scaffold',
  'Builder',
  'Consumer',
  'Material',
  'Center',
  'Container',
]);

function jsTargets(view: RepoView, from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolveRel(dirOf(from), spec);
  const stem = base.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
  const candidates = [
    base,
    ...JS_EXT.map((e) => stem + e),
    ...JS_EXT.map((e) => `${base}/index${e}`),
  ];
  return candidates.find((c) => view.has(c)) ?? null;
}

function pyTargets(view: RepoView, from: string, spec: string): string | null {
  const rel = /^\.+/.exec(spec);
  const dots = rel ? rel[0].length : 0;
  let base: string;
  if (dots) {
    let d = dirOf(from);
    for (let i = 1; i < dots; i++) d = dirOf(d);
    base = resolveRel(d, spec.slice(dots).replace(/\./g, '/'));
  } else base = spec.replace(/\./g, '/');
  return (
    [`${base}.py`, `${base}/__init__.py`, `src/${base}.py`, `src/${base}/__init__.py`].find((c) =>
      view.has(c),
    ) ?? null
  );
}

function phpTargets(view: RepoView, from: string, spec: string): string | null {
  const s = spec.replace(/^\/+/, '');
  return [resolveRel(dirOf(from), s), s].find((c) => view.has(c)) ?? null;
}

/** Dart package names to the directory of the pubspec that declares them. */
function dartPackages(view: RepoView): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of view.glob('**/pubspec.yaml')) {
    const name = /^name:\s*['"]?([A-Za-z_]\w*)/m.exec(view.read(f) ?? '')?.[1];
    if (name && !out.has(name)) out.set(name, dirOf(f));
  }
  return out;
}

/** A Dart import to the repository file it names: relative paths, and `package:<this repo's name>/…`. */
function dartTargets(
  view: RepoView,
  from: string,
  spec: string,
  pkgs: ReadonlyMap<string, string>,
): string | null {
  if (spec.startsWith('dart:')) return null;
  if (spec.startsWith('package:')) {
    const m = /^package:(\w+)\/(.+)$/.exec(spec);
    const dir = m ? pkgs.get(m[1]!) : undefined;
    if (!m || dir === undefined) return null;
    const target = dir === '.' ? `lib/${m[2]!}` : `${dir}/lib/${m[2]!}`;
    return view.has(target) ? target : null;
  }
  const target = resolveRel(dirOf(from), spec);
  return view.has(target) ? target : null;
}

interface Extracted {
  edges: Map<string, number>;
  routes: Capped<RouteInfo>;
  commands: Capped<CommandInfo>;
  models: Capped<ModelInfo>;
  screens: Capped<ScreenInfo>;
  roles: Capped<RoleInfo>;
}

function extract(view: RepoView, notes: string[]): Extracted {
  const edges = new Map<string, number>();
  const routes = new Capped<RouteInfo>(SCAN_CAPS.routes);
  const commands = new Capped<CommandInfo>(SCAN_CAPS.commands);
  const models = new Capped<ModelInfo>(SCAN_CAPS.models);
  const screens = new Capped<ScreenInfo>(SCAN_CAPS.screens);
  const roles = new Capped<RoleInfo>(SCAN_CAPS.roles);
  // Dart: widget classes by file, and the go_router routes found, resolved to screens once every file is read.
  const dartPkgs = dartPackages(view);
  const widgets = new Map<string, string>();
  const dartRoutes: { path: string; widget: string | null; file: string }[] = [];
  let goRoutes = 0;
  const source = view.files.filter(
    (f) => SOURCE_LANGS.has(language(f) ?? '') || ext(f) === 'sql' || ext(f) === 'prisma',
  );
  if (source.length > SCAN_CAPS.sourceReads)
    notes.push(`source reads truncated at ${SCAN_CAPS.sourceReads} (of ${source.length})`);
  for (const file of source.slice(0, SCAN_CAPS.sourceReads)) {
    const text = view.read(file);
    if (text === null) continue;
    const lang = language(file);
    const edge = (to: string | null): void => {
      if (!to) return;
      const a = moduleOf(file);
      const b = moduleOf(to);
      if (a === b) return;
      const k = `${a}\u0000${b}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    };
    if (lang === 'TypeScript' || lang === 'JavaScript') {
      for (const m of text.matchAll(
        /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g,
      ))
        edge(jsTargets(view, file, m[1]!));
      for (const m of text.matchAll(
        /\b(?:app|router|server|fastify|api|routes)\.(get|post|put|patch|delete|head|options|all)\(\s*['"`]([^'"`\n]+)['"`]/g,
      ))
        routes.add({ method: m[1]!.toUpperCase(), path: clean(m[2]!), file, framework: 'node' });
      for (const m of text.matchAll(/\.command\(\s*['"]([^'"\n]+)['"]/g))
        commands.add({ name: clean(m[1]!, 60), file, kind: 'commander' });
      for (const m of text.matchAll(/\bmongoose\.model\(\s*['"](\w+)['"]/g))
        models.add({ name: clean(m[1]!, 60), file, kind: 'mongoose' });
      for (const m of text.matchAll(/\bsequelize\.define\(\s*['"](\w+)['"]/g))
        models.add({ name: clean(m[1]!, 60), file, kind: 'sequelize' });
      for (const m of text.matchAll(/@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g))
        models.add({ name: clean(m[1]!, 60), file, kind: 'typeorm' });
    } else if (lang === 'Python') {
      for (const m of text.matchAll(/^[ \t]*from\s+(\.*[\w.]*)\s+import\b/gm))
        edge(pyTargets(view, file, m[1]!));
      for (const m of text.matchAll(/^[ \t]*import\s+([\w.]+)/gm))
        edge(pyTargets(view, file, m[1]!));
      for (const m of text.matchAll(
        /^@(\w+)\.(get|post|put|patch|delete)\(\s*['"]([^'"\n]+)['"]/gm,
      ))
        routes.add({ method: m[2]!.toUpperCase(), path: clean(m[3]!), file, framework: 'fastapi' });
      for (const m of text.matchAll(/^@(\w+)\.route\(\s*['"]([^'"\n]+)['"]([^)\n]*)\)/gm)) {
        const methods = /methods\s*=\s*\[([^\]]*)\]/.exec(m[3]!);
        const list = methods
          ? [...methods[1]!.matchAll(/['"](\w+)['"]/g)].map((x) => x[1]!.toUpperCase())
          : ['GET'];
        for (const method of list)
          routes.add({ method, path: clean(m[2]!), file, framework: 'flask' });
      }
      if (/(^|\/)urls\.py$/.test(file))
        for (const m of text.matchAll(/\b(?:re_)?path\(\s*r?['"]([^'"\n]*)['"]/g))
          routes.add({ method: 'ANY', path: clean(`/${m[1]!}`), file, framework: 'django' });
      for (const m of text.matchAll(/\.add_parser\(\s*['"]([\w-]+)['"]/g))
        commands.add({ name: clean(m[1]!, 60), file, kind: 'argparse' });
      for (const m of text.matchAll(
        /^class\s+(\w+)\(\s*[\w.]*(?:Base|Model|DeclarativeBase|SQLModel)\b[\w.]*/gm,
      ))
        models.add({ name: clean(m[1]!, 60), file, kind: 'orm' });
    } else if (lang === 'PHP') {
      for (const m of text.matchAll(
        /\b(?:require|include)(?:_once)?\b[^;'"\n]*['"]([^'"\n]+\.php)['"]/g,
      ))
        edge(phpTargets(view, file, m[1]!));
      for (const m of text.matchAll(
        /\bregister_rest_route\(\s*['"]([^'"\n]+)['"]\s*,\s*['"]([^'"\n]+)['"]/g,
      ))
        routes.add({
          method: 'REST',
          path: clean(`/${m[1]!.replace(/^\/+/, '')}/${m[2]!.replace(/^\/+/, '')}`),
          file,
          framework: 'wordpress',
        });
      for (const m of text.matchAll(/\badd_action\(\s*['"]wp_ajax_(?:nopriv_)?(\w+)['"]/g))
        routes.add({ method: 'AJAX', path: clean(m[1]!, 80), file, framework: 'wordpress' });
      for (const m of text.matchAll(/\badd_shortcode\(\s*['"]([\w-]+)['"]/g))
        commands.add({ name: clean(m[1]!, 60), file, kind: 'shortcode' });
      for (const m of text.matchAll(/\bWP_CLI::add_command\(\s*['"]([^'"\n]+)['"]/g))
        commands.add({ name: clean(m[1]!, 60), file, kind: 'wp-cli' });
      for (const m of text.matchAll(/\bregister_post_type\(\s*['"](\w+)['"]/g))
        models.add({ name: clean(m[1]!, 60), file, kind: 'post-type' });
    } else if (lang === 'Dart') {
      for (const m of text.matchAll(/^[ \t]*(?:import|export|part)\s+['"]([^'"\n]+)['"]/gm))
        edge(dartTargets(view, file, m[1]!, dartPkgs));
      // A widget class, so a route's builder can be traced to the file that holds the screen.
      for (const m of text.matchAll(
        /^(?:final\s+)?class\s+(\w+)\s+extends\s+(?:Consumer|HookConsumer|Hook)?(?:Stateful|Stateless)?Widget\b/gm,
      )) {
        const known = widgets.get(m[1]!);
        if (known === undefined || cmp(file, known) < 0) widgets.set(m[1]!, file);
      }
      // go_router: literal paths only; the widget is the first screen class the builder constructs.
      // Tests build mock routers of their own, so only app code counts.
      const inTests = /(?:^|\/)test\//.test(file) || file.endsWith('_test.dart');
      if (!inTests) goRoutes += text.match(/\bGoRoute\s*\(/g)?.length ?? 0;
      const starts = [...text.matchAll(/\b(?:GoRoute|ShellRoute|StatefulShellRoute)\s*\(/g)].map(
        (x) => x.index,
      );
      for (const m of inTests
        ? []
        : text.matchAll(/\bGoRoute\s*\(\s*(?:name:\s*[^,]+,\s*)?path:\s*(['"])([^'"\n]+)\1/g)) {
        const from = m.index + m[0].length;
        const next = starts.find((i) => i > m.index);
        const body = text.slice(from, Math.min(next ?? Infinity, from + 800));
        const builder = /\b(?:builder|pageBuilder)\s*:/.exec(body);
        const widget = builder
          ? [
              ...body
                .slice(builder.index)
                .matchAll(/(?:=>|\breturn\b|\bchild:)\s*(?:const\s+)?([A-Z]\w*)\s*\(/g),
            ]
              .map((x) => x[1]!)
              .find((w) => !DART_PAGE_WRAPPERS.has(w))
          : undefined;
        dartRoutes.push({ path: m[2]!, widget: widget ?? null, file });
      }
      // `args` commands: a project often wraps `Command` in a base class of its own (`extends RsCommand`).
      if (/\bextends\s+\w*Command\b/.test(text))
        for (const m of text.matchAll(
          /^[ \t]*(?:@override\s+)?String get name\s*=>\s*['"]([^'"\n]+)['"]/gm,
        ))
          commands.add({ name: clean(m[1]!, 60), file, kind: 'args' });
      for (const m of text.matchAll(/^final\s+(\w+Provider)\s*=\s*(\w+)/gm))
        if (/Provider|Notifier/.test(m[2]!))
          models.add({ name: clean(m[1]!, 60), file, kind: 'riverpod' });
      for (const m of text.matchAll(/^enum\s+(\w*Role\w*)\b[^{]*\{([^}]*)\}/gm)) {
        const values = [
          ...new Set(
            m[2]!
              .split(';')[0]!
              .split(',')
              .map((v) => /^\s*(\w+)/.exec(v)?.[1])
              .filter((v): v is string => v !== undefined),
          ),
        ];
        roles.add({
          name: clean(m[1]!, 60),
          values: values.slice(0, 12).map((v) => clean(v, 40)),
          file,
          kind: 'dart-enum',
        });
      }
    }
    if (lang === 'SQL')
      for (const m of text.matchAll(
        /\bcreate\s+type\s+(?:[\w"]+\.)?["`]?(\w*role\w*)["`]?\s+as\s+enum\s*\(([^)]*)\)/gi,
      ))
        roles.add({
          name: clean(m[1]!, 60),
          values: [...m[2]!.matchAll(/'([^'\n]*)'/g)].slice(0, 12).map((v) => clean(v[1]!, 40)),
          file,
          kind: 'sql-enum',
        });
    if (lang === 'SQL' || lang === 'PHP')
      for (const m of text.matchAll(
        /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:\{\$\w+->prefix\}|\$\w+->prefix\s*\.\s*['"])?[`"[]?([\w.]+)/gi,
      ))
        models.add({ name: clean(m[1]!.replace(/^public\./i, ''), 60), file, kind: 'sql-table' });
    if (lang === 'Prisma')
      for (const m of text.matchAll(/^model\s+(\w+)\s*\{/gm))
        models.add({ name: clean(m[1]!, 60), file, kind: 'prisma' });
  }
  // go_router routes, each traced to the screen's file when its builder names a widget the scan found.
  const routed = new Set<string>();
  const areaOf = (f: string): string | null =>
    /(?:^|\/)lib\/features\/([^/]+)\//.exec(f)?.[1] ?? null;
  for (const r of dartRoutes.sort((a, b) => cmp(a.file, b.file) || cmp(a.path, b.path))) {
    const home = r.widget ? widgets.get(r.widget) : undefined;
    routes.add({
      method: 'ROUTE',
      path: clean(r.path),
      file: home ?? r.file,
      framework: 'go_router',
    });
    if (r.widget && home) {
      routed.add(r.widget);
      screens.add({
        path: clean(r.path),
        widget: clean(r.widget, 60),
        file: home,
        area: areaOf(home),
      });
    }
  }
  const literal = dartRoutes.length;
  if (goRoutes > literal)
    notes.push(`${goRoutes - literal} go_router routes use a non-literal path and are not listed`);
  // Screens no route points at (opened by navigation code, or by a route form the scan does not read).
  for (const [widget, file] of [...widgets.entries()].sort(
    (a, b) => cmp(a[1], b[1]) || cmp(a[0], b[0]),
  ))
    if (!routed.has(widget) && /(?:Screen|Dashboard|Page)$/.test(widget))
      screens.add({ path: null, widget: clean(widget, 60), file, area: areaOf(file) });
  screens.note('screens', notes);
  roles.note('roles', notes);
  return { edges, routes, commands, models, screens, roles };
}

// --- ci, conventions, tests ----------------------------------------------------------------

function workflowTriggers(text: string): string[] {
  const inline = /^on:[ \t]*(\S.*)$/m.exec(text);
  if (inline) return [...inline[1]!.matchAll(/[\w-]+/g)].map((m) => m[0]).sort();
  const block = /^on:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/m.exec(text);
  if (!block) return [];
  const indent = /^([ \t]+)\S/m.exec(block[1]!);
  if (!indent) return [];
  const re = new RegExp(`^${indent[1]!}([\\w-]+):`, 'gm');
  return [...block[1]!.matchAll(re)].map((m) => m[1]!).sort();
}

function ci(view: RepoView): CiInfo[] {
  const out: CiInfo[] = [];
  for (const f of view.glob('.github/workflows/*.{yml,yaml}'))
    out.push({ file: f, system: 'github-actions', triggers: workflowTriggers(view.read(f) ?? '') });
  for (const [file, system] of [
    ['.gitlab-ci.yml', 'gitlab-ci'],
    ['.circleci/config.yml', 'circleci'],
    ['azure-pipelines.yml', 'azure-pipelines'],
    ['Jenkinsfile', 'jenkins'],
    ['bitbucket-pipelines.yml', 'bitbucket'],
  ] as const)
    if (view.has(file)) out.push({ file, system, triggers: [] });
  return out.sort((a, b) => cmp(a.file, b.file));
}

function namingOf(base: string): string {
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(base)) return 'kebab-case';
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(base)) return 'snake_case';
  if (
    /^[A-Z][A-Za-z0-9]*$/.test(base) &&
    /[a-z]/.test(base) &&
    /[A-Z].*[A-Z]|[A-Z][a-z]/.test(base)
  )
    return 'PascalCase';
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(base)) return 'camelCase';
  return 'single-word';
}

function conventions(view: RepoView): Conventions {
  const has = (p: string): boolean => view.glob(p).length > 0;
  const pkg = json(view, 'package.json');
  const pyproject = view.read('pyproject.toml') ?? '';
  const lint: string[] = [];
  const format: string[] = [];
  const typecheck: string[] = [];
  const hooks: string[] = [];
  if (has('eslint.config.*') || has('.eslintrc*') || (pkg && 'eslintConfig' in pkg))
    lint.push('eslint');
  if (has('.flake8') || /\[tool\.flake8\]/.test(pyproject)) lint.push('flake8');
  if (has('ruff.toml') || has('.ruff.toml') || /\[tool\.ruff/.test(pyproject)) lint.push('ruff');
  if (has('phpcs.xml*') || has('.phpcs.xml*')) lint.push('phpcs');
  if (has('.golangci.*')) lint.push('golangci-lint');
  if (has('.prettierrc*') || has('prettier.config.*') || (pkg && 'prettier' in pkg))
    format.push('prettier');
  if (has('.editorconfig')) format.push('editorconfig');
  if (/\[tool\.black\]/.test(pyproject)) format.push('black');
  if (has('tsconfig*.json')) {
    const strict = /"strict"\s*:\s*true/.test(view.read('tsconfig.json') ?? '');
    typecheck.push(strict ? 'tsc (strict)' : 'tsc');
  }
  if (has('mypy.ini') || /\[tool\.mypy\]/.test(pyproject)) typecheck.push('mypy');
  if (has('**/pubspec.yaml')) {
    // Dart: the analyzer's rule set comes from the options file's `include:` (flutter_lints, lints, …).
    const options =
      view.read('analysis_options.yaml') ??
      view.read(view.glob('**/analysis_options.yaml')[0] ?? '') ??
      '';
    const rules = /^include:\s*package:(\w+)\//m.exec(options)?.[1];
    if (has('**/analysis_options.yaml')) lint.push(rules ? clean(rules, 40) : 'dart analyze');
    format.push('dart format');
    typecheck.push(
      /strict-(?:casts|inference|raw-types):\s*true/.test(options)
        ? 'dart analyzer (strict)'
        : 'dart analyzer',
    );
  }
  if (has('phpstan.neon*')) typecheck.push('phpstan');
  if (has('lefthook.yml') || has('.lefthook.yml')) hooks.push('lefthook');
  if (has('.husky/*')) hooks.push('husky');
  if (has('.pre-commit-config.yaml')) hooks.push('pre-commit');

  const counts = new Map<string, number>();
  for (const f of view.files) {
    if (!SOURCE_LANGS.has(language(f) ?? '')) continue;
    const base = f.slice(f.lastIndexOf('/') + 1).replace(/(?:\.test|\.spec)?\.[A-Za-z0-9]+$/, '');
    const n = namingOf(base);
    if (n !== 'single-word') counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0];
  const fileNaming =
    !top || total === 0 ? 'undetermined' : top[1] / total >= 0.6 ? top[0] : 'mixed';
  return { lint, format, typecheck, hooks, fileNaming };
}

function testLayout(view: RepoView): { dirs: string[]; coverageSignals: string[] } {
  const dirs = new Set<string>();
  for (const f of view.files) {
    const m = /^((?:.*\/)?(?:tests?|__tests__|spec|e2e))\//.exec(f);
    if (m) dirs.add(m[1]!);
    else if (/\.(?:test|spec)\.[A-Za-z0-9]+$/.test(f) || /(?:^|\/)test_\w+\.py$/.test(f))
      dirs.add('(co-located)');
  }
  const signals: string[] = [];
  const pkg = json(view, 'package.json');
  const pyproject = view.read('pyproject.toml') ?? '';
  for (const f of view.glob('{vitest,vite}.config.*'))
    if (/coverage/.test(view.read(f) ?? '')) signals.push(`${f}: coverage config`);
  for (const f of view.glob('jest.config.*'))
    if (/coverageThreshold/.test(view.read(f) ?? '')) signals.push(`${f}: coverageThreshold`);
  if (pkg && ('c8' in pkg || 'nyc' in pkg)) signals.push('package.json: c8/nyc');
  for (const f of ['.coveragerc', '.nycrc', '.nycrc.json', 'codecov.yml', '.codecov.yml'])
    if (view.has(f)) signals.push(f);
  if (/\[tool\.coverage/.test(pyproject)) signals.push('pyproject.toml: tool.coverage');
  for (const f of view.glob('phpunit.xml*'))
    if (/<coverage|<source/.test(view.read(f) ?? '')) signals.push(`${f}: coverage`);
  return { dirs: [...dirs].sort(), coverageSignals: signals.sort() };
}

function inventory(view: RepoView): Inventory {
  const langs = new Map<string, number>();
  const dirs = new Map<string, number>();
  const sized: { file: string; chars: number }[] = [];
  for (const f of view.files) {
    const l = language(f);
    if (l) langs.set(l, (langs.get(l) ?? 0) + 1);
    const top = f.includes('/') ? f.slice(0, f.indexOf('/')) : '.';
    dirs.set(top, (dirs.get(top) ?? 0) + 1);
    if (SOURCE_LANGS.has(l ?? '')) {
      const t = view.read(f);
      if (t !== null) sized.push({ file: f, chars: t.length });
    }
  }
  return {
    languages: [...langs.entries()]
      .map(([language, files]) => ({ language, files }))
      .sort((a, b) => b.files - a.files || cmp(a.language, b.language)),
    topDirs: [...dirs.entries()]
      .map(([dir, files]) => ({ dir, files }))
      .sort((a, b) => b.files - a.files || cmp(a.dir, b.dir))
      .slice(0, SCAN_CAPS.topDirs),
    largest: sized
      .sort((a, b) => b.chars - a.chars || cmp(a.file, b.file))
      .slice(0, SCAN_CAPS.largest),
  };
}

// --- the scan -------------------------------------------------------------------------------

export function deepScan(view: RepoView): RepoScan {
  const notes: string[] = [];
  const coverage = view.stats();
  const analysis = analyze(view);
  const extracted = extract(view, notes);

  const src = view.files.filter((f) => SOURCE_LANGS.has(language(f) ?? ''));
  const byModule = new Map<string, { files: number; langs: Set<string> }>();
  for (const f of src) {
    const m = moduleOf(f);
    const e = byModule.get(m) ?? { files: 0, langs: new Set<string>() };
    e.files++;
    e.langs.add(language(f)!);
    byModule.set(m, e);
  }
  const modules = new Capped<ModuleInfo>(SCAN_CAPS.modules);
  for (const [dir, e] of [...byModule.entries()].sort((a, b) => cmp(a[0], b[0])))
    modules.add({ dir, files: e.files, languages: [...e.langs].sort() });
  modules.note('modules', notes);

  const edgeList = new Capped<ModuleEdge>(SCAN_CAPS.edges);
  for (const [k, count] of [...extracted.edges.entries()].sort((a, b) => cmp(a[0], b[0]))) {
    const [from, to] = k.split('\u0000') as [string, string];
    edgeList.add({ from, to, count });
  }
  edgeList.note('module edges', notes);

  const deps = dependencies(view);
  if (deps.length > SCAN_CAPS.dependencies)
    notes.push(`dependency manifests truncated at ${SCAN_CAPS.dependencies} (of ${deps.length})`);
  const entries = entryPoints(view);
  if (entries.length > SCAN_CAPS.entryPoints)
    notes.push(`entry points truncated at ${SCAN_CAPS.entryPoints} (of ${entries.length})`);
  const sortRoutes = (a: RouteInfo, b: RouteInfo): number =>
    cmp(a.file, b.file) || cmp(a.path, b.path) || cmp(a.method, b.method);
  extracted.routes.note('routes', notes);
  extracted.commands.note('commands', notes);
  extracted.models.note('data model entries', notes);
  const workflows = ci(view);
  if (workflows.length > SCAN_CAPS.workflows)
    notes.push(`CI files truncated at ${SCAN_CAPS.workflows} (of ${workflows.length})`);

  const layout = testLayout(view);
  return {
    coverage,
    analysis,
    entryPoints: entries.slice(0, SCAN_CAPS.entryPoints),
    modules: modules.items,
    edges: edgeList.items,
    dependencies: deps.slice(0, SCAN_CAPS.dependencies),
    routes: [...extracted.routes.items].sort(sortRoutes),
    commands: [...extracted.commands.items].sort(
      (a, b) => cmp(a.file, b.file) || cmp(a.name, b.name),
    ),
    dataModel: [...extracted.models.items].sort(
      (a, b) => cmp(a.file, b.file) || cmp(a.name, b.name),
    ),
    // Only when found, so a scan of a repository with none stays byte-identical to before.
    ...(extracted.screens.items.length
      ? {
          screens: [...extracted.screens.items].sort(
            (a, b) =>
              cmp(a.file, b.file) || cmp(a.path ?? '', b.path ?? '') || cmp(a.widget, b.widget),
          ),
        }
      : {}),
    ...(extracted.roles.items.length
      ? {
          roles: [...extracted.roles.items].sort(
            (a, b) => cmp(a.file, b.file) || cmp(a.name, b.name),
          ),
        }
      : {}),
    tests: { ...analysis.tests, dirs: layout.dirs, coverageSignals: layout.coverageSignals },
    ci: workflows.slice(0, SCAN_CAPS.workflows),
    conventions: conventions(view),
    inventory: inventory(view),
    notes,
  };
}

/** A stable identity for a scan: what a later stage pins the delivery to. */
export function scanHash(scan: RepoScan): string {
  return sha256Hex(canonicalize(scan));
}
