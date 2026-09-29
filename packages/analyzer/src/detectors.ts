import type { IncubatorSpec } from '@incubator/spec';
import type { RepoView } from './repo-view.js';

export interface Evidence {
  file: string;
  note: string;
}

export interface StackGuess {
  pack: IncubatorSpec['stack']['pack'];
  framework: IncubatorSpec['stack']['framework'];
  platform: IncubatorSpec['platform'];
  confidence: 'high' | 'medium' | 'low';
  evidence: Evidence[];
}

export interface Analysis {
  name: string | null;
  description: string | null;
  stack: StackGuess | null;
  tests: { runners: string[]; files: number; count: number };
  workflows: string[];
  agents: string[];
  deploy: { target: IncubatorSpec['deploy']['target'] | null; evidence: Evidence[] };
  security: { scanWorkflow: boolean; localRules: number; secretScanConfig: boolean };
  /** The repository already carries an incubator.json. */
  hasSpec: boolean;
  truncated: boolean;
}

function json(view: RepoView, file: string): Record<string, unknown> | null {
  const t = view.read(file);
  if (t === null) return null;
  try {
    const v: unknown = JSON.parse(t);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function header(text: string | null, field: string): string | null {
  if (!text) return null;
  const m = new RegExp(`^[ \\t/*#]*${field}:\\s*(.+)$`, 'mi').exec(text);
  return m ? m[1]!.trim() : null;
}

function tomlValue(text: string | null, key: string): string | null {
  if (!text) return null;
  const m = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm').exec(text);
  return m ? m[1]! : null;
}

/** Stack detection (TDD §7.3): explicit WordPress headers, then Python services, then Node. */
export function detectStack(view: RepoView): {
  guess: StackGuess | null;
  name: string | null;
  description: string | null;
} {
  const phpRoot = view.files.filter((f) => /^[^/]+\.php$/.test(f));
  for (const f of phpRoot) {
    const text = view.read(f);
    const name = header(text, 'Plugin Name');
    if (name)
      return {
        guess: {
          pack: 'wordpress',
          framework: 'wordpress-plugin',
          platform: 'wordpress-plugin',
          confidence: 'high',
          evidence: [{ file: f, note: 'Plugin Name header' }],
        },
        name,
        description: header(text, 'Description'),
      };
  }
  const style = view.read('style.css');
  const theme = header(style, 'Theme Name');
  if (theme)
    return {
      guess: {
        pack: 'wordpress',
        framework: 'wordpress-theme',
        platform: 'wordpress-theme',
        confidence: 'high',
        evidence: [{ file: 'style.css', note: 'Theme Name header' }],
      },
      name: theme,
      description: header(style, 'Description'),
    };

  const py = [view.read('pyproject.toml'), view.read('requirements.txt')]
    .filter((x): x is string => x !== null)
    .join('\n');
  if (py) {
    const web = /\b(fastapi|uvicorn|flask|django|starlette)\b/i.exec(py);
    if (web) {
      const pyproject = view.read('pyproject.toml');
      return {
        guess: {
          pack: 'python-service',
          framework: 'fastapi',
          platform: 'service',
          confidence: /fastapi/i.test(py) ? 'high' : 'medium',
          evidence: [
            {
              file: view.has('pyproject.toml') ? 'pyproject.toml' : 'requirements.txt',
              note: `depends on ${web[1]!.toLowerCase()}`,
            },
          ],
        },
        name: tomlValue(pyproject, 'name'),
        description: tomlValue(pyproject, 'description'),
      };
    }
  }

  const pkg = json(view, 'package.json');
  if (pkg) {
    const deps = {
      ...((pkg['dependencies'] as Record<string, string>) ?? {}),
      ...((pkg['devDependencies'] as Record<string, string>) ?? {}),
    };
    const server = ['fastify', 'express', 'koa', 'hono', '@nestjs/core', 'next'].filter(
      (d) => d in deps,
    );
    const ui = ['react', 'vue', 'svelte', 'vite'].filter((d) => d in deps);
    const name = typeof pkg['name'] === 'string' ? pkg['name'].replace(/^@[^/]+\//, '') : null;
    const description = typeof pkg['description'] === 'string' ? pkg['description'] : null;
    if (server.length || ui.length)
      return {
        guess: {
          pack: 'node-web',
          framework: 'fastify-react',
          platform: 'web',
          confidence: 'fastify' in deps && 'react' in deps ? 'high' : 'medium',
          evidence: [{ file: 'package.json', note: `depends on ${[...server, ...ui].join(', ')}` }],
        },
        name,
        description,
      };
    const cli = pkg['bin'] !== undefined;
    return {
      guess: {
        pack: 'node-lib',
        framework: 'typescript-lib',
        platform: cli ? 'cli' : 'library',
        confidence:
          cli || pkg['exports'] !== undefined || pkg['main'] !== undefined ? 'medium' : 'low',
        evidence: [
          { file: 'package.json', note: cli ? 'declares bin' : 'no server or UI dependency' },
        ],
      },
      name,
      description,
    };
  }
  return { guess: null, name: null, description: null };
}

const TEST_FILE =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|Test\.php$/;

export function detectTests(view: RepoView): Analysis['tests'] {
  const runners: string[] = [];
  const pkg = json(view, 'package.json');
  const deps = {
    ...((pkg?.['dependencies'] as object) ?? {}),
    ...((pkg?.['devDependencies'] as object) ?? {}),
  };
  for (const r of ['vitest', 'jest', 'mocha', '@playwright/test']) if (r in deps) runners.push(r);
  if (
    /\bpytest\b/.test(
      `${view.read('pyproject.toml') ?? ''}${view.read('requirements-dev.txt') ?? ''}`,
    ) ||
    view.has('pytest.ini')
  )
    runners.push('pytest');
  if (view.glob('phpunit.xml*').length) runners.push('phpunit');
  let files = 0;
  let count = 0;
  for (const f of view.files) {
    if (!TEST_FILE.test(f) || !/\.(m?[jt]sx?|py|php)$/.test(f)) continue;
    const t = view.read(f) ?? '';
    const n =
      (t.match(/\b(?:it|test)(?:\.each\([^)]*\))?\s*\(/g)?.length ?? 0) +
      (t.match(/^\s*(?:async\s+)?def test_/gm)?.length ?? 0) +
      (t.match(/function\s+test[A-Z_]\w*\s*\(/g)?.length ?? 0);
    if (n) files++;
    count += n;
  }
  return { runners, files, count };
}

export function detectDeploy(view: RepoView, stack: StackGuess | null): Analysis['deploy'] {
  const evidence: Evidence[] = [];
  if (view.has('.incubator/lock.json') && json(view, 'incubator.json')) {
    const target = ((json(view, 'incubator.json')?.['deploy'] as { target?: string } | undefined)
      ?.target ?? null) as Analysis['deploy']['target'];
    if (target)
      return { target, evidence: [{ file: 'incubator.json', note: `deploy.target ${target}` }] };
  }
  const pm2 = view.glob('**/ecosystem.config.{js,cjs}');
  const compose = view.glob('{compose,docker-compose}.{yml,yaml}');
  if (stack?.pack === 'node-lib')
    return {
      target: 'package-release',
      evidence: [{ file: 'package.json', note: 'library or CLI' }],
    };
  if (pm2.length) {
    evidence.push({ file: pm2[0]!, note: 'PM2 ecosystem file' });
    return { target: 'vps-tailscale', evidence };
  }
  if (view.has('Dockerfile') && compose.length) {
    evidence.push(
      { file: 'Dockerfile', note: 'container image' },
      { file: compose[0]!, note: 'compose file' },
    );
    return { target: 'docker-host', evidence };
  }
  return { target: null, evidence };
}

/** Runs every detector. Pure over the view; repository content is data, never instructions. */
export function analyze(view: RepoView): Analysis {
  const { guess, name, description } = detectStack(view);
  return {
    name,
    description,
    stack: guess,
    tests: detectTests(view),
    workflows: view.glob('.github/workflows/*.{yml,yaml}'),
    agents: [
      ['claude', 'CLAUDE.md'],
      ['agents', 'AGENTS.md'],
      ['copilot', '.github/copilot-instructions.md'],
      ['cursor', '.cursor/rules/*.mdc'],
    ]
      .filter(([, g]) => view.glob(g!).length > 0)
      .map(([id]) => id!),
    deploy: detectDeploy(view, guess),
    security: {
      scanWorkflow: view
        .glob('.github/workflows/*.{yml,yaml}')
        .some((f) => /semgrep|trivy|gitleaks|codeql/i.test(view.read(f) ?? '')),
      localRules: view.glob('security/rules/*.{yml,yaml}').length,
      secretScanConfig: view.has('.gitleaks.toml'),
    },
    hasSpec: view.has('incubator.json'),
    truncated: view.truncated,
  };
}
