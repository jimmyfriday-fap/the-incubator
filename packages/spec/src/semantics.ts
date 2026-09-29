import { FRAMEWORKS_FOR_PACK, PACKAGE_MANAGERS_FOR_PACK, PACK_FOR_PLATFORM } from './constants.js';
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
  if (ids.includes('health'))
    add(
      'feature_reserved',
      '/intent/coreFeatures',
      'feature id "health" is reserved for the built-in health feature',
    );
  const keys = spec.decisions.map((d) => d.key);
  const dupDecision = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dupDecision) add('decision_keys', '/decisions', `decision ${dupDecision} is recorded twice`);
  return issues;
}
