import { describe, expect, it } from 'vitest';
import { MemoryKeychain, globalRedactor, type Exec } from '@incubator/runtime';
import { GITHUB_ACCOUNT, KEYCHAIN_SERVICE, missingScopes, resolveGitHubToken } from './token.js';

const exec = (gh: string | null, code = 0): Exec => ({
  which: (n) =>
    Promise.resolve(n === 'gh' && gh !== null ? ({ path: 'gh', kind: 'native' } as never) : null),
  run: () =>
    Promise.resolve({ code, signal: null, stdout: `${gh ?? ''}\n`, stderr: '', timedOut: false }),
});

describe('resolveGitHubToken', () => {
  it('prefers the keychain, then gh, then the environment', async () => {
    const kc = new MemoryKeychain();
    await kc.set(KEYCHAIN_SERVICE, GITHUB_ACCOUNT, 'kc_token_value_1');
    const a = await resolveGitHubToken({
      keychain: kc,
      exec: exec('gh_token_value_2'),
      env: { GITHUB_TOKEN: 'env_token_value_3' },
    });
    expect(a?.source).toBe('keychain');
    expect(a?.token.reveal()).toBe('kc_token_value_1');
    const b = await resolveGitHubToken({
      keychain: new MemoryKeychain(),
      exec: exec('gh_token_value_2'),
      env: { GITHUB_TOKEN: 'env_token_value_3' },
    });
    expect([b?.source, b?.token.reveal()]).toEqual(['gh', 'gh_token_value_2']);
    const c = await resolveGitHubToken({
      keychain: new MemoryKeychain(),
      exec: exec('x', 1),
      env: { GH_TOKEN: 'env_token_value_4' },
    });
    expect([c?.source, c?.token.reveal()]).toEqual(['env', 'env_token_value_4']);
    expect(
      await resolveGitHubToken({ keychain: new MemoryKeychain(), exec: exec(null), env: {} }),
    ).toBeNull();
  });

  it('registers the token with the redactor and never stringifies it', async () => {
    const r = await resolveGitHubToken({
      keychain: new MemoryKeychain(),
      exec: exec(null),
      env: { GITHUB_TOKEN: 'ghp_redact_me_987654' },
    });
    expect(String(r!.token)).not.toContain('ghp_redact_me_987654');
    expect(JSON.stringify({ t: r!.token })).not.toContain('ghp_redact_me_987654');
    expect(globalRedactor.redact('auth ghp_redact_me_987654 ok')).not.toContain(
      'ghp_redact_me_987654',
    );
  });

  it('lists missing classic scopes', () => {
    expect(missingScopes('classic', ['repo'])).toEqual(['workflow']);
    expect(missingScopes('fine-grained', [])).toEqual([]);
  });
});
