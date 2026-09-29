import type { Exec } from '@incubator/runtime';
import type { Capabilities } from './types.js';

/** Candidate spellings per capability, most preferred first. Never the only option (ADR-007). */
export const CANDIDATES = {
  printMode: [['-p'], ['--print']],
  jsonOutput: [['--output-format', 'json'], ['--format', 'json'], ['--json']],
  streamJson: [
    ['--output-format', 'stream-json'],
    ['--format', 'stream-json'],
  ],
  disableTools: [['--tools', ''], ['--disallowedTools', '*'], ['--disable-tools'], ['--no-tools']],
  maxTurns: ['--max-turns', '--max-steps'],
  model: ['--model', '-m'],
  systemPrompt: ['--system-prompt', '--append-system-prompt'],
} as const;

function hasFlag(help: string, flag: string): boolean {
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s,\\[(])${escaped}(?=[\\s,=\\])<]|$)`, 'm').test(help);
}

function pickArgs(help: string, options: readonly (readonly string[])[]): string[] | undefined {
  for (const option of options) {
    const [flag, value] = option;
    if (flag === undefined || !hasFlag(help, flag)) continue;
    if (value && value !== '' && value !== '*' && !help.toLowerCase().includes(value)) continue;
    return [...option];
  }
  return undefined;
}

function pickFlag(help: string, options: readonly string[]): string | undefined {
  return options.find((f) => hasFlag(help, f));
}

/** Pure: derives capabilities from `--version` / `--help` output. */
export function capabilitiesFromHelp(version: string, help: string, path?: string): Capabilities {
  const flags: Capabilities['flags'] = {};
  const set = <K extends keyof Capabilities['flags']>(
    k: K,
    v: Capabilities['flags'][K] | undefined,
  ): void => {
    if (v !== undefined) flags[k] = v;
  };
  set('printMode', pickArgs(help, CANDIDATES.printMode));
  set('jsonOutput', pickArgs(help, CANDIDATES.jsonOutput));
  set('streamJson', pickArgs(help, CANDIDATES.streamJson));
  set('disableTools', pickArgs(help, CANDIDATES.disableTools));
  set('maxTurns', pickFlag(help, CANDIDATES.maxTurns));
  set('model', pickFlag(help, CANDIDATES.model));
  set('systemPrompt', pickFlag(help, CANDIDATES.systemPrompt));
  const stdinPrompt = /stdin|standard input|piped/i.test(help);
  const reasons: string[] = [];
  if (!flags.printMode) reasons.push('no non-interactive print mode');
  if (!flags.jsonOutput) reasons.push('no JSON output mode');
  if (!stdinPrompt) reasons.push('cannot read the prompt from stdin');
  if (!flags.disableTools)
    reasons.push('cannot disable tools (not eligible for brownfield analysis)');
  if (!flags.streamJson) reasons.push('no streaming JSON (handoff ceilings need it)');
  const discovery = Boolean(flags.printMode && flags.jsonOutput && stdinPrompt);
  return {
    installed: true,
    ...(path ? { path } : {}),
    version: version.trim().split('\n')[0] ?? '',
    flags,
    stdinPrompt,
    eligible: {
      discovery,
      analysis: discovery && Boolean(flags.disableTools),
      handoff: Boolean(flags.printMode && flags.streamJson),
    },
    reasons,
  };
}

export function notInstalled(bin: string): Capabilities {
  return {
    installed: false,
    flags: {},
    stdinPrompt: false,
    eligible: { discovery: false, analysis: false, handoff: false },
    reasons: [`${bin} not found on PATH`],
  };
}

/** Runs `--version` and `--help` (never a shell) and derives capabilities. */
export async function probeCli(
  exec: Exec,
  bin: string,
  helpArgs: readonly string[] = ['--help'],
): Promise<Capabilities> {
  const resolved = await exec.which(bin);
  if (!resolved) return notInstalled(bin);
  const version = await exec.run(bin, ['--version'], { timeoutMs: 15_000 });
  const help = await exec.run(bin, [...helpArgs], { timeoutMs: 15_000 });
  return capabilitiesFromHelp(
    version.stdout || version.stderr,
    `${help.stdout}\n${help.stderr}`,
    resolved.path,
  );
}
