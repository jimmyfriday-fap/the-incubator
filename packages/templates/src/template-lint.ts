/**
 * Restricted-template lint (ADR-003): template code may only read `it.*` and use plain language
 * constructs. Anything that could observe time, randomness, the environment or I/O is rejected.
 */
const BANNED =
  /(?<![.\w$])(Date|Math|process|globalThis|global|window|require|import|fetch|crypto|setTimeout|setInterval|setImmediate|queueMicrotask|eval|Function|Buffer|console|Intl|performance|Reflect|Proxy|this)(?![\w$])|\b(constructor|__proto__|prototype)\b/;

export function lintTemplate(file: string, source: string): string[] {
  const issues: string[] = [];
  for (const m of source.matchAll(/<%[-=~_]?([\s\S]*?)[-_]?%>/g)) {
    const code = m[1] ?? '';
    const bad = BANNED.exec(
      code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''"),
    );
    if (bad) {
      const line = source.slice(0, m.index).split('\n').length;
      issues.push(`${file}:${line}: "${bad[0]}" is not allowed in templates`);
    }
  }
  return issues;
}

/** Globals shadowed inside every compiled template (defence in depth behind the lint). */
export const SHADOWED_GLOBALS = [
  'Date',
  'Math',
  'process',
  'globalThis',
  'global',
  'require',
  'fetch',
  'crypto',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'Function',
  'Buffer',
  'console',
  'Intl',
  'performance',
  'Reflect',
  'Proxy',
];
