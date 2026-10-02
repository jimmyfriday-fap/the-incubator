import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Issue } from '@incubator/spec';

/**
 * Check commands the owner approved for a coding agent working on a repository the Incubator did not
 * build (ADR-025). The Incubator never runs them: they become `Bash(<command>:*)` entries in the
 * agent's allowed-tool list, so the agent can run them and nothing else.
 */

export const MAX_CHECKS = 8;
export const MAX_CHECK_LENGTH = 120;
const MAX_TOKENS = 8;
// why: no comma (the tool list is comma-joined), colon or parenthesis (the `Bash(cmd:*)` syntax), and
// no quote, backslash, space-in-token or shell metacharacter (`;`, `&`, `|`, `$`, backtick, `>`, `<`).
const TOKEN = /^[A-Za-z0-9_@%+=./-]+$/;
/** Programs that would hand the agent a shell, another program, or history-changing git. */
const DENIED_PROGRAMS = new Set([
  'git',
  'sh',
  'bash',
  'zsh',
  'fish',
  'cmd',
  'powershell',
  'pwsh',
  'sudo',
  'su',
  'env',
  'xargs',
  'eval',
  'exec',
  'curl',
  'wget',
  'rm',
  'ssh',
]);
/**
 * Runners that do anything when given free arguments. `Bash(<command>:*)` lets the agent append to
 * the approved text, so these need a subcommand in it: `flutter test`, never a bare `flutter`.
 */
const NEEDS_SUBCOMMAND = new Set([
  'node',
  'deno',
  'bun',
  'python',
  'python3',
  'ruby',
  'perl',
  'php',
  'npm',
  'pnpm',
  'yarn',
  'npx',
  'dotnet',
  'cargo',
  'go',
  'flutter',
  'dart',
  'mix',
  'swift',
  'mvn',
  'gradle',
  'gradlew',
  'bundle',
  'composer',
  'make',
]);
/** Flags that turn an interpreter into "run this text". */
const INLINE_CODE = new Set(['-e', '-c', '-p', '--eval', '--print', '-r']);

/** One trimmed, single-spaced command per entry; blank lines dropped. */
export function normalizeChecks(commands: readonly string[]): string[] {
  return commands.map((c) => c.trim().split(/\s+/).join(' ')).filter((c) => c.length > 0);
}

/** Why a list of check commands cannot be approved. Empty when it can (an empty list is valid). */
export function validateChecks(commands: readonly string[]): Issue[] {
  const issues: Issue[] = [];
  const add = (i: number, message: string): void =>
    void issues.push({ code: 'check_command', path: `/commands/${i}`, message });
  if (commands.length > MAX_CHECKS)
    issues.push({
      code: 'check_count',
      path: '/commands',
      message: `at most ${MAX_CHECKS} check commands`,
    });
  const seen = new Set<string>();
  commands.forEach((raw, i) => {
    const c = raw.trim();
    if (c !== raw || c.split(/\s+/).join(' ') !== c)
      return add(i, 'write the command with single spaces and no leading or trailing space');
    if (!c) return add(i, 'an empty command');
    if (c.length > MAX_CHECK_LENGTH) return add(i, `longer than ${MAX_CHECK_LENGTH} characters`);
    if (seen.has(c)) return add(i, `"${c}" is listed twice`);
    seen.add(c);
    const tokens = c.split(' ');
    if (tokens.length > MAX_TOKENS) return add(i, `more than ${MAX_TOKENS} words`);
    const bad = tokens.find((t) => !TOKEN.test(t));
    if (bad !== undefined)
      return add(
        i,
        `"${bad}" has a character that is not allowed (letters, digits and _ @ % + = . / - only: no quotes, pipes, semicolons or redirects)`,
      );
    if (tokens.some((t) => t.split('/').includes('..')))
      return add(i, 'a path may not leave the repository ("..")');
    const program = tokens[0]!;
    if (program.startsWith('-')) return add(i, 'the program name cannot start with "-"');
    if (program.startsWith('/') || /^[A-Za-z]:/.test(program))
      return add(i, 'name the program, not an absolute path to it');
    const name = program
      .split('/')
      .pop()!
      .toLowerCase()
      .replace(/\.(exe|cmd|bat|ps1|sh)$/, '');
    if (DENIED_PROGRAMS.has(name))
      return add(i, `"${program}" is not a check command: it can run anything`);
    if (NEEDS_SUBCOMMAND.has(name)) {
      if (tokens.length < 2 || tokens[1]!.startsWith('-'))
        return add(
          i,
          `"${program}" needs its subcommand, for example "${program} test": on its own it can run anything`,
        );
      if (tokens.some((t) => INLINE_CODE.has(t)))
        return add(i, `"${c}" runs inline code, which is not a check command`);
    }
  });
  return issues;
}

/** Read and edit tools every coding agent gets, plus read-only git. */
const EDIT_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep'] as const;
const READ_ONLY_GIT = ['Bash(git status:*)', 'Bash(git diff:*)'] as const;

/** The agent's whole allowed-tool list on a repository the Incubator did not build. */
export function externalTools(checks: readonly string[]): string[] {
  return [...EDIT_TOOLS, ...checks.map((c) => `Bash(${c}:*)`), ...READ_ONLY_GIT];
}

/**
 * A repository carries the Incubator's own gate when it has the lock, the check runner and the agent
 * profile. Anything else (any stack) is external: its checks are the owner's to approve.
 */
export function isCanonicalRepo(dir: string): boolean {
  return ['.incubator/lock.json', 'scripts/check.mjs', '.incubator/agent-profile.json'].every((f) =>
    existsSync(path.join(dir, ...f.split('/'))),
  );
}
