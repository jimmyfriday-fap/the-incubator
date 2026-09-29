#!/usr/bin/env node
// `test:profile <name>`: runs the suites and scenario tags a run profile selects.
import { EXIT, isMain, parseArgs, readJson } from './guard/lib/common.mjs';
import { nodeBin, run, which } from './guard/lib/proc.mjs';

async function main() {
  const { positional } = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const cfg = readJson(root, 'config/run-profiles.json');
  const name = positional[0];
  const profile = cfg.profiles[name];
  if (!profile) {
    process.stderr.write(
      `unknown profile "${name}" (have: ${Object.keys(cfg.profiles).join(', ')})\n`,
    );
    return EXIT.POLICY;
  }
  if (profile.requiresLive && process.env.INCUBATOR_LIVE !== '1') {
    process.stderr.write(
      `profile "${name}" touches live systems; set INCUBATOR_LIVE=1 to run it\n`,
    );
    return EXIT.POLICY;
  }
  const runner = cfg.runner;
  const bin = runner.nodeBin
    ? nodeBin(root, runner.nodeBin[0], runner.nodeBin[1])
    : which(runner.cmd[0]);
  if (!bin) {
    process.stderr.write('test runner not installed\n');
    return EXIT.TOOL;
  }
  const args = [...bin[1], ...(runner.cmd?.slice(1) ?? []), ...runner.args];
  for (const suite of profile.suites) args.push(runner.suiteFlag, suite);
  const env = {
    ...profile.env,
    INCUBATOR_PROFILE: name,
    INCUBATOR_SCENARIO_TAGS: profile.scenarioTags.join(','),
  };
  const r = await run(bin[0], args, { cwd: root, env });
  return r.code === 0 ? EXIT.OK : r.code === null ? EXIT.TOOL : EXIT.POLICY;
}

if (isMain(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`test-profile: ${err.message}\n`);
      process.exit(EXIT.TOOL);
    },
  );
}
