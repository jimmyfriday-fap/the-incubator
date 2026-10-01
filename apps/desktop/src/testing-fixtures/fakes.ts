import type { Exec } from '@incubator/runtime';
import { Logger, MemorySink } from '@incubator/runtime';
import {
  discoveryFixtureDir,
  enhanceFixtureDir,
  fakeAgentHandoff,
  fakePublishEngine,
} from '@incubator/core/testing';

/**
 * Test builds only (bundled when INCUBATOR_TEST_BUILD=1, and used only with the test launch flag):
 * the engine on recorded discovery turns, an in-memory GitHub and a fake coding agent, as in the web
 * e2e tests. INCUBATOR_TEST_PICK_FOLDER stands in for the native folder dialog.
 */
export function fakeWiring() {
  // INCUBATOR_TEST_FIXTURE picks the recorded turns: `discovery:<name>` (default saas-web) for a new
  // project, or `enhance:<name>` for an enhancement request.
  const [kind, name] = (process.env['INCUBATOR_TEST_FIXTURE'] ?? 'discovery:saas-web').split(':');
  const dir = kind === 'enhance' ? enhanceFixtureDir(name ?? '') : discoveryFixtureDir(name ?? '');
  const agent = fakeAgentHandoff();
  // why: the fake agent is a node script and process.execPath is the Electron binary here, which
  // only behaves as node when told to.
  const exec: Exec = {
    run: (bin, args, opts) =>
      agent.exec.run(bin, args, { ...opts, env: { ...opts.env, ELECTRON_RUN_AS_NODE: '1' } }),
    which: (n) => agent.exec.which(n),
  };
  const h = fakePublishEngine({ handoff: { ...agent, exec }, llm: { dir } });
  const picked = process.env['INCUBATOR_TEST_PICK_FOLDER'];
  return {
    engine: h.engine,
    store: h.store,
    log: new Logger([new MemorySink()]),
    ...(picked ? { pickFolder: () => Promise.resolve(picked) } : {}),
  };
}
