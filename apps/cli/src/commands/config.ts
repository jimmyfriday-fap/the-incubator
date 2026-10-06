import { ExitCode, PolicyError } from '@incubator/runtime';
import type { SettingsPatch, SettingsView } from '@incubator/core';
import type { CliDeps } from '../deps.js';
import type { Io } from '../io.js';

/** The settings a person can read and change by name, the same ones the Settings page shows. */
const KEYS = [
  'planning.tool',
  'planning.model',
  'coding.agent',
  'coding.model',
  'limits.timeoutSeconds',
  'limits.gcDays',
] as const;
type Key = (typeof KEYS)[number];

const bad = (message: string): never => {
  throw new PolicyError(message, { code: 'usage' });
};

function settingsOf(deps: CliDeps) {
  return deps.settings ?? bad('settings are not available in this build');
}

/** The value of one setting: `auto` or `default` when nothing is chosen. */
function read(v: SettingsView, key: string): string {
  const c = v.chosen;
  if (key.startsWith('toolPath.')) return c.toolPaths[key.slice('toolPath.'.length)] ?? 'default';
  const table: Record<Key, string | number | null> = {
    'planning.tool': c.planning.tool,
    'planning.model': c.planning.model,
    'coding.agent': c.coding.agent,
    'coding.model': c.coding.model,
    'limits.timeoutSeconds': c.limits.timeoutSeconds,
    'limits.gcDays': c.limits.gcDays,
  };
  if (!(key in table))
    bad(`unknown setting "${key}". Settings: ${[...KEYS, 'toolPath.<tool>'].join(', ')}`);
  return String(
    table[key as Key] ?? (key.endsWith('tool') || key.endsWith('agent') ? 'auto' : 'default'),
  );
}

const clear = (value: string): boolean => ['auto', 'default', 'none', ''].includes(value);

function patchFor(v: SettingsView, key: string, value: string): SettingsPatch {
  if (key.startsWith('toolPath.')) {
    const name = key.slice('toolPath.'.length);
    const next = { ...v.chosen.toolPaths };
    if (clear(value)) delete next[name];
    else next[name] = value;
    return { toolPaths: next };
  }
  const n = clear(value) ? null : Number(value);
  switch (key as Key) {
    case 'planning.tool':
      // why: the value is checked against the allowed tools when the change is applied.
      return { planning: { tool: (clear(value) ? 'auto' : value) as 'auto' } };
    case 'planning.model':
      return { planning: { model: clear(value) ? null : value } };
    case 'coding.agent':
      return { coding: { agent: (clear(value) ? 'auto' : value) as 'auto' } };
    case 'coding.model':
      return { coding: { model: clear(value) ? null : value } };
    case 'limits.timeoutSeconds':
      return { limits: { timeoutSeconds: n } };
    case 'limits.gcDays':
      return { limits: { gcDays: n } };
    default:
      return bad(`unknown setting "${key}". Settings: ${[...KEYS, 'toolPath.<tool>'].join(', ')}`);
  }
}

function summary(v: SettingsView): string {
  const e = v.effective;
  const planning = e.planning.tool
    ? `${e.planning.tool} · ${e.planning.model ?? 'the tool’s default model'}`
    : `none can run: ${e.planning.problem ?? 'unknown'}`;
  const paths = Object.entries(v.chosen.toolPaths).map(([k, p]) => `  ${k} = ${p}`);
  return [
    `planning   ${planning}`,
    `coding     ${e.coding.agent} · ${e.coding.model ?? 'the tool’s default model'}${e.coding.installed ? '' : '  (not installed)'}`,
    `timeout    ${v.chosen.limits.timeoutSeconds ?? 180} s per model call${v.chosen.limits.timeoutSeconds === null ? ' (default)' : ''}`,
    `gc         finished runs removed after ${v.chosen.limits.gcDays ?? 30} days${v.chosen.limits.gcDays === null ? ' (default)' : ''}`,
    ...(paths.length ? ['tool paths', ...paths] : []),
    '',
    `Change one with: incubator config set <setting> <value>   (settings: ${KEYS.join(', ')}, toolPath.<tool>)`,
    'Use "auto" or "default" as the value to go back to automatic.',
  ].join('\n');
}

/**
 * `incubator config [get <setting> | set <setting> <value>]`: the same settings as the Settings page. With no
 * arguments it shows what the next run will use.
 */
export async function runConfig(
  deps: CliDeps,
  io: Io,
  action: string | undefined,
  args: string[],
): Promise<number> {
  const settings = settingsOf(deps);
  if (action === undefined || action === 'show') {
    io.stdout(`${summary(await settings.view())}\n`);
    return ExitCode.Ok;
  }
  if (action === 'get') {
    if (args.length !== 1) bad('usage: incubator config get <setting>');
    io.stdout(`${read(await settings.view(), args[0]!)}\n`);
    return ExitCode.Ok;
  }
  if (action === 'set') {
    if (args.length !== 2) bad('usage: incubator config set <setting> <value>');
    const [key, value] = args as [string, string];
    const patch = patchFor(await settings.view(), key, value);
    const next = await settings.update(patch);
    io.stderr(`✔ ${key} = ${read(next, key)} (applies to the next run)\n`);
    return ExitCode.Ok;
  }
  return bad(`unknown action "${action}": use show, get or set`);
}
