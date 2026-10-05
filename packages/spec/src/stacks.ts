/**
 * The stacks the Incubator knows (ADR-027). A *built-in* stack is a pack that renders the whole project.
 * A *retrieved* stack is created by its own official generator; the Incubator keeps only enough about it to
 * recognise it, recommend it when it fits, and create it. This is a code constant, not a pinned contract:
 * adding a retrieved stack changes no schema.
 *
 * Nothing here comes from repository or user text: every command and argument is a constant, or built from a
 * validated name by `create.args` (threat T6).
 */

export interface StackPrerequisite {
  /** The tool to run, as it is named on PATH. */
  tool: string;
  /** Arguments that print the tool's version without side effects. */
  probe: readonly string[];
  /** Where the owner gets it. The Incubator never installs software. */
  install: string;
  /** Directories under the owner's home where the tool is commonly unpacked when it is not on PATH. */
  homeDirs: readonly string[];
}

export interface StackCreate {
  /** The generator tool; also named in `prerequisites`. */
  tool: string;
  /** The generator's argv, built from names that passed `validStackNames`. */
  args(names: { project: string; org: string }): string[];
  /** What the generator is expected to leave in the folder (a smoke check that it worked). */
  expects: readonly string[];
}

export interface StackEntry {
  id: string;
  label: string;
  kind: 'built-in' | 'retrieved';
  /** One line the recommender and the owner read. */
  summary: string;
  fits: readonly string[];
  avoidWhen: readonly string[];
  platforms: readonly string[];
  /** The analyzer ecosystem id that detects it, and a marker in that ecosystem's root manifest. */
  detect: { ecosystem: string; marker?: RegExp };
  /** What a coding agent may run to check its work (ADR-025); the owner approves them. */
  checks: readonly string[];
  /** Retrieved stacks only. */
  prerequisites?: readonly StackPrerequisite[];
  create?: StackCreate;
}

export const STACK_CATALOG: readonly StackEntry[] = [
  {
    id: 'node-web',
    label: 'Node web app',
    kind: 'built-in',
    summary: 'A Fastify API with a React and Vite front end, backed by Postgres.',
    fits: ['a web application with a server and a database', 'a dashboard or internal tool'],
    avoidWhen: ['a native mobile app', 'a library or a command-line tool'],
    platforms: ['web'],
    detect: { ecosystem: 'node' },
    checks: ['node scripts/check.mjs quick'],
  },
  {
    id: 'node-lib',
    label: 'TypeScript library or CLI',
    kind: 'built-in',
    summary: 'A TypeScript package or command-line tool, published as a package.',
    fits: ['a reusable library', 'a command-line tool'],
    avoidWhen: ['a web application with a database', 'a native mobile app'],
    platforms: ['library', 'cli'],
    detect: { ecosystem: 'node' },
    checks: ['node scripts/check.mjs quick'],
  },
  {
    id: 'python-service',
    label: 'Python service',
    kind: 'built-in',
    summary: 'A FastAPI service backed by Postgres, managed with uv.',
    fits: ['an API or a background service', 'data processing or machine-learning glue'],
    avoidWhen: ['a rich user interface', 'a native mobile app'],
    platforms: ['service'],
    detect: { ecosystem: 'python' },
    checks: ['node scripts/check.mjs quick'],
  },
  {
    id: 'wordpress',
    label: 'WordPress plugin or theme',
    kind: 'built-in',
    summary: 'A WordPress plugin or theme with Composer autoloading.',
    fits: ['extending a WordPress site', 'a plugin or a theme'],
    avoidWhen: ['anything that is not WordPress'],
    platforms: ['wordpress-plugin', 'wordpress-theme'],
    detect: { ecosystem: 'php' },
    checks: ['node scripts/check.mjs quick'],
  },
  {
    id: 'flutter',
    label: 'Flutter app',
    kind: 'retrieved',
    summary: 'One Flutter codebase for web, Android and iOS, created by `flutter create`.',
    fits: [
      'one app for web, Android and iOS',
      'a rich, interactive user interface',
      'a backend-as-a-service such as Supabase',
    ],
    avoidWhen: [
      'a plain server or API',
      'a library or a command-line tool',
      'mostly static content',
    ],
    platforms: ['web', 'android', 'ios'],
    detect: { ecosystem: 'dart', marker: /^\s*sdk:\s*flutter\s*$/m },
    checks: ['flutter analyze', 'flutter test'],
    prerequisites: [
      {
        tool: 'flutter',
        probe: ['--version'],
        install: 'https://docs.flutter.dev/get-started/install',
        homeDirs: ['flutter/bin', 'development/flutter/bin', 'fvm/default/bin'],
      },
    ],
    create: {
      tool: 'flutter',
      args: ({ project, org }) => [
        'create',
        '--org',
        org,
        '--project-name',
        project,
        '--platforms=web,android,ios',
        '.',
      ],
      expects: ['pubspec.yaml', 'lib/main.dart'],
    },
  },
];

export function stackById(id: string): StackEntry | undefined {
  return STACK_CATALOG.find((s) => s.id === id);
}

export function retrievedStacks(): readonly StackEntry[] {
  return STACK_CATALOG.filter((s) => s.kind === 'retrieved');
}

/** Dart reserved words, which are not allowed as a package name. */
const DART_RESERVED = new Set([
  'abstract',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'covariant',
  'default',
  'deferred',
  'do',
  'dynamic',
  'else',
  'enum',
  'export',
  'extends',
  'extension',
  'external',
  'factory',
  'false',
  'final',
  'finally',
  'for',
  'function',
  'get',
  'hide',
  'if',
  'implements',
  'import',
  'in',
  'interface',
  'is',
  'late',
  'library',
  'mixin',
  'new',
  'null',
  'of',
  'on',
  'operator',
  'part',
  'required',
  'rethrow',
  'return',
  'set',
  'show',
  'static',
  'super',
  'switch',
  'sync',
  'this',
  'throw',
  'true',
  'try',
  'typedef',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * A project name and organisation the generators accept, from free text: `project` becomes a lower
 * snake_case identifier that starts with a letter and is not a Dart keyword; `org` must be a reverse-domain
 * name (`com.example`). Returns null when nothing usable can be made, never a partial guess.
 */
export function validStackNames(
  name: string,
  org: string,
): { project: string; org: string } | null {
  const project = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(project) || DART_RESERVED.has(project)) return null;
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(org) || org.length > 64) return null;
  return { project, org };
}
