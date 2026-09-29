#!/usr/bin/env node
// Minimal tracker client for hooks and CI (local tickets or Leantime JSON-RPC), mirroring
// @incubator/tracker's wire format. CI failure triage uses it and never changes a verdict.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { EXIT, isMain, parseArgs, readJson } from '../guard/lib/common.mjs';

const EDGES = {
  NEW: ['TAGGED_TO_RELEASE'],
  TAGGED_TO_RELEASE: ['ENRICHMENT_IN_PROGRESS'],
  ENRICHMENT_IN_PROGRESS: ['DEV_IN_PROGRESS'],
  DEV_IN_PROGRESS: ['READY_FOR_TEST'],
  READY_FOR_TEST: ['TEST_PASSED', 'TEST_FAILED'],
  TEST_PASSED: ['DEPLOYED'],
  TEST_FAILED: ['DEV_IN_PROGRESS'],
  DEPLOYED: [],
  PARKED: [],
};

export function canTransition(from, to) {
  if (to === 'PARKED') return from !== 'DEPLOYED' && from !== 'PARKED';
  return (EDGES[from] ?? []).includes(to);
}

function stateDir(root) {
  const d = path.join(root, '.incubator', 'state');
  mkdirSync(d, { recursive: true });
  return d;
}

export function activeTicket(root) {
  const f = path.join(root, '.incubator', 'state', 'active-ticket');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() || null : null;
}

function ticketFile(root, cfg, id) {
  return path.join(root, cfg.ticketsDir ?? '.incubator/tickets', `${id}.json`);
}

async function leantime(cfg, method, params) {
  const token = process.env.INCUBATOR_LEANTIME_TOKEN;
  if (!token) throw new Error('INCUBATOR_LEANTIME_TOKEN is not set');
  const res = await fetch(new URL('/api/jsonrpc', cfg.leantime.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': token },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`leantime HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`leantime error ${body.error.code}`);
  return body.result;
}

export async function transition(root, id, to) {
  const cfg = readJson(root, '.incubator/tracker.json');
  if (cfg.type === 'leantime') {
    const status = cfg.leantime.statusMap?.[to];
    if (status === undefined) throw new Error(`no Leantime status mapped for ${to}`);
    await leantime(
      cfg,
      cfg.leantime.methods?.updateTicket ?? 'leantime.rpc.Tickets.Tickets.patch',
      { id: Number(id), params: { status } },
    );
    return to;
  }
  const file = ticketFile(root, cfg, id);
  const ticket = JSON.parse(readFileSync(file, 'utf8'));
  if (ticket.state === to) return to;
  if (!canTransition(ticket.state, to))
    throw new Error(`illegal ticket transition ${ticket.state} → ${to}`);
  ticket.state = to;
  writeFileSync(file, `${JSON.stringify(ticket, null, 2)}\n`);
  return to;
}

export async function addRemediation(root, id, item) {
  const entry = { ...item, at: new Date().toISOString() };
  const cfg = readJson(root, '.incubator/tracker.json', { type: 'local' });
  if (id && cfg.type === 'local' && existsSync(ticketFile(root, cfg, id))) {
    const file = ticketFile(root, cfg, id);
    const ticket = JSON.parse(readFileSync(file, 'utf8'));
    ticket.remediations = [...(ticket.remediations ?? []), entry];
    writeFileSync(file, `${JSON.stringify(ticket, null, 2)}\n`);
    return;
  }
  appendFileSync(
    path.join(stateDir(root), 'remediations.jsonl'),
    `${JSON.stringify({ ticket: id, ...entry })}\n`,
  );
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const [cmd] = positional;
  if (cmd === 'ci-failure') {
    // CI triage: record the failure; this step runs with continue-on-error and cannot change the verdict.
    const item = {
      kind: 'ci-failure',
      job: flags.job ?? 'unknown',
      run: flags.run ?? '',
      summary: flags.summary ?? '',
    };
    mkdirSync(path.join(root, '.reports'), { recursive: true });
    writeFileSync(
      path.join(root, '.reports', 'ci-failure.json'),
      `${JSON.stringify(item, null, 2)}\n`,
    );
    await addRemediation(root, activeTicket(root), item);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### CI failure triage\n\n- job: ${item.job}\n- run: ${item.run}\n`,
      );
    return EXIT.OK;
  }
  if (cmd === 'transition') {
    await transition(root, positional[1], positional[2]);
    return EXIT.OK;
  }
  if (cmd === 'activate') {
    writeFileSync(path.join(stateDir(root), 'active-ticket'), `${positional[1]}\n`);
    return EXIT.OK;
  }
  process.stderr.write('usage: tracker.mjs ci-failure|transition <id> <state>|activate <id>\n');
  return EXIT.POLICY;
}

if (isMain(import.meta.url)) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      process.stderr.write(`tracker: ${e.message}\n`);
      process.exit(EXIT.TOOL);
    },
  );
}
