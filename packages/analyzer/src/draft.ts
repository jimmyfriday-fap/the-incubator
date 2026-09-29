import { completeSpec, slugify, type Decision, type IncubatorSpec } from '@incubator/spec';
import type { Analysis } from './detectors.js';

export interface DraftOptions {
  /** Fallback name (the repository or directory name). */
  repoName: string;
  owner: IncubatorSpec['project']['owner'];
  visibility?: IncubatorSpec['project']['visibility'];
}

const clean = (s: string | null, max: number): string | null => {
  if (!s) return null;
  const t = s
    // eslint-disable-next-line no-control-regex -- why: control characters are exactly what is stripped.
    .replace(/[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.slice(0, max) : null;
};

/**
 * A spec draft inferred from the analysis (brownfield discovery without an LLM). Every inferred value
 * is attributed with its evidence. Security-relevant fields (visibility, policy gate, hosts,
 * ceilings, denied actions) are never inferred from repository content (threat T6): they come from
 * the caller or from safe defaults.
 */
export function draftFromAnalysis(
  a: Analysis,
  o: DraftOptions,
): { spec: IncubatorSpec; inferred: Decision[] } {
  if (!a.stack)
    throw new Error('no supported stack detected (node-web, node-lib, python-service, wordpress)');
  const name = clean(a.name, 100) ?? o.repoName;
  const slug = slugify(o.repoName) || slugify(name);
  const why = a.stack.evidence.map((e) => `${e.file}: ${e.note}`).join('; ');
  const inferred: Decision[] = [
    {
      key: 'platform',
      question: 'What kind of project is this?',
      answer: JSON.stringify(a.stack.platform),
      source: 'inferred',
    },
    {
      key: 'stack.pack',
      question: `Which stack pack fits? (${why})`,
      answer: JSON.stringify(a.stack.pack),
      source: 'inferred',
    },
    {
      key: 'stack.framework',
      question: 'Which reference framework?',
      answer: JSON.stringify(a.stack.framework),
      source: 'inferred',
    },
    {
      key: 'project.name',
      question: 'Project name (from the repository manifest)',
      answer: JSON.stringify(name),
      source: 'inferred',
    },
  ];
  const deploy =
    a.deploy.target ?? (a.stack.pack === 'node-lib' ? 'package-release' : 'vps-tailscale');
  if (a.deploy.target)
    inferred.push({
      key: 'deploy.target',
      question: `Deploy class (${a.deploy.evidence.map((e) => `${e.file}: ${e.note}`).join('; ')})`,
      answer: JSON.stringify(a.deploy.target),
      source: 'inferred',
    });
  const draft = {
    project: {
      name,
      slug,
      description: clean(a.description, 500) ?? `${name} (adopted by the Incubator)`,
      owner: o.owner,
      ...(o.visibility ? { visibility: o.visibility } : {}),
    },
    intent: {
      narrative: `Adopt the existing ${a.stack.pack} repository ${o.repoName} into the canonical pattern.`,
      personas: [],
      coreFeatures: [],
    },
    platform: a.stack.platform,
    stack: { pack: a.stack.pack, framework: a.stack.framework },
    deploy: { target: deploy },
    ...(a.stack.pack === 'node-lib' ? { testing: { e2e: 'none' } } : {}),
    mode: 'brownfield',
    decisions: inferred,
  };
  return { spec: completeSpec(draft).spec, inferred };
}
