import type { Analysis } from './detectors.js';
import type { RepoView } from './repo-view.js';

/** A check command the coding agent could be allowed to run, and why it is offered. */
export interface CheckProposal {
  command: string;
  why: string;
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
 * are proposals for the owner to approve, never run by the Incubator itself.
 *
 * Every command is a built-in constant chosen by which files exist (threat T6): the repository's text
 * selects among them (a manifest is present, a known script name is a key) and never becomes part of
 * a command. A hostile `package.json` can at most make `npm run test` appear, and the owner still has
 * to approve it.
 */
export function proposeChecks(view: RepoView, a: Analysis): CheckProposal[] {
  const out: CheckProposal[] = [];
  const add = (command: string, why: string): void => void out.push({ command, why });
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
  return out;
}
