import { ExitCode, PolicyError } from '@incubator/runtime';
import { resolveGitHubToken } from '@incubator/git';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

export const AUTH_ACCOUNTS = ['github', 'anthropic', 'leantime'] as const;
type Account = (typeof AUTH_ACCOUNTS)[number];

/**
 * `incubator auth set <github|anthropic|leantime>`: stores a credential in the OS keychain only.
 * The value comes from stdin (piped) or a hidden prompt; it is never echoed, logged or written to disk.
 */
export async function runAuthSet(
  deps: CliDeps,
  io: Io,
  account: string,
  readSecret: () => Promise<string>,
): Promise<number> {
  if (!AUTH_ACCOUNTS.includes(account as Account))
    throw new PolicyError(`unknown account ${account} (use ${AUTH_ACCOUNTS.join(', ')})`, {
      code: 'usage',
    });
  if (!(await deps.keychain.available()))
    throw new PolicyError(
      'no OS keychain is available; use environment variables instead (see incubator doctor)',
      {
        code: 'no_keychain',
      },
    );
  const value = (await readSecret()).trim();
  if (!value) throw new PolicyError('empty value; nothing stored', { code: 'usage' });
  await deps.keychain.set('incubator', account, value);
  io.stderr(`✔ stored the ${account} credential in the OS keychain\n`);
  return ExitCode.Ok;
}

export async function runAuthDelete(deps: CliDeps, io: Io, account: string): Promise<number> {
  if (!AUTH_ACCOUNTS.includes(account as Account))
    throw new PolicyError(`unknown account ${account}`, { code: 'usage' });
  const removed = await deps.keychain.delete('incubator', account);
  io.stderr(
    removed ? `✔ removed the ${account} credential\n` : `no ${account} credential was stored\n`,
  );
  return ExitCode.Ok;
}

/** Where each credential would come from, without revealing any value. */
export async function runAuthStatus(deps: CliDeps, io: Io): Promise<number> {
  const gh = await resolveGitHubToken({
    keychain: deps.keychain,
    exec: deps.exec,
    env: process.env,
  });
  const kc = await deps.keychain.available();
  const has = async (a: string) => (kc ? Boolean(await deps.keychain.get('incubator', a)) : false);
  io.stdout(
    [
      `github     ${gh ? `from ${gh.source}` : 'missing (incubator auth set github, gh auth login, or GITHUB_TOKEN)'}`,
      `anthropic  ${(await has('anthropic')) ? 'from keychain' : process.env['ANTHROPIC_API_KEY'] ? 'from env' : 'missing (only needed for the anthropic-api adapter)'}`,
      `leantime   ${(await has('leantime')) ? 'from keychain' : process.env['INCUBATOR_LEANTIME_TOKEN'] ? 'from env' : 'missing (only needed for tracker: leantime)'}`,
    ].join('\n') + '\n',
  );
  return ExitCode.Ok;
}
