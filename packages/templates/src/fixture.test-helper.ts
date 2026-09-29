import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completeSpec, type IncubatorSpec } from '@incubator/spec';

/** Writes a fixture pack tree ({pack dir → {file → content}}) plus the lock files; returns the packs dir. */
export function fixturePacks(packs: Record<string, Record<string, unknown>>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'incubator-packs-'));
  writeFileSync(
    path.join(root, 'actions-lock.json'),
    JSON.stringify({ actions: { 'actions/checkout': { tag: 'v5.0.0', sha: 'a'.repeat(40) } } }),
  );
  writeFileSync(path.join(root, 'versions.json'), JSON.stringify({ npm: { vitest: '^4.0.0' } }));
  for (const [dir, files] of Object.entries(packs)) {
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(root, 'packs', dir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(
        abs,
        typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
      );
    }
  }
  return path.join(root, 'packs');
}

export function manifest(id: string, appliesWhen: string, extra: Record<string, unknown> = {}) {
  return { id, version: '1.0.0', description: `${id} fixture`, appliesWhen, files: [], ...extra };
}

/** A minimal valid four-pack set: base, stack/node-web, deploy/vps-tailscale, test-home/in-repo + paired-repo. */
export function minimalPacks(over: Record<string, Record<string, unknown>> = {}) {
  return fixturePacks({
    base: {
      'pack.json': manifest('base', 'true', {
        files: [
          { src: 'files/README.md.eta', dest: 'README.md' },
          { src: 'files/config/checks.json', dest: 'config/checks.json' },
          { src: 'files/src/app.ts', dest: 'src/app.ts' },
          {
            src: 'files/feature.ts.eta',
            dest: 'src/features/<%= it.feature.id %>.ts',
            each: 'spec.intent.coreFeatures',
            as: 'feature',
          },
          { src: 'files/tests/**', dest: 'tests/', role: 'tests' },
          { src: 'files/run.sh', dest: 'scripts/run.sh', mode: '0755', when: "platform == 'web'" },
        ],
      }),
      'files/README.md.eta':
        '# <%= it.names.title %>\n\n<!-- <scaffold:cmds> -->\n<!-- </scaffold:cmds> -->\n',
      'files/config/checks.json': { profiles: { quick: ['bom'] } },
      'files/src/app.ts': "export const app = 'x';\n// <scaffold:routes>\n// </scaffold:routes>\n",
      'files/feature.ts.eta': "export const id = '<%= it.feature.id %>';\n",
      'files/tests/unit/a.test.ts': 'export const a = 1;\n',
      'files/run.sh': '#!/bin/sh\necho run\n',
    },
    'stack/node-web': {
      'pack.json': manifest('stack/node-web', "stack.pack == 'node-web'", {
        requires: ['base'],
        markerPatches: [
          { file: 'README.md', region: 'cmds', entries: [{ id: 'node', text: '1. pnpm install' }] },
          {
            file: 'src/app.ts',
            region: 'routes',
            entries: [
              { id: 'b', src: 'patches/route.eta' },
              { id: 'skip', text: 'x', when: 'false' },
            ],
          },
        ],
        jsonPatches: [
          {
            file: 'config/checks.json',
            ops: [{ op: 'append-unique', pointer: '/profiles/quick', value: ['lint'] }],
          },
        ],
      }),
      'patches/route.eta': '// <%= it.pack.id %> for <%= it.names.slug %>\n',
    },
    'deploy/vps-tailscale': {
      'pack.json': manifest('deploy/vps-tailscale', "deploy.target == 'vps-tailscale'"),
    },
    'test-home/in-repo': {
      'pack.json': manifest('test-home/in-repo', "testing.home == 'in-repo'"),
    },
    'test-home/paired-repo': {
      'pack.json': manifest('test-home/paired-repo', "testing.home == 'paired-repo'", {
        relocate: [{ role: 'tests', to: '@paired/' }],
        copy: [{ role: 'toolkit', to: '@paired/' }],
      }),
    },
    ...over,
  });
}

export function spec(draft: Record<string, unknown> = {}): IncubatorSpec {
  return completeSpec({
    project: { name: 'Stock Room', slug: 'stockroom', description: 'Stock tracking.' },
    intent: {
      personas: ['owner'],
      coreFeatures: [{ id: 'inventory', summary: 'Track stock', lane: 'enhancement/new' }],
    },
    platform: 'web',
    stack: { pack: 'node-web' },
    ...draft,
  }).spec;
}
