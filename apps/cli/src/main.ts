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
import { collectCheck } from './commands/checks.js';
import { runGc } from './commands/gc.js';
import { runAdopt, type AdoptOptions } from './commands/adopt.js';
import { runEnhance, type EnhanceOptions } from './commands/enhance.js';
import { runConfig } from './commands/config.js';
import { runPortfolio } from './commands/portfolio.js';
import { runUi } from './commands/ui.js';
import { liveDeps, type CliDeps, type DepsFactory } from './deps.js';
import type { Io } from './io.js';

export type { Io } from './io.js';

/**
 * How the launcher stops work on Ctrl+C. `main` fills `stop` for a command that runs work (not for `ui`, which
 * has its own graceful shutdown); it stops every run that is working and returns how many it stopped.
 */
export interface InterruptControl {
  stop?: () => number;
}

/**
 * Entry point. Returns an exit code (0 pass, 1 tool broke, 2 policy/gate, 130 interrupted) and never
 * calls process.exit; only bin/incubator.mjs does.
 */
export async function main(
  argv: readonly string[],
  io: Io,
  depsFactory: DepsFactory = liveDeps,
  interrupt?: InterruptControl,
): Promise<number> {
  let code: number = ExitCode.Ok;
  let deps: CliDeps | undefined;
  const program = new Command('incubator');
  const verbose = argv.includes('--verbose');
  const getDeps = (): CliDeps => (deps ??= depsFactory({ verbose, stderr: io.stderr }));
  if (interrupt && argv[0] !== 'ui')
    interrupt.stop = () => deps?.engine.abortAll('signal').length ?? 0;
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
    .option(
      '--dir <folder>',
      'initialize the new repository in this empty (or missing) folder; the agent codes there and you approve the commit and push',
    )
    .action(async (opts: NewOptions) => {
      code = await runNew(getDeps(), io, opts);
    });

  program
    .command('resume <runId>')
    .description('continue a parked or interrupted run from its journal')
    .option('-y, --yes', 'accept every recommended default without prompting')
    .option('-o, --out <file>', 'write the approved spec here')
    .option('--adapter <id>', 'switch the LLM adapter for the rest of the run')
    .option('--prompt <text>', 'answer a parked "what do you want to change?" (enhance runs)')
    .option('--prompt-file <path>', 'read that answer from a file')
    .option('--commit', "folder runs: commit the agent's changes (message: -m, or the drafted one)")
    .option('-m, --message <text>', 'the commit message for --commit')
    .option('--leave', 'folder runs: keep the changes uncommitted')
    .option('--push', 'folder runs: push the branch and open a pull request')
    .option('--skip-push', 'folder runs: keep the commit local')
    .option(
      '--check <command>',
      'in-place runs: approve a check command the coding agent may run (repeat for more)',
      collectCheck,
      [],
    )
    .option('--no-checks', 'in-place runs: approve none, so the agent edits files and runs nothing')
    .action(
      async (
        runId: string,
        opts: {
          yes?: boolean;
          adapter?: string;
          out?: string;
          prompt?: string;
          promptFile?: string;
          commit?: boolean;
          message?: string;
          leave?: boolean;
          push?: boolean;
          skipPush?: boolean;
          check?: string[];
          checks?: boolean;
        },
      ) => {
        code = await runResume(getDeps(), io, runId, opts);
      },
    );

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
    .command('adopt <source>')
    .description(
      'bring an existing repository (URL or local path) up to the canonical pattern via a PR',
    )
    .option(
      '--repo <owner/name>',
      'GitHub repository for the PR when the source is not a GitHub URL',
    )
    .option('--org', 'the owner is an organization')
    .option('--no-publish', 'write the adopt branch in the run workspace only (no push, no PR)')
    .option('-y, --yes', 'approve the inferred spec without prompting')
    .action(async (source: string, opts: AdoptOptions) => {
      code = await runAdopt(getDeps(), io, source, opts);
    });

  program
    .command('enhance <source>')
    .description(
      'change an existing repository (URL or local path): scan it, say what to change, get a plan on a branch',
    )
    .option('--prompt <text>', 'what you want to change (asked for on a terminal when omitted)')
    .option('--prompt-file <path>', 'read what you want to change from a file')
    .option('--with-gaps', 'also deliver the canonical-pattern gaps, as a separate commit')
    .option(
      '--in-place',
      'work in the local folder itself, on a new branch: the agent codes there and you approve the commit and push',
    )
    .option(
      '--repo <owner/name>',
      'GitHub repository for the PR when the source is not a GitHub URL',
    )
    .option('--org', 'the owner is an organization')
    .option('--no-publish', 'write the enhance branch in the run workspace only (no push, no PR)')
    .option(
      '--check <command>',
      'in-place runs: approve a check command the coding agent may run (repeat for more)',
      collectCheck,
      [],
    )
    .option('--no-checks', 'in-place runs: approve none, so the agent edits files and runs nothing')
    .option('--adapter <id>', 'claude-cli | copilot-cli | cursor-cli | anthropic-api')
    .option('-y, --yes', 'accept every recommended default without prompting')
    .action(async (source: string, opts: EnhanceOptions) => {
      code = await runEnhance(getDeps(), io, source, opts);
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
    .command('portfolio [project]')
    .description('list the projects the Incubator has worked on, or show one with its runs')
    .option('--json', 'print JSON instead of text')
    .action(async (project: string | undefined, opts: { json?: boolean }) => {
      code = await runPortfolio(getDeps(), io, project, opts);
    });

  program
    .command('config [action] [args...]')
    .description(
      'show what the next run uses, or get/set a setting (planning and coding model, limits, tool paths)',
    )
    .action(async (action: string | undefined, args: string[]) => {
      code = await runConfig(getDeps(), io, action, args);
    });

  program
    .command('ui')
    .description('open the localhost web UI (127.0.0.1, random port, single-use link)')
    .option('--no-open', 'print the link instead of opening a browser')
    .action(async (opts: { open?: boolean }) => {
      const d = getDeps();
      code = await runUi(d, io, opts, d.stop);
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
