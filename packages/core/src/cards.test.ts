import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STACK_CATALOG,
  builtFeatures,
  completeSpec,
  hasMvpCut,
  laterFeatures,
} from '@incubator/spec';
import { render } from '@incubator/templates';
import {
  BACKSHACK_REFERENCE_TOOLS,
  CARD_MAX_LINES,
  GENERATED_CARD_FILE,
  GENERATED_CARD_MAX_BYTES,
  buildBackshackCard,
  loadStackCard,
  phpSignatures,
  readGeneratedCard,
  writeGeneratedCard,
} from './cards.js';
import { handoffPrompt } from './handoff.js';
import { readTickets, whatNow } from './what-now.js';

describe('the MVP cut', () => {
  const f = (id: string, mvp?: boolean) => ({ id, mvp });
  it('builds every feature until one is marked, then only the marked ones', () => {
    const none = [f('a'), f('b')];
    expect(hasMvpCut(none)).toBe(false);
    expect(builtFeatures(none).map((x) => x.id)).toEqual(['a', 'b']);
    expect(laterFeatures(none)).toEqual([]);
    const cut = [f('a', true), f('b'), f('c', false), f('d', true)];
    expect(hasMvpCut(cut)).toBe(true);
    expect(builtFeatures(cut).map((x) => x.id)).toEqual(['a', 'd']);
    expect(laterFeatures(cut).map((x) => x.id)).toEqual(['b', 'c']);
    // `mvp: false` on every feature draws no line: everything is built, as before the flag.
    expect(builtFeatures([f('a', false), f('b', false)])).toHaveLength(2);
  });

  it('renders only the MVP features as bootstrap steps, and lists the rest as later with their own tickets', async () => {
    const spec = completeSpec({
      project: { name: 'Tallyho', slug: 'tallyho' },
      intent: {
        narrative: 'A tally service',
        personas: [],
        coreFeatures: [
          { id: 'tally', summary: 'Count things', lane: 'enhancement/new', mvp: true },
          { id: 'export-csv', summary: 'Export to CSV', lane: 'enhancement/new' },
        ],
      },
    }).spec;
    const files = await render(spec);
    const text = (p: string): string => {
      const file = [...files.files.values()].find((x) => x.path === p);
      expect(file, p).toBeDefined();
      return file!.bytes.toString('utf8');
    };
    const plan = text('docs/plans/000-bootstrap.md');
    expect(plan).toContain('**Step 1:** Count things (`tally`');
    expect(plan).not.toContain('**Step 2:**');
    expect(plan).toContain('## Later (not built in this run)');
    expect(plan).toContain('- Export to CSV (`export-csv`)');
    // The later feature keeps its ticket (marked), so a later run can build it.
    const later = JSON.parse(text('.incubator/tickets/F-export-csv.json')) as Record<
      string,
      unknown
    >;
    expect(later).toMatchObject({ id: 'F-export-csv', state: 'TAGGED_TO_RELEASE', later: true });
    const mvp = JSON.parse(text('.incubator/tickets/F-tally.json')) as Record<string, unknown>;
    expect(mvp['later']).toBeUndefined();
  });

  it('keeps the later tickets out of the what-now counts and names them', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'later-tickets '));
    try {
      const t = path.join(dir, '.incubator', 'tickets');
      mkdirSync(t, { recursive: true });
      writeFileSync(
        path.join(t, 'F-a.json'),
        JSON.stringify({ id: 'F-a', title: 'A', state: 'READY_FOR_TEST' }),
      );
      writeFileSync(
        path.join(t, 'F-b.json'),
        JSON.stringify({ id: 'F-b', title: 'B', state: 'TAGGED_TO_RELEASE', later: true }),
      );
      const tickets = readTickets(dir);
      expect(tickets.map((x) => [x.id, x.later === true])).toEqual([
        ['F-a', false],
        ['F-b', true],
      ]);
      const guide = whatNow({
        runId: 'r',
        name: 'T',
        slug: 't',
        description: 'd',
        platform: 'service',
        pack: 'node-web',
        deployTarget: 'none',
        gettingStarted: [],
        tickets,
        verdict: 'ready',
        setup: null,
        pr: null,
        warnings: [],
        branch: null,
      } as never);
      const status = guide.status.join(' ');
      expect(status).toContain('1 of 1 features are ready for test.');
      expect(status).toContain('1 feature is left for later');
      expect(status).toContain('F-b');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('build cards', () => {
  it('has a static card of at most 60 lines for every stack that names one, and none for a missing name', () => {
    const named = STACK_CATALOG.filter((s) => s.card && s.card !== 'generated');
    expect(named.map((s) => s.id).sort()).toEqual([
      'node-lib',
      'node-web',
      'python-service',
      'wordpress',
    ]);
    for (const s of named) {
      const card = loadStackCard(s.card);
      expect(card, s.id).not.toBeNull();
      expect(card!.split('\n').length).toBeLessThanOrEqual(CARD_MAX_LINES);
      expect(card).toContain('node scripts/scaffold.mjs feature <id>');
    }
    expect(loadStackCard(undefined)).toBeNull();
    expect(loadStackCard('generated')).toBeNull();
    expect(loadStackCard('../handoff')).toBeNull();
    expect(loadStackCard('nope')).toBeNull();
    expect(STACK_CATALOG.find((s) => s.id === 'backshack-tool')?.card).toBe('generated');
  });

  it('inlines a card in the coding prompt, after the plan and before the contract', () => {
    const p = handoffPrompt('# Plan\n\n**Step 1:** x', undefined, undefined, 'Build card: x\n- a');
    expect(p).toContain('\n## Build card\n\nBuild card: x\n- a\n');
    expect(p.indexOf('# Plan')).toBeLessThan(p.indexOf('## Build card'));
    expect(handoffPrompt('# Plan', undefined, undefined, null)).not.toContain('Build card');
    const b = handoffPrompt('# Plan', { checks: [] }, { contract: 'CONTRACT' }, 'CARD');
    expect(b.indexOf('## Build card')).toBeLessThan(b.indexOf('CONTRACT'));
  });

  it('reads public PHP signatures only', () => {
    const php = [
      '<?php',
      'final class Demo {',
      '  public static function make(string $a, ?int $b = null): self {}',
      '  private function hidden(): void {}',
      '  public function run(array $x,',
      '      int $y): array {}',
      '  protected function guarded() {}',
      '}',
    ].join('\n');
    expect(phpSignatures(php)).toEqual([
      'static make(string $a, ?int $b = null): self',
      'run(array $x, int $y): array',
    ]);
  });

  const worktree = (): string => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'card-wt '));
    const tools = path.join(dir, 'wp-content', 'plugins', 'backshack-datalake', 'src', 'Tools');
    mkdirSync(path.join(tools, 'Support'), { recursive: true });
    mkdirSync(path.join(tools, BACKSHACK_REFERENCE_TOOLS[0]), { recursive: true });
    writeFileSync(
      path.join(tools, BACKSHACK_REFERENCE_TOOLS[0], 'FILE_INVENTORY.md'),
      `# Inventory\n${'x'.repeat(9000)}\n`,
    );
    for (let i = 0; i < 40; i++)
      writeFileSync(
        path.join(tools, 'Support', `Class${String(i).padStart(2, '0')}.php`),
        `<?php\nclass Class${i} {\n${Array.from({ length: 12 }, (_, k) => `  public function method${k}(string $argument${k}, int $other${k}): array {}`).join('\n')}\n}\n`,
      );
    writeFileSync(
      path.join(tools, 'Support', 'ActionRequest.php'),
      '<?php\nfinal class ActionRequest {\n  public static function from(array $post): self {}\n}\n',
    );
    return dir;
  };

  it('builds the Backshack card from the worktree: a reference inventory, then Support signatures, within 6 KB', () => {
    const dir = worktree();
    try {
      const card = buildBackshackCard(dir, 'order-export')!;
      expect(card).toContain('Build card: a Backshack tool (`order-export`)');
      expect(card).toContain(`## Reference tool: ${BACKSHACK_REFERENCE_TOOLS[0]}`);
      // The classes a tool uses most come first.
      expect(card).toContain('- ActionRequest: static from(array $post): self');
      expect(card.indexOf('ActionRequest')).toBeLessThan(card.indexOf('Class00'));
      expect(Buffer.byteLength(card, 'utf8')).toBeLessThanOrEqual(GENERATED_CARD_MAX_BYTES);
      // Deterministic: the same worktree gives the same card.
      expect(buildBackshackCard(dir, 'order-export')).toBe(card);
      expect(writeGeneratedCard(dir, 'order-export')).toBe(true);
      expect(readFileSync(path.join(dir, ...GENERATED_CARD_FILE.split('/')), 'utf8')).toBe(
        `${card}\n`,
      );
      expect(readGeneratedCard(dir)).toBe(card);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes no card when the worktree has no reference tool', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'card-empty '));
    try {
      expect(buildBackshackCard(dir, 'x')).toBeNull();
      expect(writeGeneratedCard(dir, 'x')).toBe(false);
      expect(existsSync(path.join(dir, '.incubator'))).toBe(false);
      expect(readGeneratedCard(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
