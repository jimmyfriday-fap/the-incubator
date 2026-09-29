import { ExitCode } from '@incubator/runtime';
import { missingScopes, resolveGitHubToken } from '@incubator/git';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/** Environment report: runtime, state dir, keychain, git, and the LLM adapter capability table. */
export async function runDoctor(deps: CliDeps, io: Io): Promise<number> {
  const lines: string[] = [];
  let ok = true;
  lines.push(`node       ${process.version} (${process.platform}-${process.arch})`);
  lines.push(`home       ${deps.home}`);
  lines.push(
    `keychain   ${(await deps.keychain.available()) ? 'available' : 'not available (use gh auth or environment variables)'}`,
  );
  const git = await deps.exec.which('git');
  if (git) {
    const v = await deps.exec.run('git', ['--version'], { timeoutMs: 10_000 });
    lines.push(`git        ${v.stdout.trim()}`);
  } else {
    ok = false;
    lines.push('git        MISSING (required)');
  }
  lines.push('', 'GitHub:');
  const token = await resolveGitHubToken({
    keychain: deps.keychain,
    exec: deps.exec,
    env: process.env,
  });
  if (!token) {
    lines.push(
      '  token      missing: incubator auth set github, gh auth login, or GITHUB_TOKEN (publish needs it)',
    );
  } else {
    lines.push(`  token      from ${token.source}`);
    try {
      const info = await deps.github(token.token).tokenInfo();
      const missing = missingScopes(info.kind, info.scopes);
      lines.push(`  login      ${info.login}`);
      lines.push(
        info.kind === 'classic'
          ? `  scopes     ${info.scopes.join(', ') || '(none)'}${missing.length ? `  ✖ missing: ${missing.join(', ')}` : '  ✔ repo, workflow'}`
          : `  kind       ${info.kind}: verified by probe at publish`,
      );
      if (missing.length) ok = false;
    } catch (e) {
      lines.push(`  check      ✖ ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  lines.push('', 'LLM adapters:');
  const probes = await deps.llm.probeAll();
  let anyDiscovery = false;
  for (const [id, caps] of Object.entries(probes)) {
    const uses = (['discovery', 'analysis', 'handoff'] as const).filter((p) => caps.eligible[p]);
    anyDiscovery ||= caps.eligible.discovery;
    lines.push(`  ${id.padEnd(14)} ${caps.installed ? '✔' : '✖'} ${caps.version ?? ''}`.trimEnd());
    lines.push(`  ${''.padEnd(14)}   usable for: ${uses.length ? uses.join(', ') : 'nothing'}`);
    if (caps.installed && Object.keys(caps.flags).length)
      lines.push(`  ${''.padEnd(14)}   flags: ${JSON.stringify(caps.flags)}`);
    for (const r of caps.reasons) lines.push(`  ${''.padEnd(14)}   - ${r}`);
  }
  if (!anyDiscovery) {
    ok = false;
    lines.push(
      '',
      'No adapter can run discovery: install/log in to a supported CLI or set an Anthropic API key.',
    );
  }
  io.stdout(`${lines.join('\n')}\n`);
  return ok ? ExitCode.Ok : ExitCode.Policy;
}
