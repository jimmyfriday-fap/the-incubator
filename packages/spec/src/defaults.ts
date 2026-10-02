import {
  DEFAULT_DENIED_ACTIONS,
  DEFAULT_HUMAN_ONLY_ACTIONS,
  DEFAULT_RUN_CEILINGS,
  FIXED_BY_PACKS,
  INCUBATOR_SPEC_VERSION,
  PACK_FOR_PLATFORM,
  STACK_DEFAULTS,
  WORK_LANES,
  type StackPack,
} from './constants.js';
import { changedPaths, covers, deepMerge, getAt } from './paths.js';
import type { Decision, IncubatorSpec } from './types.gen.js';

export type DraftSpec = Record<string, unknown>;

/** Lowercase kebab slug, GitHub-safe, 2–100 chars. */
export function slugify(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    .replace(/-+$/g, '');
  return s.length >= 2 ? s : `project-${s || 'x'}`.slice(0, 100);
}

const PLATFORM_FOR_PACK: Record<StackPack, IncubatorSpec['platform']> = {
  'node-web': 'web',
  'python-service': 'service',
  wordpress: 'wordpress-plugin',
  'node-lib': 'library',
  other: 'other',
};

/** The full default spec for whatever platform/pack the draft already chose. */
export function defaultsFor(draft: DraftSpec): IncubatorSpec {
  const draftPack = getAt(draft, 'stack.pack') as StackPack | undefined;
  const draftPlatform = getAt(draft, 'platform') as IncubatorSpec['platform'] | undefined;
  const pack: StackPack =
    draftPack ?? (draftPlatform ? PACK_FOR_PLATFORM[draftPlatform][0]! : 'node-web');
  const platform = draftPlatform ?? PLATFORM_FOR_PACK[pack];
  const stack = { ...STACK_DEFAULTS[pack] };
  if (pack === 'wordpress' && platform === 'wordpress-theme') stack.framework = 'wordpress-theme';
  const name = (getAt(draft, 'project.name') as string | undefined) ?? 'New Project';
  const slug = (getAt(draft, 'project.slug') as string | undefined) ?? slugify(name);
  const home =
    (getAt(draft, 'testing.home') as IncubatorSpec['testing']['home'] | undefined) ?? 'in-repo';
  const target: IncubatorSpec['deploy']['target'] =
    pack === 'other' ? 'other' : pack === 'node-lib' ? 'package-release' : 'vps-tailscale';
  const testing: IncubatorSpec['testing'] = {
    home,
    profiles: ['quick', 'full', 'chaos', 'hardening', 'release', 'live'],
    coverageThreshold: 80,
    completenessThreshold: 70,
    e2e: pack === 'node-lib' || pack === 'other' ? 'none' : 'playwright',
  };
  if (home === 'paired-repo') testing.pairedRepo = { name: `${slug}-tests`.slice(0, 100) };
  return {
    incubatorVersion: INCUBATOR_SPEC_VERSION,
    mode: 'greenfield',
    project: {
      name,
      slug,
      description: '',
      owner: { type: 'user', login: '' },
      visibility: 'private',
    },
    intent: { narrative: '', personas: [], coreFeatures: [] },
    platform,
    stack,
    lanes: {
      environments: ['local', 'staging', 'prod'],
      branches: { staging: 'main', prod: 'production' },
      workLanes: [...WORK_LANES],
    },
    deploy: {
      target,
      staging: { host: '', tailnetOnly: target === 'vps-tailscale' },
      prod: { host: '' },
    },
    testing,
    security: {
      scanners: ['semgrep', 'trivy', 'gitleaks'],
      policyGate: 'HIGH',
      centralRig: { enabled: false, repo: '' },
    },
    agents: {
      primary: 'claude',
      also: ['copilot', 'cursor'],
      runCeilings: { ...DEFAULT_RUN_CEILINGS },
      deniedActions: [...DEFAULT_DENIED_ACTIONS],
      humanOnlyActions: [...DEFAULT_HUMAN_ONLY_ACTIONS],
    },
    tracker: { type: 'local' },
    templates: { packs: [] },
    source: { type: 'none', ref: '' },
    gapReport: [],
    decisions: [],
  };
}

const NOT_A_DECISION = ['decisions', 'gapReport', 'intent.narrative', ...FIXED_BY_PACKS];

/**
 * Fills every missing field from the defaults and returns the `source: "default"` decisions for the
 * fields that were filled. Fields the draft already set are kept as they are.
 */
export function completeSpec(draft: DraftSpec): { spec: IncubatorSpec; added: Decision[] } {
  const base = defaultsFor(draft);
  const spec = deepMerge(base, draft);
  const decided = new Set(((draft['decisions'] as Decision[] | undefined) ?? []).map((d) => d.key));
  const added: Decision[] = [];
  for (const path of changedPaths({}, base)) {
    if (NOT_A_DECISION.some((k) => covers(k, path))) continue;
    if (getAt(draft, path) !== undefined || [...decided].some((k) => covers(k, path))) continue;
    added.push({
      key: path,
      question: `Default for ${path}`,
      answer: JSON.stringify(getAt(base, path)),
      source: 'default',
    });
  }
  spec.decisions = [...(spec.decisions ?? []), ...added];
  return { spec, added };
}
