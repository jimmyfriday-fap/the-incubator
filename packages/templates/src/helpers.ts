/** Pure helpers exposed to templates as `it.h` (no clock, no I/O, no randomness). */

const words = (s: string): string[] =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

export const pascal = (s: string): string =>
  words(s)
    .map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase())
    .join('') || 'Project';
export const camel = (s: string): string => {
  const p = pascal(s);
  return p[0]!.toLowerCase() + p.slice(1);
};
export const snake = (s: string): string =>
  words(s)
    .map((w) => w.toLowerCase())
    .join('_') || 'project';
export const kebab = (s: string): string =>
  words(s)
    .map((w) => w.toLowerCase())
    .join('-') || 'project';
export const upperSnake = (s: string): string => snake(s).toUpperCase();
export const title = (s: string): string =>
  words(s)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');

/** Strips control and bidi characters and caps length: free text from users or models (threat T6). */
export function safeText(s: string, max = 500): string {
  return (
    s
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max)
  );
}

export const json = (v: unknown, indent = 2): string => JSON.stringify(v, null, indent);
/** A YAML double-quoted scalar (JSON strings are valid YAML). */
export const yamlStr = (s: string): string => JSON.stringify(s);
/** A PHP single-quoted string literal. */
export const phpStr = (s: string): string => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
export const pyStr = (s: string): string => JSON.stringify(s);
export const indent = (text: string, n: number): string =>
  text
    .split('\n')
    .map((l) => (l ? ' '.repeat(n) + l : l))
    .join('\n');
export function sortBy<T>(items: readonly T[], key: keyof T): T[] {
  return [...items].sort((a, b) =>
    String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0,
  );
}

export function makeHelpers(actionsLock: Record<string, { tag: string; sha: string }>) {
  return Object.freeze({
    pascal,
    camel,
    snake,
    kebab,
    upperSnake,
    title,
    safeText,
    json,
    yamlStr,
    phpStr,
    pyStr,
    indent,
    sortBy,
    /** `owner/repo@<sha> # <tag>` for a SHA-pinned `uses:` line. */
    action(name: string): string {
      const e = actionsLock[name];
      if (!e) throw new Error(`action ${name} is not in actions-lock.json`);
      return `${name}@${e.sha} # ${e.tag}`;
    },
  });
}
export type Helpers = ReturnType<typeof makeHelpers>;
