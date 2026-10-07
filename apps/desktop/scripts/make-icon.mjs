#!/usr/bin/env node
// Renders the app icon, build/icon.png (512×512, transparent), from the web UI's favicon.svg (plan 031). Run it by
// hand after the favicon changes: node apps/desktop/scripts/make-icon.mjs. It needs a browser, as the e2e tests do:
// set INCUBATOR_E2E_CHANNEL=chrome to use the installed Chrome.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const repo = path.resolve(import.meta.dirname, '../../..');
const svg = readFileSync(path.join(repo, 'apps/web/src/ui/public/favicon.svg'), 'utf8');
const out = path.join(repo, 'apps/desktop/build/icon.png');
mkdirSync(path.dirname(out), { recursive: true });
const channel = process.env['INCUBATOR_E2E_CHANNEL'];
const browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
  const sized = svg.replace('<svg ', '<svg width="512" height="512" ');
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${sized}</body></html>`,
  );
  await page.screenshot({
    path: out,
    omitBackground: true,
    clip: { x: 0, y: 0, width: 512, height: 512 },
  });
} finally {
  await browser.close();
}
process.stdout.write(`wrote ${path.relative(repo, out)}\n`);
