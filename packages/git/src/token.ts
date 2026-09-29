import { SecretString, type Exec, type Keychain } from '@incubator/runtime';

export type TokenSource = 'keychain' | 'gh' | 'env';

export interface ResolvedToken {
  token: SecretString;
  source: TokenSource;
}

export const KEYCHAIN_SERVICE = 'incubator';
export const GITHUB_ACCOUNT = 'github';

/**
 * GitHub token lookup order (brief §7, ADR-009): the OS keychain (`incubator auth set github`), then
 * `gh auth token`, then GITHUB_TOKEN / GH_TOKEN. The value is wrapped in a SecretString immediately,
 * which registers it with the redactor; it is never written to disk by the Incubator.
 */
export async function resolveGitHubToken(deps: {
  keychain: Keychain;
  exec: Exec;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<ResolvedToken | null> {
  if (await deps.keychain.available()) {
    const v = await deps.keychain.get(KEYCHAIN_SERVICE, GITHUB_ACCOUNT);
    if (v?.trim()) return { token: new SecretString(v.trim()), source: 'keychain' };
  }
  if (await deps.exec.which('gh')) {
    const r = await deps.exec.run('gh', ['auth', 'token'], { timeoutMs: 15_000 });
    const v = r.code === 0 ? r.stdout.trim() : '';
    if (v) return { token: new SecretString(v), source: 'gh' };
  }
  const v = (deps.env['GITHUB_TOKEN'] ?? deps.env['GH_TOKEN'] ?? '').trim();
  return v ? { token: new SecretString(v), source: 'env' } : null;
}

/** Classic tokens need `repo` and `workflow` (pushing .github/workflows is refused without it). */
export function missingScopes(
  kind: 'classic' | 'fine-grained' | 'unknown',
  scopes: readonly string[],
): string[] {
  if (kind !== 'classic') return [];
  return ['repo', 'workflow'].filter((s) => !scopes.includes(s));
}
