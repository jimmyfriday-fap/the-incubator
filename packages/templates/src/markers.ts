import { ToolError } from '@incubator/runtime';

/** Marker grammar (ADR-005); must stay in lockstep with scripts/guard/lib/markers.mjs. */
const MARKER = /^(?:\/\/|#|<!--)\s*<(\/?)scaffold:([a-z0-9-]+)>\s*(?:-->)?$/;

export interface Region {
  open: number;
  close: number;
}

export function scanMarkers(text: string): { regions: Map<string, Region>; errors: string[] } {
  const regions = new Map<string, Region>();
  const errors: string[] = [];
  let open: { name: string; open: number } | null = null;
  text.split('\n').forEach((line, i) => {
    const m = MARKER.exec(line.trim());
    if (!m) return;
    const [, slash, name] = m as unknown as [string, string, string];
    if (!slash) {
      if (open) errors.push(`line ${i + 1}: region "${name}" opens inside "${open.name}"`);
      else if (regions.has(name)) errors.push(`line ${i + 1}: duplicate region "${name}"`);
      else open = { name, open: i };
    } else if (!open || open.name !== name) {
      errors.push(`line ${i + 1}: close of "${name}" without matching open`);
    } else {
      regions.set(name, { open: open.open, close: i });
      open = null;
    }
  });
  if (open !== null) errors.push(`region "${(open as { name: string }).name}" is never closed`);
  return { regions, errors };
}

export function commentPrefix(file: string): '//' | '#' | '<!--' {
  if (/\.(md|html|xml|mdc)$/i.test(file)) return '<!--';
  if (
    /\.(ya?ml|py|toml|sh|ini|cfg|env|gitignore|gitattributes|dockerignore)$|(^|\/)(Dockerfile|\.gitignore|\.gitattributes|\.env[^/]*|\.dockerignore|\.editorconfig)$/i.test(
      file,
    )
  )
    return '#';
  return '//';
}

export interface MarkerEntry {
  id: string;
  text: string;
}

/**
 * Replaces a region's body with the id-sorted union of its existing entries and `entries`.
 * Each entry is introduced by a `<c> @id` line, so applying the same patch twice is a no-op.
 */
export function applyMarkerPatch(
  file: string,
  text: string,
  region: string,
  entries: readonly MarkerEntry[],
): string {
  const { regions, errors } = scanMarkers(text);
  if (errors.length)
    throw new ToolError(`${file}: malformed scaffold markers: ${errors.join('; ')}`);
  const r = regions.get(region);
  if (!r) throw new ToolError(`${file}: no scaffold region "${region}"`);
  const lines = text.split('\n');
  const openLine = lines[r.open]!;
  const indent = openLine.slice(0, openLine.length - openLine.trimStart().length);
  const c = commentPrefix(file);
  const idLine = (id: string) =>
    c === '<!--' ? `${indent}<!-- @${id} -->` : `${indent}${c} @${id}`;
  const idRe =
    c === '<!--'
      ? /^\s*<!-- @([a-z0-9.-]+) -->$/
      : new RegExp(`^\\s*${c === '//' ? '\\/\\/' : '#'} @([a-z0-9.-]+)$`);
  const existing = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of lines.slice(r.open + 1, r.close)) {
    const m = idRe.exec(line);
    if (m) {
      current = m[1]!;
      existing.set(current, []);
    } else if (current) existing.get(current)!.push(line);
    else if (line.trim() !== '')
      throw new ToolError(`${file}: region "${region}" has content outside an @id entry`);
  }
  for (const e of entries) existing.set(e.id, e.text.replace(/\n+$/, '').split('\n'));
  const body = [...existing.keys()].sort().flatMap((id) => [idLine(id), ...existing.get(id)!]);
  return [...lines.slice(0, r.open + 1), ...body, ...lines.slice(r.close)].join('\n');
}
