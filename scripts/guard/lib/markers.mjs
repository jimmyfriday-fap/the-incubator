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
