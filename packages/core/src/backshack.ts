import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ParkError, PolicyError } from '@incubator/runtime';
import type { GitOps } from '@incubator/git';
import { BACKSHACK_STACK, stackById, type StackWorkspace } from '@incubator/spec';
import { clean } from '@incubator/analyzer';
import type { IncubatorConfig } from './config.js';

/**
 * The Backshack tool stack (ADR-030). A Backshack build is never a new repository: it is a fresh worktree of the
 * owner's backshack-dev checkout, on its own branch, and the coding agent works under the Backshack Build Contract
 * read verbatim from the owner's backshack-generator checkout. Every path comes from `~/.incubator/config.json`.
 */

/** What the owner approved the Backshack target with, kept as `incubator-recommendation.yaml`. */
export interface BackshackFit {
  toolName: string;
  toolSlug: string;
  /** The short prefix of the tool's tables and AI pipes (`scope` for The Scope). */
  prefix: string;
  /** The catalog rack, or "new". */
  rack: string;
  stages: string[];
  aiPipes: string[];
  /** The handoff export's schema name, `backshack.<x>-handoff.v1`. */
  handoffSchema: string;
}

export interface BackshackDecision {
  target: 'backshack';
  rationale: string[];
  fit: BackshackFit;
  decidedAt: string;
}

/**
 * The token cap a Backshack build gets when the owner has set none (`agents.ceilings.tokens`). Live run 2 processed
 * 36.3M tokens (75 replies, mostly cache reads of a large context) for about $27 at list price, so 15M is roughly
 * $11 on that one run. A proxy for plan usage, not dollars: tune it from the `handoff.result` journal entries.
 */
export const BACKSHACK_TOKEN_CEILING = 15_000_000;

/** The file the decision is written to, in the run folder. */
export const RECOMMENDATION_FILE = 'incubator-recommendation.yaml';

const SLUG = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const PREFIX = /^[a-z][a-z0-9_]{1,23}$/;
const SCHEMA = /^backshack\.[a-z0-9-]{1,60}-handoff\.v\d{1,3}$/;

function workspace(): StackWorkspace {
  return stackById(BACKSHACK_STACK)!.workspace!;
}

/** A tool name as a kebab-case slug, or null when nothing usable is left. */
export function backshackSlug(name: string): string | null {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '');
  return SLUG.test(slug) ? slug : null;
}

const list = (v: unknown, max: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => clean(x, max))
        .filter(Boolean)
        .slice(0, 12)
    : [];

/**
 * The fit from what the recommender or the owner supplied (untrusted: cleaned and capped), with defaults for
 * what is missing. A slug, prefix or schema name that cannot be used is a policy error, never a guess.
 */
export function backshackFit(input: Partial<Record<keyof BackshackFit, unknown>>): BackshackFit {
  const toolName = typeof input.toolName === 'string' ? clean(input.toolName, 80) : '';
  if (!toolName)
    throw new PolicyError('name the Backshack tool first', { code: 'bad_backshack_fit' });
  const toolSlug =
    typeof input.toolSlug === 'string' && input.toolSlug ? input.toolSlug : backshackSlug(toolName);
  if (!toolSlug || !SLUG.test(toolSlug))
    throw new PolicyError(
      'the tool slug must be lower-case letters, digits and dashes (for example the-scope)',
      { code: 'bad_backshack_fit' },
    );
  const prefix =
    typeof input.prefix === 'string' && input.prefix
      ? input.prefix
      : toolSlug.replace(/^the-/, '').replace(/-/g, '_').slice(0, 24).replace(/_+$/, '');
  if (!PREFIX.test(prefix))
    throw new PolicyError('the prefix must be lower-case letters, digits and underscores', {
      code: 'bad_backshack_fit',
    });
  const handoffSchema =
    typeof input.handoffSchema === 'string' && input.handoffSchema
      ? input.handoffSchema
      : `backshack.${toolSlug.replace(/^the-/, '')}-handoff.v1`;
  if (!SCHEMA.test(handoffSchema))
    throw new PolicyError('the handoff schema must look like backshack.<name>-handoff.v1', {
      code: 'bad_backshack_fit',
    });
  const rack = typeof input.rack === 'string' ? clean(input.rack, 60) : '';
  return {
    toolName,
    toolSlug,
    prefix,
    rack: rack || 'new',
    stages: list(input.stages, 80),
    aiPipes: list(input.aiPipes, 80),
    handoffSchema,
  };
}

/** YAML with every scalar double-quoted (JSON strings are YAML), so no value can change the document's shape. */
export function recommendationYaml(d: BackshackDecision): string {
  const q = (s: string): string => JSON.stringify(s);
  const seq = (items: string[], indent: string): string =>
    items.length ? `\n${items.map((i) => `${indent}- ${q(i)}`).join('\n')}` : ' []';
  return [
    `target: ${q(d.target)}`,
    `rationale:${seq(d.rationale, '  ')}`,
    'backshack_fit:',
    `  tool_name: ${q(d.fit.toolName)}`,
    `  tool_slug: ${q(d.fit.toolSlug)}`,
    `  prefix: ${q(d.fit.prefix)}`,
    `  rack: ${q(d.fit.rack)}`,
    `  stages:${seq(d.fit.stages, '    ')}`,
    `  ai_pipes:${seq(d.fit.aiPipes, '    ')}`,
    `  handoff_schema: ${q(d.fit.handoffSchema)}`,
    `decided_at: ${q(d.decidedAt)}`,
    '',
  ].join('\n');
}

export interface BackshackPaths {
  devRepo: string;
  contract: string;
  worktreeRoot: string;
}

