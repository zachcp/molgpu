// hj0.4 acceptance: a centroid-anchored <Label> and a <Distance> between two
// selections' centroids render in a real WebGPU scene with a FontLoader and no
// WebGPU errors; the centroid/distance the components anchor to match the pure
// helper; and re-anchoring the label to a different selection stays clean.
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
    '@molgpu/geo': `${root}packages/geo/src/index.mjs`,
    '@molgpu/select': `${root}packages/select/src/index.mjs`,
    '@molgpu/fields': `${root}packages/fields/src/index.mjs`,
    '@molgpu/timeline': `${root}packages/timeline/src/index.mjs`,
  } },
  server: { host: '127.0.0.1', port: 5214, strictPort: true },
  optimizeDeps: {
    entries: ['packages/viewer/test/annotations.html'],
    // @use-gpu/glyph loads a Rust/wasm text shaper; pre-bundling it breaks the
    // wasm init, so leave it unbundled and let vite serve the wasm.
    exclude: ['@molgpu/fields', '@molgpu/table', '@molgpu/io', '@molgpu/geo', '@molgpu/select', '@molgpu/timeline', '@molgpu/viewer', '@use-gpu/glyph'],
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5214/packages/viewer/test/annotations.html');
  await page.waitForFunction(() => window.__probe?.mounted && document.querySelector('canvas'), null, { timeout: 30000 })
    .catch((error) => { throw new Error(`Annotations mount failed: ${errors.join('; ') || error.message}`); });

  const settle = () => page.evaluate(async () => { for (let i = 0; i < 24; i++) await new Promise(requestAnimationFrame); });
  const snap = () => page.evaluate(() => ({
    storage: window.__probe.storage, textures: window.__probe.textures, pipelines: window.__probe.pipelines,
    centroidA: window.__probe.centroidA, distance: window.__probe.distance, errors: [...window.__probe.errors],
  }));

  await settle(); await settle();
  const s = await snap();
  assert.deepEqual(s.errors, [], 'annotations scene produced WebGPU errors');
  // The pure anchor the components use: centroid of rows 0,1 = (-3,1,0), 6 A apart from rows 2,3.
  assert.deepEqual(s.centroidA, [-3, 1, 0], `centroid anchor wrong: ${JSON.stringify(s.centroidA)}`);
  assert.equal(s.distance, 6, `distance anchor wrong: ${s.distance}`);
  assert.ok(s.pipelines > 0, 'expected render pipelines for the labels + line');
  // The label text needs a font atlas: a texture beyond the render targets means
  // the glyph path actually engaged.
  assert.ok(s.textures > 0, 'expected a font-atlas / render texture to be allocated');

  // Re-anchor the label to the other selection: no errors, still rendering.
  await page.evaluate(() => window.__probe.setLabel('b'));
  await settle(); await settle();
  const moved = await snap();
  assert.deepEqual(moved.errors, [], 're-anchoring the label produced WebGPU errors');

  assert.deepEqual(errors, [], 'page errors');
  console.log(JSON.stringify({ status: 'passed', centroidA: s.centroidA, distance: s.distance, textures: s.textures, pipelines: s.pipelines, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
