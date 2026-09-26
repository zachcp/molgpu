// hj0.1 acceptance: a representation wrapped in each @molgpu/viewer material
// mounts and draws under the viewer's light wrappers with no WebGPU errors, and
// a runtime material switch compiles a new render pipeline (the material reaches
// the shaded layer) without allocating new geometry storage buffers.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { workspaceAliases } from '../../../scripts/workspace-aliases.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({
  root, configFile: false,
  resolve: { alias: workspaceAliases() },
  server: { host: '127.0.0.1', port: 5211, strictPort: true },
  optimizeDeps: {
    entries: ['packages/viewer/test/materials.html'],
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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5211/packages/viewer/test/materials.html');
  await page.waitForFunction(() => window.__probe?.mounted && document.querySelector('canvas'), null, { timeout: 30000 })
    .catch((error) => { throw new Error(`Materials mount failed: ${errors.join('; ') || error.message}`); });

  const settle = () => page.evaluate(async () => { for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); });
  // Labels are assigned after createBuffer, so read them live off the buffers.
  // A shaded point layer's own geometry column is labelled 'molgpu:base-sizes'.
  const snap = () => page.evaluate(() => ({
    storage: window.__probe.storage.length,
    geometryBuffers: window.__probe.storageBuffers.filter((b) => b.label === 'molgpu:base-sizes').length,
    pipelines: window.__probe.pipelines,
    errors: [...window.__probe.errors],
  }));

  // Default mount is the matte PBR material. It must draw shaded geometry.
  await settle(); await settle();
  const pbr = await snap();
  assert.deepEqual(pbr.errors, [], 'PBR material scene produced WebGPU errors');
  assert.ok(pbr.geometryBuffers > 0, 'expected the shaded point layer to allocate its size column');
  assert.ok(pbr.pipelines > 0, 'expected at least one shaded render pipeline');

  // Change a PBR PARAMETER (matte -> metal, same material type). The wrappers
  // bind albedo/metalness/roughness as shader uniforms, so this must be a plain
  // uniform write: no new render pipeline and no rebuilt geometry.
  await page.evaluate(() => window.__probe.setMaterial('metal'));
  await settle(); await settle();
  const metal = await snap();
  assert.deepEqual(metal.errors, [], 'metal PBR scene produced WebGPU errors');
  assert.equal(metal.pipelines, pbr.pipelines, 'a PBR parameter change must not compile a new pipeline');
  assert.equal(metal.geometryBuffers, pbr.geometryBuffers, 'a PBR parameter change must not rebuild geometry');

  // Switch to a different SHADING MODEL (unlit basic vs lit PBR). That changes
  // the layer's fragment/surface shader, so it must compile a new render
  // pipeline — proving the material really reaches the shaded layer.
  await page.evaluate(() => window.__probe.setMaterial('basic'));
  await settle(); await settle();
  const basic = await snap();
  assert.deepEqual(basic.errors, [], 'basic material scene produced WebGPU errors');
  assert.ok(basic.pipelines > metal.pipelines, 'switching shading model must compile a new render pipeline');

  // The normal-debug material, the function-wrapper escape hatch, and the
  // no-material default must each mount and draw without WebGPU errors.
  for (const name of ['normal', 'wrapper', 'none']) {
    await page.evaluate((n) => window.__probe.setMaterial(n), name);
    await settle(); await settle();
    const s = await snap();
    assert.deepEqual(s.errors, [], `material '${name}' produced WebGPU errors`);
  }

  const final = await snap();
  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(final.errors, [], 'uncaptured WebGPU errors');

  console.log(JSON.stringify({ status: 'passed', pbrPipelines: pbr.pipelines, basicPipelines: basic.pipelines, storage: final.storage, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
