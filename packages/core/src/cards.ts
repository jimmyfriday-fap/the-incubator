import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Build cards: a short file inlined in the coding prompt that tells the agent where one feature's files go, the one
 * command or reference for each, and what not to read, so it does not search the repository to find out.
 * A stack names its card in the catalog (`StackEntry.card`): a file under `prompts/cards/` for a canonical pack, or
 * `generated` for a workspace stack, whose card is written into the worktree at approval (`buildBackshackCard`).
 */

/** A card is at most this many lines (a static one) or bytes (a generated one). */
export const CARD_MAX_LINES = 60;
export const GENERATED_CARD_MAX_BYTES = 6144;

/** Where a generated card is written: inside the run's guides, which git never sees. */
export const GENERATED_CARD_FILE = '.incubator/card.md';

/** The static card named `name`, or null when there is none (an unknown name never throws: no card is no card). */
export function loadStackCard(name: string | undefined): string | null {
  if (!name || !/^[a-z][a-z0-9-]*$/.test(name) || name === 'generated') return null;
  const file = new URL(`../prompts/cards/${name}.md`, import.meta.url);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

/** The card written into a worktree (see `writeGeneratedCard`), or null. */
export function readGeneratedCard(repo: string): string | null {
  const file = path.join(repo, ...GENERATED_CARD_FILE.split('/'));
  if (!existsSync(file)) return null;
  const text = readFileSync(file, 'utf8').trim();
  return text || null;
}

const PLUGIN = 'wp-content/plugins/backshack-datalake/src/Tools';
/** Tried in order: the first one present in the worktree is the contract-conforming reference tool. */
export const BACKSHACK_REFERENCE_TOOLS = ['pressure-test', 'searchlight', 'surveyor'] as const;
/** The Support classes a tool's code uses most, first; the rest follow in name order while room is left. */
const SUPPORT_FIRST = [
  'ActionRequest',
  'ActionResult',
  'GroupRequirement',
  'AiJsonCall',
  'AiPromptRunner',
  'TextInput',
  'ProductContext',
  'ToolAssetPaths',
  'ToolRegistry',
];

/** The public function signatures of one PHP file, one per line, in file order. */
export function phpSignatures(source: string): string[] {
  const out: string[] = [];
  const re = /^\s*public\s+(static\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*([\w\\?|]+))?/gm;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    const params = m[3]!.replace(/\s+/g, ' ').trim();
    out.push(`${m[1] ? 'static ' : ''}${m[2]}(${params})${m[4] ? `: ${m[4]}` : ''}`);
  }
  return out;
}

/**
 * The card of a Backshack tool, from the worktree, with no model: the file inventory of one reference tool that
 * conforms to the contract, then the public signatures of the Support classes a tool calls, cut at
 * GENERATED_CARD_MAX_BYTES. Null when the worktree has none of the reference tools (nothing to point at).
 */
export function buildBackshackCard(worktree: string, slug: string): string | null {
  const tools = path.join(worktree, ...PLUGIN.split('/'));
  const reference = BACKSHACK_REFERENCE_TOOLS.find((t) =>
    existsSync(path.join(tools, t, 'FILE_INVENTORY.md')),
  );
  if (!reference) return null;
  const head = [
    `Build card: a Backshack tool (\`${slug}\`). Use it instead of searching the repository.`,
    '',
    `- Your tool's package is \`${PLUGIN.replace('wp-content/plugins/', '')}/${slug}/\` (under \`wp-content/plugins/\`), laid out like the reference tool \`${reference}\` below.`,
    "- Do not read other tools' packages. Read the reference tool's file named in its inventory only by range, only for the part you are writing.",
    '- The contract below wins over this card.',
    '',
    `## Reference tool: ${reference} (its FILE_INVENTORY.md, abridged)`,
    '',
  ].join('\n');
  const inventory = readFileSync(path.join(tools, reference, 'FILE_INVENTORY.md'), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 2600);
  const support = path.join(tools, 'Support');
  const names = existsSync(support)
    ? readdirSync(support)
        .filter((n) => n.endsWith('.php'))
        .map((n) => n.slice(0, -4))
    : [];
  const ordered = [
    ...SUPPORT_FIRST.filter((n) => names.includes(n)),
    ...names.filter((n) => !SUPPORT_FIRST.includes(n)).sort(),
  ];
  const lines: string[] = [];
  for (const name of ordered) {
    const sigs = phpSignatures(readFileSync(path.join(support, `${name}.php`), 'utf8'));
    if (sigs.length) lines.push(`${name}: ${sigs.join('; ')}`);
  }
  let card = `${head}${inventory}\n\n## Support classes (public signatures, \`src/Tools/Support/\`)\n\n`;
  for (const l of lines) {
    const next = `- ${l}\n`;
    if (Buffer.byteLength(card + next, 'utf8') > GENERATED_CARD_MAX_BYTES) break;
    card += next;
  }
  // A single line longer than the room left is cut, never the whole card.
  if (Buffer.byteLength(card, 'utf8') > GENERATED_CARD_MAX_BYTES)
    card = Buffer.from(card, 'utf8').subarray(0, GENERATED_CARD_MAX_BYTES).toString('utf8');
  return card.trimEnd();
}

/** Writes the card into the worktree's guides; returns whether one was written. */
export function writeGeneratedCard(worktree: string, slug: string): boolean {
  const card = buildBackshackCard(worktree, slug);
  if (!card) return false;
  const file = path.join(worktree, ...GENERATED_CARD_FILE.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${card}\n`);
  return true;
}
