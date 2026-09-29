import { describe, expect, it } from 'vitest';
import * as guard from '../../../scripts/guard/lib/markers.mjs';
import { applyMarkerPatch, commentPrefix, scanMarkers } from './markers.js';

const TS = [
  "import a from './a.js';",
  '// <scaffold:imports>',
  '// @beta',
  "import { beta } from './beta.js';",
  '// </scaffold:imports>',
  '',
  'export function routes() {',
  '  // <scaffold:routes>',
  '  // </scaffold:routes>',
  '}',
].join('\n');

describe('scaffold markers', () => {
  it('scans regions and reports malformed ones', () => {
    expect([...scanMarkers(TS).regions.keys()]).toEqual(['imports', 'routes']);
    expect(scanMarkers('// <scaffold:a>\n// <scaffold:b>\n// </scaffold:b>').errors).toEqual([
      'line 2: region "b" opens inside "a"',
      'line 3: close of "b" without matching open',
      'region "a" is never closed',
    ]);
    expect(
      scanMarkers('# <scaffold:a>\n# </scaffold:a>\n# <scaffold:a>\n# </scaffold:a>').errors,
    ).toEqual(['line 3: duplicate region "a"', 'line 4: close of "a" without matching open']);
  });

  it('picks the comment syntax from the file name', () => {
    expect(commentPrefix('src/app.ts')).toBe('//');
    expect(commentPrefix('src/Plugin.php')).toBe('//');
    expect(commentPrefix('app/main.py')).toBe('#');
    expect(commentPrefix('.github/workflows/ci.yml')).toBe('#');
    expect(commentPrefix('Dockerfile')).toBe('#');
    expect(commentPrefix('.env.example')).toBe('#');
    expect(commentPrefix('README.md')).toBe('<!--');
    expect(commentPrefix('.cursor/rules/x.mdc')).toBe('<!--');
  });

  it('inserts entries sorted by id, keeps indentation and is idempotent', () => {
    const once = applyMarkerPatch('app.ts', TS, 'imports', [
      { id: 'alpha', text: "import { alpha } from './alpha.js';\n" },
    ]);
    expect(once.split('\n').slice(2, 8)).toEqual([
      '// @alpha',
      "import { alpha } from './alpha.js';",
      '// @beta',
      "import { beta } from './beta.js';",
      '// </scaffold:imports>',
      '',
    ]);
    const routes = applyMarkerPatch('app.ts', once, 'routes', [
      { id: 'alpha', text: '  alpha(app);' },
    ]);
    expect(routes).toContain(
      '  // <scaffold:routes>\n  // @alpha\n  alpha(app);\n  // </scaffold:routes>',
    );
    expect(
      applyMarkerPatch('app.ts', routes, 'routes', [{ id: 'alpha', text: '  alpha(app);' }]),
    ).toBe(routes);
  });

  it('uses HTML comments in markdown and # in YAML', () => {
    const md = applyMarkerPatch(
      'README.md',
      '<!-- <scaffold:cmds> -->\n<!-- </scaffold:cmds> -->\n',
      'cmds',
      [{ id: 'node', text: '1. pnpm install' }],
    );
    expect(md).toBe(
      '<!-- <scaffold:cmds> -->\n<!-- @node -->\n1. pnpm install\n<!-- </scaffold:cmds> -->\n',
    );
    const yml = applyMarkerPatch(
      'ci.yml',
      'jobs:\n  # <scaffold:jobs>\n  # </scaffold:jobs>\n',
      'jobs',
      [{ id: 'check', text: '  check:\n    runs-on: ubuntu-latest' }],
    );
    expect(yml).toBe(
      'jobs:\n  # <scaffold:jobs>\n  # @check\n  check:\n    runs-on: ubuntu-latest\n  # </scaffold:jobs>\n',
    );
  });

  it('refuses missing regions, malformed markers and stray content', () => {
    expect(() => applyMarkerPatch('a.ts', TS, 'nope', [])).toThrow('no scaffold region "nope"');
    expect(() => applyMarkerPatch('a.ts', '// <scaffold:x>\n', 'x', [])).toThrow(
      'malformed scaffold markers',
    );
    expect(() =>
      applyMarkerPatch('a.ts', '// <scaffold:x>\nstray();\n// </scaffold:x>', 'x', []),
    ).toThrow('content outside an @id entry');
  });

  it('matches the guard toolkit implementation byte for byte (renderer/scaffolder parity)', () => {
    const cases: [string, string, string, { id: string; text: string }[]][] = [
      ['app.ts', TS, 'imports', [{ id: 'gamma', text: "import { gamma } from './gamma.js';" }]],
      [
        'app.ts',
        TS,
        'routes',
        [
          { id: 'b', text: '  b(app);' },
          { id: 'a', text: '  a(app);\n\n' },
        ],
      ],
      [
        'README.md',
        '<!-- <scaffold:r> -->\n<!-- @z -->\nzed\n<!-- </scaffold:r> -->',
        'r',
        [{ id: 'a', text: 'ay' }],
      ],
      ['svc.py', '    # <scaffold:r>\n    # </scaffold:r>', 'r', [{ id: 'x', text: '    x()' }]],
    ];
    for (const [file, text, region, entries] of cases) {
      expect(guard.applyMarkerPatch(file, text, region, entries)).toBe(
        applyMarkerPatch(file, text, region, entries),
      );
      expect(guard.scanMarkers(text).errors).toEqual(scanMarkers(text).errors);
    }
    for (const f of ['a.ts', 'b.py', 'c.md', 'Dockerfile', '.gitignore', 'x.php', 'y.toml'])
      expect(guard.commentPrefix(f)).toBe(commentPrefix(f));
    expect(() => guard.applyMarkerPatch('a.ts', TS, 'nope', [])).toThrow(
      'no scaffold region "nope"',
    );
  });
});