/** The configured paths, or what is wrong with the configuration (nothing is created or read here). */
export function backshackPaths(
  cfg: IncubatorConfig,
  home: string,
): { ok: true; paths: BackshackPaths } | { ok: false; problems: string[] } {
  const b = cfg.backshack ?? {};
  const problems: string[] = [];
  const abs = (key: string, v: string | undefined): string | null => {
    if (!v) {
      problems.push(`Set backshack.${key} in ~/.incubator/config.json.`);
      return null;
    }
    if (!path.isAbsolute(v)) {
      problems.push(`backshack.${key} must be a full path.`);
      return null;
    }
    return path.resolve(v);
  };
  const devRepo = abs('devRepo', b.devRepo);
  const generator = abs('generatorRepo', b.generatorRepo);
  const root =
    b.worktreeRoot === undefined
      ? path.join(home, 'worktrees')
      : abs('worktreeRoot', b.worktreeRoot);
  if (devRepo && !existsSync(path.join(devRepo, '.git')))
    problems.push(`backshack.devRepo (${devRepo}) is not a git repository.`);
  if (!devRepo || !generator || !root) return { ok: false, problems };
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    paths: {
      devRepo,
      contract: path.join(generator, ...workspace().contractFile.split('/')),
      worktreeRoot: root,
    },
  };
}

/** The paths, or a park that says what to configure. */
export function requireBackshackPaths(cfg: IncubatorConfig, home: string): BackshackPaths {
  const p = backshackPaths(cfg, home);
  if (!p.ok) throw new ParkError('backshack_not_configured', p.problems.join(' '));
  return p.paths;
}

/**
 * The Backshack Build Contract, verbatim. A missing or empty file parks the run: a Backshack build never starts
 * or codes without it.
 */
export function readBackshackContract(paths: BackshackPaths): string {
  const text = existsSync(paths.contract) ? readFileSync(paths.contract, 'utf8') : '';
  if (!text.trim())
    throw new ParkError(
      'backshack_contract_missing',
      `the Backshack Build Contract is missing (${paths.contract}): a Backshack tool is never built without it. Restore the file, then resume`,
      { contract: paths.contract },
    );
  return text.replace(/\r\n?/g, '\n');
}

/**
 * The files a Backshack tool run builds in: the tool's own package folder and its one-line shim (Backshack Build
 * Contract G1). The word match the other enhance runs use (`resolveTargets`) is wrong here: backshack-dev holds every
 * existing tool, so a request's words matched their `register.php` files and a third-party plugin, and the plan sent
 * the agent to edit those. A new tool has nothing in the scan to match, so its targets come from its slug.
 */
export function backshackTargets(slug: string): string[] {
  const plugin = 'wp-content/plugins/backshack-datalake';
  return [`${plugin}/src/Tools/${slug}/`, `${plugin}/src/tools-auto/${slug}.php`];
}

/**
 * The contract's Section 5 commands that can be approved checks, proposed ahead of the stack's own. Only the
 * group-guard lint qualifies: `node --check` takes a flag where a check needs a subcommand, so the agent runs
 * that one as a search-and-read step. `--enforce` makes a warning exit 1, so the Incubator's own run catches it.
 */
export function backshackChecks(slug: string): { command: string; what: string; why: string }[] {
  return [
    {
      command: `php wp-content/plugins/backshack-datalake/bin/lint-group-guard.php --enforce --tool=${slug}`,
      what: 'checks every query and action of the tool filters on the caller’s group',
      why: 'Backshack Build Contract, Section 5 (G3/G8)',
    },
  ];
}

/**
 * Copies the run's guides (`.incubator/`: enhance designs, tickets, lanes) from the run's clone into the worktree,
 * where the plan and the code verify look for them, and hides them from git with a nested `.gitignore` of `*`
 * (which also ignores itself). A file already in the worktree is kept, so a resumed run keeps the ticket states
 * the agent advanced; `state/` is the agent's own bookkeeping and is never copied.
 */
// why: not `info/exclude` or git config: a linked worktree shares both with the owner's main checkout.
export function stageRunGuides(fromRepo: string, worktree: string): void {
  const from = path.join(fromRepo, '.incubator');
  const to = path.join(worktree, '.incubator');
  mkdirSync(to, { recursive: true });
  writeFileSync(path.join(to, '.gitignore'), '*\n');
  if (!existsSync(from)) return;
  const state = path.join(from, 'state');
  cpSync(from, to, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter: (src) => src !== state && !src.startsWith(state + path.sep),
  });
}

/** Where a tool's worktree goes, and its branch. */
export function backshackWorktree(
  paths: BackshackPaths,
  slug: string,
): { dir: string; branch: string } {
  if (!SLUG.test(slug))
    throw new PolicyError(`${slug} is not a tool slug`, { code: 'bad_backshack_fit' });
  return {
    dir: path.join(paths.worktreeRoot, `backshack-${slug}`),
    branch: `${workspace().branchPrefix}${slug}`,
  };
}

/**
 * Fetches the base from origin, then adds the worktree on the tool's branch. An existing folder is refused, never
 * reused or removed: the owner removes old worktrees with their own tool.
 */
export async function createBackshackWorktree(
  git: GitOps,
  paths: BackshackPaths,
  slug: string,
): Promise<{ dir: string; branch: string; base: string; head: string }> {
  const { dir, branch } = backshackWorktree(paths, slug);
  if (existsSync(dir))
    throw new PolicyError(
      `${dir} already exists: remove that worktree first, or choose another tool name`,
      { code: 'worktree_exists' },
    );
  const base = workspace().base;
  const remoteBranch = base.replace(/^origin\//, '');
  await git.fetch(paths.devRepo, 'origin', `+refs/heads/${remoteBranch}:refs/remotes/${base}`);
  await git.worktreeAdd(paths.devRepo, dir, branch, base);
  return { dir, branch, base, head: (await git.headSha(dir)) ?? '' };
}
