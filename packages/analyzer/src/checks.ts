import type { Analysis } from './detectors.js';
import type { RepoView } from './repo-view.js';

/** A check command the coding agent could be allowed to run, what it does, and why it is offered. */
export interface CheckProposal {
  command: string;
  /** What the command does, in plain words. A built-in constant, never repository text. */
  what: string;
  why: string;
}

/** Plain-words descriptions of the built-in commands, matched by shape (the tool name varies). */
const WHAT: readonly (readonly [RegExp, string])[] = [
  [
    /^(flutter|dart) analyze$/,
    'Scans the Dart code for errors and style problems. It changes nothing.',
  ],
  [/^(flutter|dart) test$/, "Runs the project's automated tests."],
  [/^(npm|pnpm|yarn) run test$/, "Runs the project's automated tests."],
  [/^(npm|pnpm|yarn) run lint$/, 'Checks the code for style problems and likely mistakes.'],
  [/^(npm|pnpm|yarn) run typecheck$/, 'Checks that the code type-checks, without running it.'],
  [/^(npm|pnpm|yarn) run check$/, "Runs the project's own combined check script."],
  [/^pytest$/, "Runs the project's automated tests."],
  [/^cargo test$/, "Runs the project's automated tests."],
  [/^go vet \.\/\.\.\.$/, 'Checks the Go code for likely mistakes.'],
  [/^go test \.\/\.\.\.$/, "Runs the project's automated tests."],
  [/^dotnet test$/, "Runs the project's automated tests."],
  [/^(\.\/gradlew|mvn) test$/, "Runs the project's automated tests."],
  [/^bundle exec rspec$/, "Runs the project's automated tests."],
  [/^composer test$/, "Runs the project's automated tests."],
  [/^mix test$/, "Runs the project's automated tests."],
  [/^swift test$/, "Runs the project's automated tests."],
  [/^bash \S+\.sh$/, 'Runs a test script from the repository.'],
];

/** The plain-words description of a built-in check command (also fills in older journal entries). */
export function whatItDoes(command: string): string {
  return WHAT.find(([re]) => re.test(command))?.[1] ?? 'Checks the project, using its own tooling.';
}

/** `package.json` script names worth offering. A name outside this list is never proposed. */
const NODE_SCRIPTS = ['test', 'lint', 'typecheck', 'check'] as const;

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

/**
 * The repository's own check commands, for a repository the Incubator did not build (ADR-025). They
 * are proposals for the owner to approve; once approved, the Incubator runs them itself to verify the work (plan 041).
 *
 * Every command is a built-in constant chosen by which files exist (threat T6): the repository's text
 * selects among them (a manifest is present, a known script name is a key) and never becomes part of
 * a command, except (plan 040) the path of a test script that a workflow runs with `bash`. A hostile `package.json` can at most make `npm run test` appear, and the owner still has
 * to approve it.
 */
export function proposeChecks(view: RepoView, a: Analysis): CheckProposal[] {
  const out: CheckProposal[] = [];
  const add = (command: string, why: string): void =>
    void out.push({ command, what: whatItDoes(command), why });
  switch (a.ecosystem?.id ?? '') {
    case 'dart': {
      // Flutter projects declare the SDK in pubspec.yaml; plain Dart packages do not.
      const flutter = /^\s*sdk:\s*flutter\s*$/m.test(view.read('pubspec.yaml') ?? '');
      const tool = flutter ? 'flutter' : 'dart';
      add(`${tool} analyze`, 'pubspec.yaml: static analysis');
      if (view.files.some((f) => /(^|\/)test\/.*_test\.dart$/.test(f)))
        add(`${tool} test`, 'test/: *_test.dart files');
      break;
    }
    case 'node': {
      const scripts = json(view, 'package.json')?.['scripts'];
      const names: string[] = scripts && typeof scripts === 'object' ? Object.keys(scripts) : [];
      const pm = view.has('pnpm-lock.yaml') ? 'pnpm' : view.has('yarn.lock') ? 'yarn' : 'npm';
      for (const name of NODE_SCRIPTS)
        if (names.includes(name)) add(`${pm} run ${name}`, `package.json: script "${name}"`);
      break;
    }
    case 'python':
      if (
        a.tests.runners.includes('pytest') ||
        view.files.some((f) => /(^|\/)test_[^/]+\.py$/.test(f))
      )
        add('pytest', 'pytest configuration or test_*.py files');
      break;
    case 'rust':
      add('cargo test', 'Cargo.toml');
      break;
    case 'go':
      add('go vet ./...', 'go.mod');
      add('go test ./...', 'go.mod');
      break;
    case 'dotnet':
      add('dotnet test', 'solution or project file');
      break;
    case 'jvm':
      if (view.has('gradlew')) add('./gradlew test', 'Gradle wrapper');
      else if (view.has('pom.xml')) add('mvn test', 'pom.xml');
      break;
    case 'ruby':
      if (view.files.some((f) => f.startsWith('spec/'))) add('bundle exec rspec', 'spec/');
      break;
    case 'php': {
      const scripts = json(view, 'composer.json')?.['scripts'];
      if (scripts && typeof scripts === 'object' && 'test' in scripts)
        add('composer test', 'composer.json: script "test"');
      break;
    }
    case 'elixir':
      add('mix test', 'mix.exs');
      break;
    case 'swift':
      add('swift test', 'Package.swift');
      break;
    default:
      break;
  }
  // A test script a GitHub workflow runs with `bash <path>.sh` (plan 040): only the path comes from the
  // repository, only when that file exists and its path names a test, and it must have the shape ADR-025
  // allows; the owner approves it.
  const SCRIPT_STEP =
    /^\s*(?:-\s+)?run:\s*bash\s+(?:\.\/)?([A-Za-z0-9_][A-Za-z0-9_./-]*\.sh)\s*$/gm;
  // why: a workflow also runs deploy and release scripts; only a path that says it is a test is proposed.
  const TEST_SCRIPT = /(^|[/_.-])tests?([/_.-]|$)/i;
  for (const wf of view.glob('.github/workflows/*.{yml,yaml}')) {
    for (const m of (view.read(wf) ?? '').matchAll(SCRIPT_STEP)) {
      const script = m[1]!;
      if (!TEST_SCRIPT.test(script) || script.length > 100 || !view.has(script)) continue;
      const command = `bash ${script}`;
      if (!out.some((c) => c.command === command)) add(command, `${wf}: CI runs it`);
    }
  }
  return out;
}
