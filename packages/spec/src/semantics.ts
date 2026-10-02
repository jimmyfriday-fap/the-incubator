import {
  FRAMEWORKS_FOR_PACK,
  OTHER,
  PACKAGE_MANAGERS_FOR_PACK,
  PACK_FOR_PLATFORM,
} from './constants.js';
import type { IncubatorSpec } from './types.gen.js';
import type { Issue } from './validate.js';

/** Cross-field rules the JSON Schema cannot express. Each issue has a stable code. */
export function validateSemantics(spec: IncubatorSpec): Issue[] {
  const issues: Issue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  const { pack, framework, database, packageManager } = spec.stack;

  if (!PACK_FOR_PLATFORM[spec.platform].includes(pack)) {
    add('platform_pack', '/stack/pack', `platform ${spec.platform} cannot use stack pack ${pack}`);
  }
  if (!FRAMEWORKS_FOR_PACK[pack].includes(framework)) {
    add(
      'pack_framework',
      '/stack/framework',
      `stack pack ${pack} supports ${FRAMEWORKS_FOR_PACK[pack].join(', ')}, not ${framework}`,
    );
  }
  if (!PACKAGE_MANAGERS_FOR_PACK[pack].includes(packageManager)) {
    add(
      'pack_package_manager',
      '/stack/packageManager',
      `stack pack ${pack} uses ${PACKAGE_MANAGERS_FOR_PACK[pack].join(' or ')}`,
    );
  }
  if (pack === 'node-lib' && database !== 'none')
    add('lib_database', '/stack/database', 'libraries and CLIs have no database');
  if (pack === 'wordpress' && database !== 'mariadb')
    add('wp_database', '/stack/database', 'WordPress runs on MariaDB');
  if (pack !== 'wordpress' && database === 'mariadb')
    add('mariadb_only_wp', '/stack/database', 'MariaDB is only offered for WordPress');
  if (
    pack === 'wordpress' &&
    spec.platform === 'wordpress-theme' &&
    framework !== 'wordpress-theme'
  ) {
    add(
      'wp_theme_framework',
      '/stack/framework',
      'a WordPress theme uses the wordpress-theme framework',
    );
  }
  if ((pack === 'node-lib') !== (spec.deploy.target === 'package-release')) {
    add(
      'deploy_class',
      '/deploy/target',
      pack === 'node-lib'
        ? 'libraries and CLIs deploy as package-release'
        : 'package-release is only for libraries and CLIs',
    );
  }
  if (pack === 'node-lib' && spec.testing.e2e !== 'none')
    add('lib_e2e', '/testing/e2e', 'libraries and CLIs have no browser e2e lane');

  const envs = spec.lanes.environments.join(',');
  if (envs !== 'local,staging,prod')
    add('fixed_lanes', '/lanes/environments', 'environment lanes are fixed: local, staging, prod');
  if (spec.lanes.branches.staging === spec.lanes.branches.prod)
    add('branches_distinct', '/lanes/branches', 'staging and prod branches must differ');
  if (spec.lanes.workLanes.length === 0)
    add('work_lanes', '/lanes/workLanes', 'at least one work lane is required');

  for (const p of ['quick', 'full'] as const) {
    if (!spec.testing.profiles.includes(p))
      add('profiles_min', '/testing/profiles', `run profile ${p} is required`);
  }
  if (spec.testing.home === 'paired-repo') {
    const name = spec.testing.pairedRepo?.name;
    if (!name)
      add('paired_name', '/testing/pairedRepo/name', 'paired-repo needs testing.pairedRepo.name');
    else if (name === spec.project.slug)
      add('paired_name', '/testing/pairedRepo/name', 'the tests repo needs its own name');
  }
  for (const s of ['semgrep', 'trivy', 'gitleaks'] as const) {
    if (!spec.security.scanners.includes(s))
      add('scanners_fixed', '/security/scanners', `scanner ${s} is always on`);
  }
  if (spec.security.centralRig.enabled && !spec.security.centralRig.repo) {
    add(
      'central_rig_repo',
      '/security/centralRig/repo',
      'centralRig.enabled needs centralRig.repo (owner/name)',
    );
  }
  if (spec.tracker.type === 'leantime' && !spec.tracker.leantime) {
    add('leantime_config', '/tracker/leantime', 'tracker leantime needs baseUrl and projectId');
  }
  if (spec.agents.also.includes(spec.agents.primary))
    add('agents_also', '/agents/also', 'the primary agent is not repeated in also[]');

  const ids = spec.intent.coreFeatures.map((f) => f.id);
  const dupFeature = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupFeature) add('feature_ids', '/intent/coreFeatures', `duplicate feature id ${dupFeature}`);
  for (const id of ids) {
    const clash = identifierClash(spec.stack.pack, id);
    if (clash)
      add(
        'feature_identifier',
        '/intent/coreFeatures',
        `feature id "${id}" ${clash}; pick another id`,
      );
  }
  if (ids.includes('health'))
    add(
      'feature_reserved',
      '/intent/coreFeatures',
      'feature id "health" is reserved for the built-in health feature',
    );
  // `other` (ADR-024): a stack with no pack. It is all-or-nothing and only an enhancement run may use it.
  const isOther = pack === OTHER;
  const otherAt: [string, unknown][] = [
    ['/platform', spec.platform],
    ['/stack/pack', pack],
    ['/stack/framework', framework],
    ['/stack/packageManager', packageManager],
    ['/stack/database', database],
    ['/stack/auth', spec.stack.auth],
    ['/deploy/target', spec.deploy.target],
  ];
  if (spec.mode !== 'enhancement') {
    for (const [at, value] of otherAt)
      if (value === OTHER)
        add(
          'other_mode',
          at,
          '"other" marks a stack the Incubator has no pack for; it is only valid for mode enhancement. New and adopted projects need node-web, node-lib, python-service or wordpress',
        );
  }
  if ((spec.deploy.target === OTHER) !== isOther)
    add(
      'other_deploy',
      '/deploy/target',
      'deploy.target is "other" exactly when stack.pack is "other"',
    );
  if (isOther) {
    if (database !== OTHER || spec.stack.auth !== OTHER)
      add('other_fields', '/stack', 'stack pack "other" has database "other" and auth "other"');
    if (spec.testing.e2e !== 'none')
      add('other_fields', '/testing/e2e', 'stack pack "other" has no generated e2e lane');
  } else if (database === OTHER || spec.stack.auth === OTHER) {
    add('other_fields', '/stack', 'database and auth "other" are only for stack pack "other"');
  }
  // Enhancement runs (spec 1.1): the mode, the version and the repository block go together.
  if (spec.mode === 'enhancement') {
    if (spec.incubatorVersion !== '1.1')
      add('enhancement_version', '/incubatorVersion', 'an enhancement spec is version 1.1');
    if (!spec.existingRepo)
      add('enhancement_repo', '/existingRepo', 'mode enhancement needs existingRepo');
  } else if (spec.existingRepo) {
    add('existing_repo_mode', '/existingRepo', 'existingRepo is only for mode enhancement');
  }
  spec.intent.coreFeatures.forEach((f, i) => {
    for (const t of f.targets ?? []) {
      if (!isRepoRelative(t))
        add(
          'target_path',
          `/intent/coreFeatures/${i}/targets`,
          `target "${t}" must be a repository-relative path without ".." or drive letters`,
        );
    }
  });
  const keys = spec.decisions.map((d) => d.key);
  const dupDecision = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupDecision) add('decision_keys', '/decisions', `decision ${dupDecision} is recorded twice`);
  return issues;
}

