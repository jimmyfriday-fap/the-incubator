#!/usr/bin/env node
// Every declared lane ships enrich.md + codegen.md; enrich templates state the output contract and
// carry a worked example that itself passes the contract parser.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { isMain, readJson, readText, report, runGuard } from './lib/common.mjs';
import { VERDICTS, parseEnrichOutput } from './lib/enrich-contract.mjs';

export function checkLanes(root) {
  const { lanes } = readJson(root, '.incubator/lanes/index.json');
  const findings = [];
  if (!Array.isArray(lanes) || lanes.length === 0)
    return ['.incubator/lanes/index.json declares no lanes'];
  for (const lane of lanes) {
    const dir = `.incubator/lanes/${lane}`;
    for (const required of ['enrich.md', 'codegen.md']) {
      if (!existsSync(path.join(root, dir, required))) findings.push(`${dir}/${required}: missing`);
    }
    const enrich = readText(root, `${dir}/enrich.md`);
    if (enrich !== null) {
      if (!enrich.includes('VERDICT:'))
        findings.push(`${dir}/enrich.md: does not instruct a VERDICT line`);
      for (const v of VERDICTS)
        if (!enrich.includes(v)) findings.push(`${dir}/enrich.md: does not list verdict ${v}`);
      if (!enrich.includes('**Step N:**'))
        findings.push(`${dir}/enrich.md: does not instruct **Step N:** blocks`);
      if (!enrich.includes('- Target:'))
        findings.push(`${dir}/enrich.md: does not instruct - Target: lines`);
      const example = /```enrich-example\n([\s\S]*?)```/.exec(enrich);
      if (!example) findings.push(`${dir}/enrich.md: missing an enrich-example block`);
      else {
        const parsed = parseEnrichOutput(example[1]);
        if (!parsed.ok)
          findings.push(`${dir}/enrich.md: example violates contract: ${parsed.errors.join('; ')}`);
      }
    }
    const codegen = readText(root, `${dir}/codegen.md`);
    if (codegen !== null && !/Step/.test(codegen))
      findings.push(`${dir}/codegen.md: must consume the enrich steps`);
  }
  return findings;
}

if (isMain(import.meta.url)) {
  runGuard(({ flags }) =>
    report('lane-contract', checkLanes(process.cwd()), { quiet: flags.quiet }),
  );
}
