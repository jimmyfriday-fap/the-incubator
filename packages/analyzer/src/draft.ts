import { completeSpec, slugify, type Decision, type IncubatorSpec } from '@incubator/spec';
import { PACKED_ECOSYSTEMS, type Analysis } from './detectors.js';

export interface DraftOptions {
  /** Fallback name (the repository or directory name). */
  repoName: string;
  owner: IncubatorSpec['project']['owner'];
  visibility?: IncubatorSpec['project']['visibility'];
  /**
   * Enhance runs only: a repository with no stack pack gets an `other` draft (ADR-024) instead of an
   * error. Adopt leaves this off, because it adds canonical files and those need a pack.
   */
  allowOther?: boolean;
}

/** Why no pack fits, in the owner's words. */
export function unsupportedStackLabel(a: Analysis): string {
  return a.ecosystem ? a.ecosystem.label : 'unrecognised stack';
}

/**
 * True when the repository should be treated as having no pack: nothing was detected, or only a weak
 * guess from a stray `package.json` while the root manifest says another ecosystem (a Flutter app
 * with a Node tooling file).
 */
export function hasNoPack(a: Analysis): boolean {
  if (!a.stack) return true;
  return (
    a.stack.confidence === 'low' && a.ecosystem !== null && !PACKED_ECOSYSTEMS.has(a.ecosystem.id)
  );
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
  const name = clean(a.name, 100) ?? o.repoName;
  const slug = slugify(o.repoName) || slugify(name);
  if (o.allowOther && hasNoPack(a)) return otherDraft(a, o, name, slug);
  if (!a.stack)
    throw new Error(
      `no supported stack detected (node-web, node-lib, python-service, wordpress)${
        a.ecosystem
          ? `: this looks like ${a.ecosystem.label}. The canonical-pattern files need a stack pack; use "Update an existing solution" (incubator enhance) to change it without them`
          : ''
      }`,
    );
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

/** The draft for a repository no stack pack fits: every stack field is `other`, nothing is inferred. */
function otherDraft(
  a: Analysis,
  o: DraftOptions,
  name: string,
  slug: string,
): { spec: IncubatorSpec; inferred: Decision[] } {
  const label = unsupportedStackLabel(a);
  const inferred: Decision[] = [
    {
      key: 'stack.pack',
      question: `Which stack pack fits? (none: ${label}${
        a.ecosystem ? `, ${a.ecosystem.evidence.map((e) => e.file).join(', ')}` : ''
      })`,
      answer: JSON.stringify('other'),
      source: 'inferred',
    },
    {
      key: 'project.name',
      question: 'Project name (from the repository manifest)',
      answer: JSON.stringify(name),
      source: 'inferred',
    },
  ];
  const draft = {
    project: {
      name,
      slug,
      description: clean(a.description, 500) ?? `${name} (updated with the Incubator)`,
      owner: o.owner,
      ...(o.visibility ? { visibility: o.visibility } : {}),
    },
    intent: {
      narrative: `Update the existing ${label} repository ${o.repoName}. It has no stack pack, so the canonical-pattern files are not available.`,
      personas: [],
      coreFeatures: [],
    },
    platform: 'other',
    stack: { pack: 'other' },
    mode: 'brownfield',
    decisions: inferred,
  };
  return { spec: completeSpec(draft).spec, inferred };
}
