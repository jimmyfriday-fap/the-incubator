import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** The built UI (`vite build` output), next to the package's dist/ whether running from src or dist. */
export function defaultUiDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'ui');
}

/**
 * Resolves a request path inside the UI directory, or null. Paths are URL-decoded, normalized and must
 * stay under the root (threat T5); anything else falls back to index.html for client-side routes.
 */
export function resolveAsset(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]!);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const abs = path.resolve(root, `.${path.posix.normalize(`/${decoded}`)}`);
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return existsSync(abs) && statSync(abs).isFile() ? abs : null;
}

export function readAsset(root: string, urlPath: string): { type: string; body: Buffer } | null {
  const index = path.join(root, 'index.html');
  const asset = resolveAsset(root, urlPath);
  // why: a missing asset is a 404; only extension-less client routes fall back to the app shell.
  if (!asset && path.posix.extname(urlPath.split('?')[0]!)) return null;
  const file = asset ?? (existsSync(index) ? index : null);
  if (!file) return null;
  return {
    type: TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    body: readFileSync(file),
  };
}

/**
 * The app shell with the owner's light or dark choice already on `<html>` (plan 033), so a dark choice is dark from
 * the first paint. `choice` is the `incubator_theme` cookie; anything but `light` or `dark` leaves the page as is.
 */
export function stampTheme(html: string, choice: string | undefined): string {
  return choice === 'light' || choice === 'dark'
    ? html.replace('<html lang="en">', `<html lang="en" data-theme="${choice}">`)
    : html;
}
