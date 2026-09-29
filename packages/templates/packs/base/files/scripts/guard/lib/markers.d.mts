export interface Region {
  open: number;
  close: number;
}
export function parseMarkerLine(line: string): { close: boolean; name: string } | null;
export function scanMarkers(text: string): { regions: Map<string, Region>; errors: string[] };
export function regionBody(text: string, name: string): string | null;
export function commentPrefix(file: string): '//' | '#' | '<!--';
export function applyMarkerPatch(
  file: string,
  text: string,
  region: string,
  entries: readonly { id: string; text: string }[],
): string;
