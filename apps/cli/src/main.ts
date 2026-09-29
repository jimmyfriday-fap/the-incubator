import { Command, CommanderError } from 'commander';
import { INCUBATOR_VERSION } from '@incubator/core';
import { ExitCode, exitCodeFor, formatError } from '@incubator/runtime';
import { runDoctor } from './commands/doctor.js';
import { runNew, type NewOptions } from './commands/new.js';
import { runResume } from './commands/resume.js';
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
