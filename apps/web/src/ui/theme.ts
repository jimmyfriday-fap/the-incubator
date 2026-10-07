/** The light or dark choice (plan 030): the computer's setting unless the owner picks one, kept in this browser. */
export type Theme = 'system' | 'light' | 'dark';

// why: a cookie, not local storage. Every launch listens on a new random port, and local storage is kept per
// origin (port included), so it would forget the choice on the next launch; cookies are kept per host.
const COOKIE = 'incubator_theme';

/** What a stored value means; anything unknown is the computer's setting. */
export function parseTheme(raw: string | null | undefined): Theme {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** The choice in a `document.cookie` string. */
export function themeFromCookie(cookie: string): Theme {
  const pair = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  return parseTheme(pair?.slice(COOKIE.length + 1));
}

/** The order the top-bar button cycles through. */
export function nextTheme(t: Theme): Theme {
  return t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system';
}

/** How the button names a choice. */
export const THEME_LABEL: Record<Theme, string> = {
  system: 'same as the computer',
  light: 'light',
  dark: 'dark',
};

/** The stored choice; the computer's setting when nothing is stored or cookies are blocked. */
export function readTheme(): Theme {
  try {
    return themeFromCookie(document.cookie);
  } catch {
    return 'system';
  }
}

/** Shows a choice and remembers it in this browser (a choice still applies when cookies are blocked). */
export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  try {
    document.cookie =
      t === 'system'
        ? `${COOKIE}=; Path=/; Max-Age=0; SameSite=Strict`
        : `${COOKIE}=${t}; Path=/; Max-Age=31536000; SameSite=Strict`;
  } catch {
    // why: blocked site data can refuse the cookie; the choice then lasts until the page closes.
  }
}
