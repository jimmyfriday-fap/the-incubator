import path from 'node:path';
import { DEFAULT_ANTHROPIC_MODEL, LLM_ADAPTER_IDS, type LlmRegistry } from '@incubator/llm';
import { PolicyError, type Keychain } from '@incubator/runtime';
import { MODEL_ID, type ConfigStore, type IncubatorConfig } from './config.js';

/** The tools that can plan (questions, analysis, summaries). `fake` exists for tests only. */
export const PLANNING_TOOLS = LLM_ADAPTER_IDS.filter((id) => id !== 'fake');
export const CODING_AGENTS = ['claude', 'copilot', 'cursor'] as const;
type PlanningTool = (typeof PLANNING_TOOLS)[number];
type CodingAgent = (typeof CODING_AGENTS)[number];

/** What the Settings page and `incubator config set` may change. Anything left out is unchanged. */
export interface SettingsPatch {
  planning?: { tool?: 'auto' | PlanningTool; model?: string | null };
  coding?: { agent?: 'auto' | CodingAgent; model?: string | null };
  limits?: { timeoutSeconds?: number | null; gcDays?: number | null };
  /** Replaces the whole list. */
  toolPaths?: Record<string, string>;
}

export interface CredentialSource {
  account: string;
  /** Where the value comes from (keychain, gh, env), or null when there is none. Never the value. */
  source: string | null;
}

export interface SettingsView {
  /** What the owner has chosen. `null` means automatic, or the tool's own default. */
  chosen: {
    planning: { tool: 'auto' | PlanningTool; model: string | null };
    coding: { agent: 'auto' | CodingAgent; model: string | null };
    limits: { timeoutSeconds: number | null; gcDays: number | null };
    toolPaths: Record<string, string>;
  };
  /** What the next run will use. */
  effective: {
    planning: { tool: string | null; model: string | null; problem?: string };
    coding: { agent: string; model: string | null; installed: boolean };
  };
  adapters: {
    id: string;
    installed: boolean;
    version: string | null;
    canPlan: boolean;
    canCode: boolean;
    takesModel: boolean;
  }[];
  credentials: CredentialSource[];
  about: { home: string; keychain: boolean };
}

const bad = (message: string): never => {
  throw new PolicyError(message, { code: 'bad_settings' });
};

const model = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined || v === '') return null;
  return MODEL_ID.test(v) ? v : bad(`"${v}" is not a model id: use letters, digits and . _ : -`);
};

const whole = (v: number, min: number, max: number, what: string): number =>
  Number.isInteger(v) && v >= min && v <= max
    ? v
    : bad(`${what} must be a whole number from ${min} to ${max}`);

/** Validates a patch and applies it to the configuration. Throws `bad_settings` and changes nothing if any part is wrong. */
export function applySettings(config: IncubatorConfig, patch: SettingsPatch): void {
  const p = patch.planning;
  if (p?.tool !== undefined) {
    if (p.tool !== 'auto' && !(PLANNING_TOOLS as readonly string[]).includes(p.tool))
      bad(`"${p.tool}" is not a planning tool`);
    config.llm ??= {};
    if (p.tool === 'auto') delete config.llm.preferred;
    else config.llm.preferred = p.tool;
  }
  if (p?.model !== undefined) {
    const m = model(p.model);
    config.llm ??= {};
    if (m === null) delete config.llm.cliModel;
    else config.llm.cliModel = m;
  }
  const c = patch.coding;
  if (c?.agent !== undefined) {
    if (c.agent !== 'auto' && !(CODING_AGENTS as readonly string[]).includes(c.agent))
      bad(`"${c.agent}" is not a coding agent`);
    config.agents ??= {};
    if (c.agent === 'auto') delete config.agents.primary;
    else config.agents.primary = c.agent;
  }
  if (c?.model !== undefined) {
    const m = model(c.model);
    config.agents ??= {};
    if (m === null) delete config.agents.model;
    else config.agents.model = m;
  }
  const l = patch.limits;
  if (l?.timeoutSeconds !== undefined) {
    config.discovery ??= {};
    if (l.timeoutSeconds === null) delete config.discovery.timeoutMs;
    else config.discovery.timeoutMs = whole(l.timeoutSeconds, 10, 3600, 'the model timeout') * 1000;
  }
  if (l?.gcDays !== undefined) {
    config.gc ??= {};
    if (l.gcDays === null) delete config.gc.days;
    else config.gc.days = whole(l.gcDays, 1, 3650, 'the number of days');
  }
  if (patch.toolPaths !== undefined) {
    const next: Record<string, string> = {};
    for (const [name, where] of Object.entries(patch.toolPaths)) {
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(name)) bad(`"${name}" is not a tool name`);
      if (!path.isAbsolute(where)) bad(`the location of ${name} must be an absolute path`);
      next[name] = where;
    }
    if (Object.keys(next).length) config.toolPaths = next;
    else delete config.toolPaths;
  }
  // Empty sections left behind by a "back to automatic" are removed, so the file stays tidy.
  for (const k of ['llm', 'agents', 'discovery', 'gc'] as const)
    if (config[k] && Object.keys(config[k]).length === 0) delete config[k];
}

/** The settings of the next run, and the one place a change to them is saved. */
export class Settings {
  constructor(
    private readonly deps: {
      home: string;
      config: ConfigStore;
      llm: LlmRegistry;
      keychain: Keychain;
      credentials: () => Promise<CredentialSource[]>;
    },
  ) {}

  async view(): Promise<SettingsView> {
    const cfg = this.deps.config.get();
    const probes = await this.deps.llm.probeAll();
    const adapters = Object.entries(probes)
      .filter(([id]) => id !== 'fake')
      .map(([id, caps]) => ({
        id,
        installed: caps.installed,
        version: caps.version ?? null,
        canPlan: caps.eligible.discovery,
        canCode: caps.eligible.handoff,
        takesModel: Boolean(caps.flags.model) || id === 'anthropic-api',
      }));
    let planning: SettingsView['effective']['planning'];
    try {
      const a = await this.deps.llm.select('discovery');
      planning = {
        tool: a.id,
        model:
          a.id === 'anthropic-api'
            ? (cfg.llm?.anthropic?.model ?? DEFAULT_ANTHROPIC_MODEL)
            : (cfg.llm?.cliModel ?? null),
      };
    } catch (e) {
      planning = {
        tool: null,
        model: null,
        problem: e instanceof Error ? e.message : String(e),
      };
    }
    const agent = cfg.agents?.primary ?? 'claude';
    const coder = adapters.find((a) => a.id === `${agent}-cli`);
    return {
      chosen: {
        planning: {
          tool: (cfg.llm?.preferred as PlanningTool | undefined) ?? 'auto',
          model: cfg.llm?.cliModel ?? null,
        },
        coding: { agent: cfg.agents?.primary ?? 'auto', model: cfg.agents?.model ?? null },
        limits: {
          timeoutSeconds: cfg.discovery?.timeoutMs
            ? Math.round(cfg.discovery.timeoutMs / 1000)
            : null,
          gcDays: cfg.gc?.days ?? null,
        },
        toolPaths: { ...cfg.toolPaths },
      },
      effective: {
        planning,
        coding: { agent, model: cfg.agents?.model ?? null, installed: coder?.installed ?? false },
      },
      adapters,
      credentials: await this.deps.credentials(),
      about: { home: this.deps.home, keychain: await this.deps.keychain.available() },
    };
  }

  async update(patch: SettingsPatch): Promise<SettingsView> {
    this.deps.config.update((c) => applySettings(c, patch));
    return this.view();
  }
}
