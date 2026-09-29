import { Logger, MemorySink } from '@incubator/runtime';
import { discoveryFixtureDir, fakePublishEngine } from '@incubator/core/testing';

/**
 * Test builds only (bundled when INCUBATOR_TEST_BUILD=1, and used only with the test launch flag):
 * the engine on recorded discovery turns and an in-memory GitHub, as in the web e2e tests.
 */
export function fakeWiring() {
  const h = fakePublishEngine({ llm: { dir: discoveryFixtureDir('saas-web') } });
  return { engine: h.engine, store: h.store, log: new Logger([new MemorySink()]) };
}
