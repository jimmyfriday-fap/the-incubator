import { describe, expect, it } from 'vitest';
import {
  camel,
  indent,
  kebab,
  makeHelpers,
  pascal,
  phpStr,
  pyStr,
  safeText,
  snake,
  sortBy,
  title,
  upperSnake,
  yamlStr,
} from './helpers.js';

describe('template helpers', () => {
  it('converts identifiers between cases', () => {
    expect(pascal('reorder-alerts')).toBe('ReorderAlerts');
    expect(pascal('HTTPServer v2')).toBe('HttpserverV2');
    expect(camel('reorder-alerts')).toBe('reorderAlerts');
    expect(snake('reorderAlerts')).toBe('reorder_alerts');
    expect(kebab('Reorder Alerts')).toBe('reorder-alerts');
    expect(upperSnake('my-app')).toBe('MY_APP');
    expect(title('book club')).toBe('Book Club');
    expect(pascal('---')).toBe('Project');
    expect(snake('')).toBe('project');
    expect(kebab('!!')).toBe('project');
  });

  it('strips control and bidi characters from free text and caps its length', () => {
    expect(safeText('a\u0000b‮c⁦ \n\t d')).toBe('abc d');
    expect(safeText('x'.repeat(20), 5)).toBe('xxxxx');
  });

  it('quotes strings for YAML, PHP and Python', () => {
    expect(yamlStr('a "b"')).toBe('"a \\"b\\""');
    expect(phpStr("it's \\ ok")).toBe("'it\\'s \\\\ ok'");
    expect(pyStr('x')).toBe('"x"');
  });

  it('indents and sorts', () => {
    expect(indent('a\n\nb', 2)).toBe('  a\n\n  b');
    expect(sortBy([{ k: 'b' }, { k: 'a' }, { k: 'a' }], 'k').map((x) => x.k)).toEqual([
      'a',
      'a',
      'b',
    ]);
  });

  it('pins actions from the lock and refuses unknown ones', () => {
    const h = makeHelpers({ 'actions/checkout': { tag: 'v5.0.0', sha: 'a'.repeat(40) } });
    expect(h.action('actions/checkout')).toBe(`actions/checkout@${'a'.repeat(40)} # v5.0.0`);
    expect(() => h.action('evil/action')).toThrow('not in actions-lock.json');
    expect(Object.isFrozen(h)).toBe(true);
  });
});
