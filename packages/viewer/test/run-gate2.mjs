// Gate 2 acceptance: recolouring the ball-and-stick uploads no new geometry.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({
  root, configFile: false,
  resolve: { alias: {
    '@molgpu/io': `${root}packages/io/src/index.mjs`,
    '@molgpu/table': `${root}packages/table/src/index.mjs`,
    '@molgpu/select': `${root}packages/select/src/index.mjs`,
    '@molgpu/fields': `${root}packages/fields/src/index.mjs`,
  } },
  server: { host: '127.0.0.1', port: 5195, strictPort: true },
  optimizeDeps: {
    entries: ['packages/viewer/test/gate2.html'],
    exclude: ['@molgpu/fields', '@molgpu/table', '@molgpu/io', '@molgpu/select', '@molgpu/viewer'],
    include: ['@use-gpu/live', '@use-gpu/workbench', '@use-gpu/webgpu', '@use-gpu/core', '@use-gpu/shader', '@use-gpu/shader/wgsl', '@use-gpu/wgsl', 'lodash'],
  },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:5195/packages/viewer/test/gate2.html');
  await page.waitForFunction(() => window.__probe?.mounted && document.querySelector('canvas'), null, { timeout: 30000 });
  const settle = () => page.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  const shot = () => page.locator('canvas').screenshot();
  const snap = () => page.evaluate(() => ({ storage: window.__probe.storage, errors: [...window.__probe.errors] }));

  await settle(); await settle();
  const before = await snap();
  const beforeShot = await shot();

  // Recolour by swapping the field on all three consumers at once.
  await page.evaluate(() => window.__probe.setPalette(1));
  await settle(); await settle();
  const after = await snap();
  const afterShot = await shot();

  assert.ok(!afterShot.equals(beforeShot), 'recolour must change the rendered image');
  const delta = after.storage - before.storage;
  assert.equal(delta, 0, `recolour rebuilt ${delta} geometry/storage buffers (expected 0)`);
  assert.deepEqual(after.errors, [], 'uncaptured WebGPU errors');
  console.log(JSON.stringify({ status: 'passed', storageBefore: before.storage, recolorStorageDelta: delta, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
