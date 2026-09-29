import { ExitCode, INCUBATOR_VERSION } from '@incubator/core';
import { exitCodeFor, formatError } from '@incubator/runtime';

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/** Entry point; returns an exit code instead of calling process.exit (only bin/ does that). */
export function main(argv: readonly string[], io: Io): Promise<number> {
  try {
    if (argv.includes('--version') || argv.includes('-v')) {
      io.stdout(`${INCUBATOR_VERSION}\n`);
      return Promise.resolve(ExitCode.Ok);
    }
    io.stderr('usage: incubator <command> [options]\n');
    return Promise.resolve(ExitCode.Policy);
  } catch (err) {
    io.stderr(`${formatError(err)}\n`);
    return Promise.resolve(exitCodeFor(err));
  }
}
