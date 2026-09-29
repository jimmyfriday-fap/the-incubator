import { Command, CommanderError } from 'commander';
import { INCUBATOR_VERSION } from '@incubator/core';
import { ExitCode, PolicyError, exitCodeFor, formatError } from '@incubator/runtime';
import { runDoctor } from './commands/doctor.js';
import { runNew, type NewOptions } from './commands/new.js';
import { runResume } from './commands/resume.js';
import { runScaffold, type ScaffoldCliOptions } from './commands/scaffold.js';
import { runPublish } from './commands/publish.js';
import { runHandoff } from './commands/handoff.js';
import { runAuthDelete, runAuthSet, runAuthStatus } from './commands/auth.js';
import { runGc } from './commands/gc.js';
import { liveDeps, type CliDeps, type DepsFactory } from './deps.js';
import type { Io } from './io.js';

export type { Io } from './io.js';

/**
 * Entry point. Returns an exit code (0 pass, 1 tool broke, 2 policy/gate, 130 interrupted) and never
 * calls process.exit; only bin/incubator.mjs does.
 */
export async function main(
  argv: readonly string[],
  io: Io,
  depsFactory: DepsFactory = liveDeps,
): Promise<number> {
  let code: number = ExitCode.Ok;
  let deps: CliDeps | undefined;
  const program = new Command('incubator');
  const verbose = argv.includes('--verbose');
  const getDeps = (): CliDeps => (deps ??= depsFactory({ verbose, stderr: io.stderr }));
  program
    .description(
      'Turn a plain-English idea and/or an existing repository into a canonical GitHub repository.',
    )
    .version(INCUBATOR_VERSION, '-v, --version')
    .option('--verbose', 'debug logging on stderr')
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: (s) => io.stderr(s) })
    .showHelpAfterError();

  program
    .command('new')
    .description('discover a new project from a narrative and draft incubator.json')
    .option('--prompt <text>', 'the narrative')
    .option('--prompt-file <path>', 'read the narrative from a file')
    .option('--spec-only', 'stop after the spec is approved')
    .option('-y, --yes', 'accept every recommended default without prompting')
    .option('-o, --out <file>', 'write the approved spec here instead of stdout')
    .option('--adapter <id>', 'LLM adapter: claude-cli | copilot-cli | cursor-cli | anthropic-api')
    .option(
      '--scaffold-to <dir>',
      'after approval, write the repository here and stop (no publish)',
    )
    .option('--keep', 'keep the run workspace after publishing')
    .action(async (opts: NewOptions) => {
      code = await runNew(getDeps(), io, opts);
    });

  program
    .command('resume <runId>')
    .description('continue a parked or interrupted run from its journal')
    .option('-y, --yes', 'accept every recommended default without prompting')
    .option('-o, --out <file>', 'write the approved spec here')
    .option('--adapter <id>', 'switch the LLM adapter for the rest of the run')
    .action(async (runId: string, opts: { yes?: boolean; adapter?: string; out?: string }) => {
      code = await runResume(getDeps(), io, runId, opts);
    });

  program
    .command('scaffold <spec>')
    .description('render a canonical repository from an incubator.json (deterministic, no LLM)')
    .option('-o, --out <dir>', 'target directory (must be empty unless --force)')
    .option('--dry-run', 'list the files that would be written, with hashes; write nothing')
    .option('--validate-only', 'validate the spec and render in memory; write nothing')
    .option('--force', 'write into a non-empty directory')
    .action(async (spec: string, opts: ScaffoldCliOptions) => {
      code = await runScaffold(io, spec, opts);
    });

  program
    .command('publish <specOrRunId>')
    .description('scaffold, verify and publish a spec to GitHub, or resume a run by id')
    .option('--keep', 'keep the run workspace after publishing')
    .option('-y, --yes', 'accept every recommended default without prompting')
    .action(async (target: string, opts: { keep?: boolean; yes?: boolean }) => {
      code = await runPublish(getDeps(), io, target, opts);
    });

  program
    .command('handoff <runId>')
    .description('print, or --launch, the headless agent run that starts building the features')
    .option('--agent <id>', 'claude | copilot | cursor (default: agents.primary)')
    .option('--launch', 'run the agent now, bounded by agents.runCeilings')
    .action(async (runId: string, opts: { agent?: string; launch?: boolean }) => {
      code = await runHandoff(getDeps(), io, runId, opts);
    });

  const auth = program.command('auth').description('credentials in the OS keychain');
  auth
    .command('set <account>')
    .description('store github | anthropic | leantime (value from stdin or a hidden prompt)')
    .action(async (account: string) => {
      const read = io.readSecret;
      if (!read)
        throw new PolicyError('no way to read a secret in this environment', { code: 'usage' });
      code = await runAuthSet(getDeps(), io, account, () => read(`${account} credential`));
    });
  auth
    .command('delete <account>')
    .description('remove a stored credential')
    .action(async (account: string) => {
      code = await runAuthDelete(getDeps(), io, account);
    });
  auth
    .command('status')
    .description('show where each credential comes from (never its value)')
    .action(async () => {
      code = await runAuthStatus(getDeps(), io);
    });

  program
    .command('gc')
    .description('remove finished runs older than --days and leftover workspaces')
    .option('--days <n>', 'age threshold in days (default: config gc.days or 30)')
    .option('--dry-run', 'only list what would be removed')
    .action((opts: { days?: string; dryRun?: boolean }) => {
      code = runGc(getDeps(), io, opts);
    });

  program
    .command('doctor')
    .description('report the environment, keychain, git and available LLM adapters')
    .action(async () => {
      code = await runDoctor(getDeps(), io);
    });

  try {
    if (argv.length === 0) {
      program.outputHelp({ error: true });
      return ExitCode.Policy;
    }
    await program.parseAsync([...argv], { from: 'user' });
    return code;
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === 'commander.version' || err.code === 'commander.helpDisplayed')
        return ExitCode.Ok;
      return ExitCode.Policy;
    }
    io.stderr(`${formatError(err, verbose)}\n`);
    return exitCodeFor(err);
  }
}
