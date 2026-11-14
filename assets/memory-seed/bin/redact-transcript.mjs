#!/usr/bin/env node
// redact-transcript: copy a Claude Code session transcript (JSONL) to the store with secrets and identifiers removed.
// Usage:  node bin/redact-transcript.mjs <src.jsonl> <dest.jsonl>
//         node bin/redact-transcript.mjs --selftest
// Why: hooks/session-end used to `cp` the raw transcript, tool output included, so any secret a command or tool printed
// landed on disk in the store, and dream reports quote from it. Saved agent transcripts are a known leak class. This
// redacts the shapes common secret scanners look for (tokens, passwords in commands and URLs, private keys), plus public
// IPv4 addresses and email addresses.
// Self-contained on purpose (the store repo cannot import from the workspace). Replaced text is [REDACTED:<rule>].
// A JSONL line is parsed and each string value redacted on its own, so a JSON escape can never be split.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = /^(x+|\*+|\.{3}|redacted\S*|hidden|present|absent|missing|empty|set|unset|none|null|true|false|yes|no|ok|enabled|disabled|changeme|password|passwd|secret|token|value|key|yourkey\S*|your[-_ ]?\w+|example\S*|dummy|fake\S*|test|root|local|dev)$/i;
function isLiteral(v) {
  v = String(v).trim().replace(/^["']+|["']+$/g, '');
  if (v.length < 4) return false;
  if (/^[$`%<{(\\^@[]/.test(v)) return false;
  if (/\$\{?\w|\$env:|\$\(/.test(v)) return false;
  if (/\.\*|\\[()1-9dwsb]/.test(v)) return false;
  if (PLACEHOLDER.test(v) || /^[*xX._-]+$/.test(v)) return false;
  return true;
}

// V: a value that stops at whitespace, quote, backslash (JSON escape), ; & | so a replacement never breaks the JSON string.
const V = String.raw`([^\s;&|"'\\]{4,})`;
// [name, regex, needs the isLiteral filter]. The secret is always the LAST capture group, at the end of the match.
export const RULES = [
  ['secret-var', new RegExp(String.raw`\b[A-Za-z0-9_]*(?:PASSWORD|PASSWD|MYSQL_PWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY)\s*=\s*["']?` + V, 'gi'), true],
  ['mysql-p', new RegExp(String.raw`\b(?:mysql|mysqldump|mysqladmin|mariadb)\b[^\n|;&]*?\s(?:-p|--password=)` + V, 'g'), true],
  ['bearer', /\bBearer\s+([A-Za-z0-9._~+/=-]{16,})/gi, false],
  ['basic', /\bBasic\s+([A-Za-z0-9+/=]{16,})/g, false],
  ['url-creds', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"\\]+:([^\s/@'"\\]{4,})@/gi, true],
  ['secret-header', /\bX-[\w-]*(?:secret|token|key)[\w-]*\\?["']?\s*[:=]\s*\\?["']?([A-Za-z0-9+/=_-]*[0-9][A-Za-z0-9+/=_-]{8,})/gi, false],
  ['provider-token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g, false],
  ['hex64', /(?:secret|token|password|passwd|key|auth)[^\n]{0,40}?\b([0-9a-f]{64})\b/gi, false],
  ['email', /\b([A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g, false],
  ['public-ip', /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?![\d.])/g, false],
];
const PRIVATE_IP = /^(127|10|0)\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\.|^255\./;
const SAFE_EMAIL = /^(noreply|no-reply|donotreply)@|@(example\.|users\.noreply\.github\.com$|anthropic\.com$)|@\d+\.\d+/i;
const PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

export function redact(text) {
  let n = 0;
  let out = String(text).replace(PEM, () => { n++; return '[REDACTED:private-key]'; });
  for (const [name, re, filter] of RULES) {
    re.lastIndex = 0;
    out = out.replace(re, (...a) => {
      const m = a[0];
      const groups = a.slice(1, a.length - 2); // replace callback args: match, ...captures, offset, whole string
      const val = groups[groups.length - 1];
      if (typeof val !== 'string' || !val || val.startsWith('[REDACTED')) return m;
      if (filter && !isLiteral(val)) return m;
      if (name === 'public-ip' && PRIVATE_IP.test(val)) return m;
      if (name === 'email' && SAFE_EMAIL.test(val)) return m;
      n++;
      const i = m.lastIndexOf(val);
      return m.slice(0, i) + `[REDACTED:${name}]` + m.slice(i + val.length);
    });
  }
  return { text: out, count: n };
}

/** Redact one JSONL line. A JSON line is parsed and each string value is redacted on its own, so a JSON escape
 *  such as \n or \" can never be split. The line is re-serialized only when something changed. */
export function redactLine(line) {
  let obj;
  try { obj = JSON.parse(line); } catch { return redact(line); }
  let count = 0;
  const walk = (v) => {
    if (typeof v === 'string') { const r = redact(v); count += r.count; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  const out = walk(obj);
  return { text: count ? JSON.stringify(out) : line, count };
}

async function redactFile(src, dest) {
  const rl = readline.createInterface({ input: fs.createReadStream(src, { encoding: 'utf8' }), crlfDelay: Infinity });
  const tmp = `${dest}.tmp-${process.pid}`;
  const w = fs.createWriteStream(tmp, { encoding: 'utf8' });
  let total = 0; let lines = 0;
  for await (const line of rl) {
    lines++;
    const { text, count } = redactLine(line);
    total += count;
    w.write(text + '\n');
  }
  await new Promise((res, rej) => { w.end(res); w.on('error', rej); });
  fs.renameSync(tmp, dest);
  return { lines, redactions: total };
}

function selftest() {
  const HEX = 'a1b2c3d4'.repeat(8);
  const GH = ['gh', 'p_', 'A'.repeat(36)].join('');
  const cases = [
    ['secret-var', `PGPASSWORD=hunter2hunter psql -h db`, 'hunter2hunter'],
    ['mysql-p', `mysql -uroot -pS3cretPassw0rd -e x`, 'S3cretPassw0rd'],
    ['bearer', `curl -H \\"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abcdefghij\\" https://x.test`, 'eyJhbGciOiJIUzI1NiJ9abcdefghij'],
    ['url-creds', `git clone https://deploy:Sup3rS3cret@git.example.test/r.git`, 'Sup3rS3cret'],
    ['secret-header', `curl -H \\"X-MCP-Transport-Secret: zq9k0123456789abcdef\\" https://x.test`, 'zq9k0123456789abcdef'],
    ['provider-token', `token ${GH} end`, GH],
    ['hex64', `DEPLOY_SECRET value ${HEX}`, HEX],
    ['email', `contact someone@gmail.com today`, 'someone@gmail.com'],
    ['public-ip', `ssh host 203.0.113.9 reachable`, '203.0.113.9'],
  ];
  const keep = [
    'PGPASSWORD=$PGPW psql', 'mysql -uroot -p"$DB_PW" -e x', 'mysql -h127.0.0.1 -P3306 -uroot', 'mysql -uroot -proot',
    'headers: { "X-App-Secret": process.env.APP_SECRET }', 'git clone https://git.example.test/r.git', 'PASSWORD=**** token=<value>',
    'private 10.1.2.3 and 192.168.1.5 and 127.0.0.1', 'mail noreply@anthropic.com and a@example.com', 'version 22.23.3 and sha 5c9321f0e4d1a2b3c4d5e6f7',
  ];
  let fail = 0;
  const ok = (c, msg) => { if (!c) { fail++; console.error('FAIL', msg); } };
  for (const [name, line, secret] of cases) {
    const json = JSON.stringify({ type: 'tool_result', content: `first line\n${line.replace(/\\"/g, '"')}\nlast "quoted" line` });
    const { text, count } = redactLine(json);
    ok(count >= 1 && !text.includes(secret) && text.includes(`[REDACTED:${name}]`), `${name} not redacted`);
    try { JSON.parse(text); } catch { ok(false, `${name}: JSON broken`); }
  }
  for (const line of keep) { const { text, count } = redactLine(JSON.stringify({ c: line })); ok(count === 0 && JSON.parse(text).c === line, `changed a benign line: ${line}`); }
  // An email right after a \n escape (the case that broke JSON when redacting raw text) must be redacted and the line must stay valid.
  { const raw = JSON.stringify({ c: 'x\nsomeone@gmail.com\ty' }); const { text, count } = redactLine(raw); ok(count === 1 && JSON.parse(text).c === 'x\n[REDACTED:email]\ty', 'email after a newline escape'); }
  const pem = redact('-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----');
  ok(pem.text === '[REDACTED:private-key]', 'private key block');
  console.log(fail ? `redact-transcript selftest: ${fail} FAILED` : `redact-transcript selftest: ok (${cases.length} redacted, ${keep.length} kept)`);
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [a, b] = process.argv.slice(2);
  if (a === '--selftest') selftest();
  else if (!a || !b) { console.error('usage: redact-transcript.mjs <src.jsonl> <dest.jsonl> | --selftest'); process.exit(2); }
  else redactFile(a, b).then((r) => { if (r.redactions) console.error(`redact-transcript: ${r.redactions} value(s) redacted in ${r.lines} lines${r.dropped ? `, ${r.dropped} line(s) dropped` : ''}`); }).catch((e) => { console.error('redact-transcript failed:', e.message); process.exit(1); });
}
