import {
  OTHER,
  builtFeatures,
  hasMvpCut,
  laterFeatures,
  type IncubatorSpec,
} from '@incubator/spec';

export function summarizeSpec(spec: IncubatorSpec): string {
  const count = (s: string) => spec.decisions.filter((d) => d.source === s).length;
  const all = spec.intent.coreFeatures;
  const later = laterFeatures(all).map((f) => f.id);
  const features =
    (hasMvpCut(all)
      ? `${builtFeatures(all)
          .map((f) => f.id)
          .join(', ')} (MVP)${later.length ? `; later: ${later.join(', ')}` : ''}`
      : all.map((f) => f.id).join(', ')) || '(none yet)';
  return [
    `project    ${spec.project.name} (${spec.project.slug}), ${spec.project.visibility}`,
    ...(spec.stack.pack === OTHER
      ? [
          'stack      other: no Incubator stack pack fits this repository (canonical files unavailable)',
        ]
      : [
          `platform   ${spec.platform} · stack ${spec.stack.pack}/${spec.stack.framework} · db ${spec.stack.database} · auth ${spec.stack.auth}`,
          `deploy     ${spec.deploy.target} · tests ${spec.testing.home} (coverage ${spec.testing.coverageThreshold} %, e2e ${spec.testing.e2e})`,
        ]),
    `tracker    ${spec.tracker.type} · agents ${[spec.agents.primary, ...spec.agents.also].join(', ')}`,
    `features   ${features}`,
    `decisions  ${count('user')} user · ${count('inferred')} inferred · ${count('default')} default`,
  ].join('\n');
}
