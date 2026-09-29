#!/usr/bin/env node
// Post-deploy smoke check: GET <url>/health until it answers 200 (retries with backoff). Exit 2 on failure.
//   node scripts/deploy/smoke.mjs --url https://staging.example --attempts 10
import { EXIT, isMain, parseArgs } from '../guard/lib/common.mjs';

export async function smoke(
  url,
  {
    attempts = 10,
    delayMs = 3000,
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  let last = 'no attempt';
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetchImpl(new URL('/health', url));
      if (res.status === 200) return { ok: true, attempts: i };
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    if (i < attempts) await sleep(delayMs * Math.min(i, 5));
  }
  return { ok: false, attempts, last };
}

if (isMain(import.meta.url)) {
  const { flags } = parseArgs(process.argv.slice(2));
  if (!flags.url) {
    process.stderr.write('usage: smoke.mjs --url <base url> [--attempts n]\n');
    process.exitCode = EXIT.POLICY;
  } else {
    const r = await smoke(String(flags.url), { attempts: Number(flags.attempts ?? 10) });
    process.stdout.write(
      r.ok
        ? `✔ smoke: healthy after ${r.attempts} attempt(s)\n`
        : `✖ smoke: unhealthy after ${r.attempts} attempts (${r.last})\n`,
    );
    process.exitCode = r.ok ? EXIT.OK : EXIT.POLICY;
  }
}
