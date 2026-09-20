// urn.5 acceptance probe: a style-only `scale` change writes a uniform and
// re-uploads no per-atom size column. Warm up, snapshot STORAGE allocations,
// change scale, and assert zero new storage buffers while the image changes.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({
  root, configFile: false,
  resolve: { alias: { '@molgpu/io': `${root}packages/io/src/index.mjs` } },
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  optimizeDeps: { include: ['@use-gpu/live', '@use-gpu/workbench', '@use-gpu/webgpu', '@use-gpu/core', '@use-gpu/shader', '@use-gpu/wgsl', 'lodash'] },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5193/packages/viewer/test/size-field.html');
  await page.waitForFunction(() => window.__probe?.mounted && document.querySelector('canvas'), null, { timeout: 30000 });

  const settle = () => page.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  const shot = () => page.locator('canvas').screenshot();
  const snap = () => page.evaluate(() => ({ ...window.__probe, setScale: undefined }));

  await settle(); await settle();          // reach a resource fixed point
  const before = await snap();
  const beforeShot = await shot();

  // A style-only scale change. Larger spheres must appear, but no per-atom
  // (STORAGE) column may be reallocated — only the scale uniform is written.
  await page.evaluate(() => window.__probe.setScale(2.5));
  await settle(); await settle();
  const after = await snap();
  const afterShot = await shot();

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(after.errors, [], 'uncaptured WebGPU errors');
  assert.ok(!afterShot.equals(beforeShot), 'scale change must change the rendered image');
  const storageDelta = after.storage - before.storage;
  assert.equal(storageDelta, 0, `scale change reallocated ${storageDelta} storage buffers (expected 0)`);

  console.log(JSON.stringify({ status: 'passed', storageBefore: before.storage, storageDelta, uniformBefore: before.uniform, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
