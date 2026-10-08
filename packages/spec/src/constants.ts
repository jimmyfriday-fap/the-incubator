import type { IncubatorSpec, WorkLane } from './types.gen.js';

/** New and adopted projects. */
export const INCUBATOR_SPEC_VERSION = '1.0';
/** Enhancement runs add `mode: "enhancement"`, `existingRepo` and per-feature `targets`. */
export const ENHANCEMENT_SPEC_VERSION = '1.1';

export const WORK_LANES: readonly WorkLane[] = [
  'workspace',
  'security',
  'support/existing',
  'testing',
  'infra',
  'enhancement/existing',
  'enhancement/new',
  'ui/fix',
  'ui/feature',
];

/**
 * Decision keys the template packs already fix. Discovery never asks about these (brief §5 rule 3).
 */
export const FIXED_BY_PACKS: readonly string[] = [
  'incubatorVersion',
  'lanes',
  'security.scanners',
  'testing.profiles',
  'templates',
  'gapReport',
  'mode',
  'source',
  'existingRepo',
];

/**
 * Security-relevant fields that are never inferred from untrusted repository content (threat T6):
 * they come from the user or from safe defaults only.
 */
export const SECURITY_FIELDS: readonly string[] = [
  'project.visibility',
  'security',
  'agents.deniedActions',
  'agents.humanOnlyActions',
  'agents.runCeilings',
  'tracker.leantime.baseUrl',
  'deploy.staging.host',
  'deploy.prod.host',
  'deploy.registry',
];

export type StackPack = IncubatorSpec['stack']['pack'];

/** The value that marks a stack with no pack. Canonical-pattern files are unavailable for it. */
export const OTHER = 'other';

export const PACK_FOR_PLATFORM: Record<IncubatorSpec['platform'], readonly StackPack[]> = {
  web: ['node-web'],
  service: ['python-service', 'node-web'],
  cli: ['node-lib'],
  library: ['node-lib'],
  'wordpress-plugin': ['wordpress'],
  'wordpress-theme': ['wordpress'],
  other: ['other'],
};

export const STACK_DEFAULTS: Record<StackPack, IncubatorSpec['stack']> = {
  'node-web': {
    pack: 'node-web',
    framework: 'fastify-react',
    database: 'postgres',
    auth: 'session',
    packageManager: 'pnpm',
  },
  'python-service': {
    pack: 'python-service',
    framework: 'fastapi',
    database: 'postgres',
    auth: 'jwt',
    packageManager: 'uv',
  },
  wordpress: {
    pack: 'wordpress',
    framework: 'wordpress-plugin',
    database: 'mariadb',
    auth: 'wordpress',
    packageManager: 'composer',
  },
  'node-lib': {
    pack: 'node-lib',
    framework: 'typescript-lib',
    database: 'none',
    auth: 'none',
    packageManager: 'pnpm',
  },
  // A stack the Incubator has no pack for: only an enhancement run may describe one (ADR-024).
  other: {
    pack: 'other',
    framework: 'other',
    database: 'other',
    auth: 'other',
    packageManager: 'other',
  },
};

export const FRAMEWORKS_FOR_PACK: Record<
  StackPack,
  readonly IncubatorSpec['stack']['framework'][]
> = {
  'node-web': ['fastify-react'],
  'python-service': ['fastapi'],
  wordpress: ['wordpress-plugin', 'wordpress-theme'],
  'node-lib': ['typescript-lib'],
  other: ['other'],
};

export const PACKAGE_MANAGERS_FOR_PACK: Record<
  StackPack,
  readonly IncubatorSpec['stack']['packageManager'][]
> = {
  'node-web': ['pnpm', 'npm'],
  'python-service': ['uv'],
  wordpress: ['composer'],
  'node-lib': ['pnpm', 'npm'],
  other: ['other'],
};

// why: 150 turns (replies) per agent session; 60 stopped real update runs a few minutes in (plan 035).
export const DEFAULT_RUN_CEILINGS = { turns: 150, toolCalls: 400, minutes: 45, usd: 10 } as const;

export const DEFAULT_DENIED_ACTIONS: readonly string[] = [
  'force-push',
  'rewrite-history',
  'delete-or-skip-test',
  'disable-or-weaken-gate',
  'quarantine-without-owner-and-expiry',
  'edit-incubator-lock',
  'commit-secrets',
  'absolute-machine-paths',
  'plan-files-at-repo-root',
  'shell-true-subprocess',
];

export const DEFAULT_HUMAN_ONLY_ACTIONS: readonly string[] = [
  'promote-to-production',
  'rollback-production',
  'rotate-secrets',
  'edit-accepted-risks',
  'contracts-pin',
  'change-run-ceilings',
  'merge-to-production',
];
