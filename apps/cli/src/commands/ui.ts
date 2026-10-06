import { ExitCode, type Exec } from '@incubator/runtime';
import { startServer } from '@incubator/web';
import type { CliDeps } from '../deps.js';
import { createFolderPicker } from '../folder-picker.js';
import type { Io } from '../io.js';

/** Hands the launch URL to the OS default browser (argv only, no shell; TDD §9.1). */
export async function openBrowser(
  exec: Exec,
  url: string,
  platform = process.platform,
): Promise<boolean> {
  const [bin, args]: [string, string[]] =
    platform === 'darwin'
      ? ['open', [url]]
      : platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  try {
    const r = await exec.run(bin, args, { timeoutMs: 15_000 });
    return r.code === 0;
  } catch {
    return false;
  }
}

function untilSignal(): { promise: Promise<'SIGINT' | 'SIGTERM'>; dispose(): void } {
  let dispose = () => {};
  const promise = new Promise<'SIGINT' | 'SIGTERM'>((resolve) => {
    const on = (s: 'SIGINT' | 'SIGTERM') => () => resolve(s);
    const int = on('SIGINT');
    const term = on('SIGTERM');
    process.once('SIGINT', int);
    process.once('SIGTERM', term);
    dispose = () => {
      process.off('SIGINT', int);
      process.off('SIGTERM', term);
    };
  });
  return { promise, dispose };
}

/**
 * `incubator ui`: the localhost web UI on 127.0.0.1 and a random port, until Ctrl+C. The launch URL
 * carries a single-use token; it goes to the browser, or to stdout with --no-open.
 */
export async function runUi(
  deps: CliDeps,
  io: Io,
  opts: { open?: boolean },
  stop?: Promise<unknown>,
): Promise<number> {
  // The browser cannot open a native dialog; this process can, so it offers one (ADR-022).
  const pickFolder = await createFolderPicker(deps.exec);
  const server = await startServer({
    engine: deps.engine,
    store: deps.store,
    log: deps.log,
    ...(deps.settings ? { settings: deps.settings } : {}),
    ...(pickFolder ? { host: { pickFolder } } : {}),
  });
  const sig = stop ? null : untilSignal();
  try {
    io.stderr(`▶ The Incubator UI is serving ${server.origin} (Ctrl+C to stop)\n`);
    const opened = opts.open !== false && (await openBrowser(deps.exec, server.url));
    if (opened) io.stderr('  opened in your browser; the link works once\n');
    else io.stdout(`${server.url}\n`);
    const why = await (stop ?? sig!.promise);
    return why === 'SIGINT' || why === 'SIGTERM' ? ExitCode.Interrupted : ExitCode.Ok;
  } finally {
    sig?.dispose();
    await server.close();
  }
}
