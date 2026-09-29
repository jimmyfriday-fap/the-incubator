import path from 'node:path';
import { main } from '@incubator/cli';
import { nodeExec } from '@incubator/runtime';
import type { FeatureAdapter } from './types.js';

interface Ctx {
  root: string;
}
interface Out {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Drives the CLI entry point in-process, or the built binary as a real process (`mode: binary`). */
export const adapter: FeatureAdapter<Ctx, Out> = {
  name: 'exit-codes',
  seedContext: () => ({ root: path.resolve(import.meta.dirname, '..', '..') }),
  async runStage(stage, ctx) {
    const input = (stage.input ?? {}) as { argv?: string[]; fault?: string; mode?: string };
    const argv = input.argv ?? [];
    if (input.mode === 'binary') {
      const r = await nodeExec.run(
        process.execPath,
        [path.join(ctx.root, 'apps/cli/bin/incubator.mjs'), ...argv],
        {
          timeoutMs: 30_000,
        },
      );
      return { exitCode: r.code ?? -1, stdout: r.stdout, stderr: r.stderr };
    }
    let stdout = '';
    let stderr = '';
    const exitCode = await main(argv, {
      stdout: (t) => {
        if (input.fault === 'stdout-throws') throw new Error('EPIPE: injected stdout failure');
        stdout += t;
      },
      stderr: (t) => (stderr += t),
    });
    return { exitCode, stdout, stderr };
  },
  captureOutput: (out) => out,
  validate(captured) {
    const code = (captured as Out).exitCode;
    return [0, 1, 2, 130].includes(code) ? [] : [`exit code ${code} is outside the contract`];
  },
};
