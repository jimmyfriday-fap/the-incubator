// Scaffold marker grammar shared by the renderer and generated scaffolders (ADR-005).
// A marker line's trimmed content is exactly `<c> <scaffold:name>` / `<c> </scaffold:name>`
// where <c> is `//`, `#`, or an HTML comment wrapper.
const MARKER = /^(?:\/\/|#|<!--)\s*<(\/?)scaffold:([a-z0-9-]+)>\s*(?:-->)?$/;

export function parseMarkerLine(line) {
  const m = MARKER.exec(line.trim());
  return m ? { close: m[1] === '/', name: m[2] } : null;
}

/** Returns { regions: Map<name,{open,close}>, errors[] } for one file's text. */
export function scanMarkers(text) {
  const regions = new Map();
  const errors = [];
  let open = null;
  text.split('\n').forEach((line, i) => {
    const m = parseMarkerLine(line);
    if (!m) return;
    if (!m.close) {
      if (open) errors.push(`line ${i + 1}: region "${m.name}" opens inside "${open.name}"`);
      else if (regions.has(m.name)) errors.push(`line ${i + 1}: duplicate region "${m.name}"`);
      else open = { name: m.name, open: i };
    } else if (!open || open.name !== m.name) {
      errors.push(`line ${i + 1}: close of "${m.name}" without matching open`);
    } else {
      regions.set(m.name, { open: open.open, close: i });
      open = null;
    }
  });
  if (open) errors.push(`region "${open.name}" is never closed`);
  return { regions, errors };
}

/** Inner text of a region (between marker lines), or null. */
export function regionBody(text, name) {
  const { regions } = scanMarkers(text);
  const r = regions.get(name);
  if (!r) return null;
  return text
    .split('\n')
    .slice(r.open + 1, r.close)
    .join('\n');
}

export function commentPrefix(file) {
  if (/\.(md|html|xml|mdc)$/i.test(file)) return '<!--';
  if (
    /\.(ya?ml|py|toml|sh|ini|cfg|env|gitignore|gitattributes|dockerignore)$|(^|\/)(Dockerfile|\.gitignore|\.gitattributes|\.env[^/]*|\.dockerignore|\.editorconfig)$/i.test(
      file,
    )
  )
    return '#';
  return '//';
}

/**
 * Replaces a region's body with the id-sorted union of its existing entries and `entries`
 * ({ id, text }). Each entry starts with a `<c> @id` line, so re-applying is a no-op.
 * Mirrors packages/templates/src/markers.ts (parity-tested).
 */
export function applyMarkerPatch(file, text, region, entries) {
  const { regions, errors } = scanMarkers(text);
  if (errors.length) throw new Error(`${file}: malformed scaffold markers: ${errors.join('; ')}`);
  const r = regions.get(region);
  if (!r) throw new Error(`${file}: no scaffold region "${region}"`);
  const lines = text.split('\n');
  const openLine = lines[r.open];
  const indent = openLine.slice(0, openLine.length - openLine.trimStart().length);
  const c = commentPrefix(file);
  const idLine = (id) => (c === '<!--' ? `${indent}<!-- @${id} -->` : `${indent}${c} @${id}`);
  const idRe =
    c === '<!--'
      ? /^\s*<!-- @([a-z0-9.-]+) -->$/
      : new RegExp(`^\\s*${c === '//' ? '\\/\\/' : '#'} @([a-z0-9.-]+)$`);
  const existing = new Map();
  let current = null;
  for (const line of lines.slice(r.open + 1, r.close)) {
    const m = idRe.exec(line);
    if (m) {
      current = m[1];
      existing.set(current, []);
    } else if (current) existing.get(current).push(line);
    else if (line.trim() !== '')
      throw new Error(`${file}: region "${region}" has content outside an @id entry`);
  }
  for (const e of entries) existing.set(e.id, e.text.replace(/\n+$/, '').split('\n'));
  const body = [...existing.keys()].sort().flatMap((id) => [idLine(id), ...existing.get(id)]);
  return [...lines.slice(0, r.open + 1), ...body, ...lines.slice(r.close)].join('\n');
}
