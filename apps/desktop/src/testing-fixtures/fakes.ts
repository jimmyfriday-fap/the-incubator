import { Logger, MemorySink } from '@incubator/runtime';
import { discoveryFixtureDir, enhanceFixtureDir, fakePublishEngine } from '@incubator/core/testing';

/**
 * Test builds only (bundled when INCUBATOR_TEST_BUILD=1, and used only with the test launch flag):
 * the engine on recorded discovery turns and an in-memory GitHub, as in the web e2e tests.
 */
export function fakeWiring() {
  // INCUBATOR_TEST_FIXTURE picks the recorded turns: `discovery:<name>` (default saas-web) for a new
  // project, or `enhance:<name>` for an enhancement request.
  const [kind, name] = (process.env['INCUBATOR_TEST_FIXTURE'] ?? 'discovery:saas-web').split(':');
  const dir = kind === 'enhance' ? enhanceFixtureDir(name ?? '') : discoveryFixtureDir(name ?? '');
  const h = fakePublishEngine({ llm: { dir } });
  return { engine: h.engine, store: h.store, log: new Logger([new MemorySink()]) };
}
