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
  resolve: { alias: {
    '@molgpu/io': `${root}packages/io/src/index.mjs`,
    '@molgpu/table': `${root}packages/table/src/index.mjs`,
    '@molgpu/fields': `${root}packages/fields/src/index.mjs`,
  } },
  server: { host: '127.0.0.1', port: 5193, strictPort: true },
  optimizeDeps: {
    entries: ['packages/viewer/test/size-field.html'],
    exclude: ['@molgpu/fields', '@molgpu/table', '@molgpu/io', '@molgpu/viewer'],
    include: ['@use-gpu/live', '@use-gpu/workbench', '@use-gpu/webgpu', '@use-gpu/core', '@use-gpu/shader', '@use-gpu/shader/wgsl', '@use-gpu/wgsl', 'lodash'],
  },
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

  assert.ok(!afterShot.equals(beforeShot), 'scale change must change the rendered image');
  const storageDelta = after.storage - before.storage;
  assert.equal(storageDelta, 0, `scale change reallocated ${storageDelta} storage buffers (expected 0)`);

  // Colour field: swapping the byElement palette recompiles the shader module but
  // must re-upload no per-atom column (the element source is reused).
  await page.evaluate(() => window.__probe.setPalette(1));
  await settle(); await settle();
  const afterPalette = await snap();
  const paletteShot = await shot();
  const paletteDelta = afterPalette.storage - after.storage;
  assert.ok(!paletteShot.equals(afterShot), 'palette change must change the rendered image');
  assert.equal(paletteDelta, 0, `palette change reallocated ${paletteDelta} storage buffers (expected 0)`);

  // Time field: switch to the time-driven colour, then advance t. The colour
  // must change from a uniform write with no per-atom re-upload.
  await page.evaluate(() => window.__probe.setPalette(2));
  await settle(); await settle();
  const timeBase = await snap();
  const timeBaseShot = await shot();
  await page.evaluate(() => window.__probe.setTime(0.85));
  await settle(); await settle();
  const afterTime = await snap();
  const timeShot = await shot();
  const timeDelta = afterTime.storage - timeBase.storage;
  assert.ok(!timeShot.equals(timeBaseShot), 'time change must change the rendered image');
  assert.equal(timeDelta, 0, `time change reallocated ${timeDelta} storage buffers (expected 0)`);

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(afterTime.errors, [], 'uncaptured WebGPU errors');

  console.log(JSON.stringify({ status: 'passed', storageBefore: before.storage, scaleStorageDelta: storageDelta, paletteStorageDelta: paletteDelta, timeStorageDelta: timeDelta, uniformBefore: before.uniform, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
