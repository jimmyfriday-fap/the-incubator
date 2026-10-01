#!/usr/bin/env node
// Stages the desktop app in apps/desktop/app for electron-builder:
//   dist/main.mjs  the main process, bundled (engine, server and dependencies in one ESM file)
//   packs.json     the template packs and their lock files as one archive (extracted at startup)
//   schema/, prompts/, canonical.json
//                  the files the engine reads next to its modules (each `../x` from dist/main.mjs)
//   ui/            the built web UI
//   vendor/keyring the OS keychain binding with this platform's native binary
// INCUBATOR_TEST_BUILD=1 also bundles the fakes behind the test launch flag, plus discovery fixtures.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const repo = path.resolve(desktop, '../..');
const testBuild = process.env.INCUBATOR_TEST_BUILD === '1';
// Release and test builds stage side by side, so CI can smoke one and ship the other.
const out = path.join(desktop, testBuild ? 'app-test' : 'app');

const ui = path.join(repo, 'apps/web/dist/ui');
if (!existsSync(path.join(ui, 'index.html'))) {
  console.error('build.mjs: the web UI is not built (pnpm --filter @incubator/web build:ui)');
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The keychain binding: index.js loads ./keyring.<triple>.node from its own directory first.
const req = createRequire(path.join(repo, 'packages/runtime/package.json'));
const keyringDir = path.dirname(req.resolve('@napi-rs/keyring/package.json'));
const keyringPkg = JSON.parse(readFileSync(path.join(keyringDir, 'package.json'), 'utf8'));
const vendor = path.join(out, 'vendor', 'keyring');
mkdirSync(vendor, { recursive: true });
for (const f of ['index.js', 'package.json', 'LICENSE'])
  cpSync(path.join(keyringDir, f), path.join(vendor, f));
const kreq = createRequire(path.join(keyringDir, 'package.json'));
let natives = 0;
for (const dep of Object.keys(keyringPkg.optionalDependencies ?? {})) {
  let dir;
  try {
    dir = path.dirname(kreq.resolve(`${dep}/package.json`));
  } catch {
    continue; // another platform's binary
  }
  for (const f of ['keyring.' + dep.replace('@napi-rs/keyring-', '') + '.node'])
    if (existsSync(path.join(dir, f))) {
      cpSync(path.join(dir, f), path.join(vendor, f));
      natives++;
    }
}
if (natives === 0)
  console.warn('build.mjs: no native keyring binary for this platform (keychain disabled)');

await build({
  entryPoints: [path.join(desktop, 'src/main.ts')],
  outfile: path.join(out, 'dist/main.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['@incubator/source'],
  mainFields: ['module', 'main'],
  external: ['electron'],
  define: { __INCUBATOR_TEST_BUILD__: testBuild ? 'true' : 'false' },
  // why: bundled CommonJS dependencies still call require(); give the ESM bundle one.
  banner: {
    js: "import { createRequire as __incCreateRequire } from 'node:module'; const require = __incCreateRequire(import.meta.url);",
  },
  plugins: [
    {
      name: 'vendored-keyring',
      setup(b) {
        b.onResolve({ filter: /^@napi-rs\/keyring$/ }, () => ({
          path: '../vendor/keyring/index.js',
          external: true,
        }));
      },
    },
  ],
  legalComments: 'none',
  logLevel: 'warning',
});

const copy = (from, to) => cpSync(path.join(repo, from), path.join(out, to), { recursive: true });
// Packs travel as one archive (installers drop their dotfiles); the app extracts it at startup.
const archiver = await build({
  entryPoints: [path.join(desktop, 'src/packs-archive.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
const { createArchive } = await import(
  `data:text/javascript;base64,${Buffer.from(archiver.outputFiles[0].text).toString('base64')}`
);
writeFileSync(
  path.join(out, 'packs.json'),
  JSON.stringify(createArchive(path.join(repo, 'packages/templates'))),
);
copy('packages/templates/schema', 'schema');
copy('packages/spec/schema', 'schema');
copy('packages/core/prompts', 'prompts');
copy('packages/analyzer/canonical.json', 'canonical.json');
cpSync(ui, path.join(out, 'ui'), { recursive: true });
if (testBuild) {
  copy('packages/core/fixtures/discovery', 'fixtures/discovery');
  copy('packages/core/fixtures/enhance', 'fixtures/enhance');
  copy('packages/core/fixtures/handoff', 'fixtures/handoff');
}

const pkg = JSON.parse(readFileSync(path.join(desktop, 'package.json'), 'utf8'));
writeFileSync(
  path.join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'the-incubator',
      productName: 'The Incubator',
      version: pkg.version,
      description:
        'Turn a plain-English idea and/or an existing repository into a canonical GitHub repository.',
      author: { name: 'The Incubator contributors', email: 'incubator@users.noreply.github.com' },
      license: 'UNLICENSED',
      homepage: 'https://github.com/jimmyfriday-fap/the-incubator',
      type: 'module',
      main: 'dist/main.mjs',
    },
    null,
    2,
  )}\n`,
);
console.log(
  `build.mjs: staged ${path.relative(repo, out)} (${testBuild ? 'test build: fakes included' : 'release build'})`,
);
