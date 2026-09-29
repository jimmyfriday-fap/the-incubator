import { ToolError } from '@incubator/runtime';

/**
 * Tiny, pure condition language for pack manifests (never eval'd):
 *   expr := or ; or := and ('||' and)* ; and := unary ('&&' unary)* ; unary := '!' unary | cmp
 *   cmp := value (('==' | '!=') value | 'in' list)? ; value := path | 'string' | number | true | false | '(' expr ')'
 */
type Tok = { t: 'op' | 'str' | 'num' | 'id' | 'lp' | 'rp' | 'lb' | 'rb' | 'comma'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '&&', '||'].includes(two)) {
      out.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '!') {
      out.push({ t: 'op', v: '!' });
      i++;
      continue;
    }
    const single: Record<string, Tok['t']> = {
      '(': 'lp',
      ')': 'rp',
      '[': 'lb',
      ']': 'rb',
      ',': 'comma',
    };
    if (single[c]) {
      out.push({ t: single[c], v: c });
      i++;
      continue;
    }
    if (c === "'") {
      const end = src.indexOf("'", i + 1);
      if (end < 0) throw new ToolError(`unterminated string in condition: ${src}`);
      out.push({ t: 'str', v: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const m = /^[A-Za-z_$][\w$.]*|^-?\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new ToolError(`unexpected "${c}" in condition: ${src}`);
    out.push({ t: /^-?\d/.test(m[0]) ? 'num' : 'id', v: m[0] });
    i += m[0].length;
  }
  return out;
}

function lookup(ctx: unknown, path: string): unknown {
  let cur = ctx;
  for (const part of path.split('.')) {
    // why: own properties only, so paths like `constructor` never reach the prototype chain.
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function evaluateWhen(src: string, ctx: Record<string, unknown>): boolean {
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | undefined => toks[pos];
  const take = (t?: Tok['t'], v?: string): Tok => {
    const tok = toks[pos];
    if (!tok || (t && tok.t !== t) || (v && tok.v !== v))
      throw new ToolError(`bad condition: ${src}`);
    pos++;
    return tok;
  };
  const value = (): unknown => {
    const tok = peek();
    if (!tok) throw new ToolError(`bad condition: ${src}`);
    if (tok.t === 'lp') {
      take('lp');
      const v = or();
      take('rp');
      return v;
    }
    if (tok.t === 'str') return take().v;
    if (tok.t === 'num') return Number(take().v);
    if (tok.t === 'id') {
      const id = take().v;
      if (id === 'true') return true;
      if (id === 'false') return false;
      return lookup(ctx, id);
    }
    throw new ToolError(`bad condition: ${src}`);
  };
  const cmp = (): unknown => {
    const left = value();
    const tok = peek();
    if (tok?.t === 'op' && (tok.v === '==' || tok.v === '!=')) {
      take();
      const right = value();
      return tok.v === '==' ? left === right : left !== right;
    }
    if (tok?.t === 'id' && tok.v === 'in') {
      take();
      if (peek()?.t !== 'lb') {
        const list = value();
        return Array.isArray(list) && list.includes(left);
      }
      take('lb');
      const items: unknown[] = [];
      while (peek()?.t !== 'rb') {
        items.push(value());
        if (peek()?.t === 'comma') take('comma');
      }
      take('rb');
      return items.includes(left);
    }
    return left;
  };
  const unary = (): unknown => {
    if (peek()?.t === 'op' && peek()?.v === '!') {
      take();
      return !unary();
    }
    return cmp();
  };
  const and = (): unknown => {
    let v = unary();
    while (peek()?.t === 'op' && peek()?.v === '&&') {
      take();
      const r = unary();
      v = Boolean(v) && Boolean(r);
    }
    return v;
  };
  const or = (): unknown => {
    let v = and();
    while (peek()?.t === 'op' && peek()?.v === '||') {
      take();
      const r = and();
      v = Boolean(v) || Boolean(r);
    }
    return v;
  };
  const result = or();
  if (pos !== toks.length) throw new ToolError(`trailing tokens in condition: ${src}`);
  return Boolean(result);
}