/** A path that stays inside the repository: relative, forward slashes, no `..`, no control characters. */
export function isRepoRelative(p: string): boolean {
  if (p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false;
  // eslint-disable-next-line no-control-regex -- why: control characters are exactly what is rejected.
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  return !p.split('/').some((seg) => seg === '..');
}

const words = (id: string): string[] => id.split(/[^A-Za-z0-9]+/).filter(Boolean);
const pascal = (id: string): string =>
  words(id)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join('');
const camel = (id: string): string => {
  const p = pascal(id);
  return p ? p[0]!.toLowerCase() + p.slice(1) : p;
};
const snake = (id: string): string =>
  words(id)
    .map((w) => w.toLowerCase())
    .join('_');

const JS_RESERVED = new Set(
  (
    'await break case catch class const continue debugger default delete do else enum export extends ' +
    'false finally for function if implements import in instanceof interface let new null package ' +
    'private protected public return static super switch this throw true try typeof var void while ' +
    'with yield arguments eval'
  ).split(' '),
);
const PY_RESERVED = new Set(
  (
    'false none true and as assert async await break class continue def del elif else except finally ' +
    'for from global if import in is lambda nonlocal not or pass raise return try while with yield ' +
    'match case type app db env main features'
  ).split(' '),
);
const PHP_RESERVED = new Set(
  (
    'abstract and array as break callable case catch class clone const continue declare default do ' +
    'echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile enum eval exit extends ' +
    'final finally fn for foreach function global goto if implements include include_once instanceof ' +
    'insteadof interface isset list match namespace new or print private protected public readonly ' +
    'require require_once return static switch throw trait try unset use var while xor yield int float ' +
    'bool string true false null void iterable object mixed never self parent plugin theme'
  ).split(' '),
);

/**
 * Feature ids become identifiers in generated code (camelCase functions in TypeScript, snake_case
 * modules in Python, PascalCase classes in PHP). An id that turns into a reserved word, or into a
 * name the pack itself uses, would render code that does not compile.
 */
export function identifierClash(pack: IncubatorSpec['stack']['pack'], id: string): string | null {
  if (pack === 'python-service' && PY_RESERVED.has(snake(id)))
    return `becomes the Python name "${snake(id)}", which is reserved`;
  if (pack === 'wordpress' && PHP_RESERVED.has(pascal(id).toLowerCase()))
    return `becomes the PHP class "${pascal(id)}", which is reserved`;
  if ((pack === 'node-web' || pack === 'node-lib') && JS_RESERVED.has(camel(id)))
    return `becomes the TypeScript name "${camel(id)}", which is reserved`;
  return null;
}
