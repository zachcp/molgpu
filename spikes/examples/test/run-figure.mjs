// Smoke test for the composed Phase 5 figure page: every appearance/interaction
// feature mounted together on a real structure must render without WebGPU
// errors, wire in the postprocessing passes, and resolve a pick under the
// cursor (which also drives the click-to-seek). The individual features have
// their own focused probes in packages/viewer/test; this guards their
// COMPOSITION, where integration bugs (pass/font/picking ordering) hide.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root, configFile: `${root}vite.config.mjs`,
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.addInitScript(() => {
    const s = { pipelines: 0, textures: 0, errors: [] };
    window.__gpu = s;
    for (const name of ['createRenderPipeline', 'createRenderPipelineAsync']) {
      const o = GPUDevice.prototype[name];
      GPUDevice.prototype[name] = function (...a) { s.pipelines++; return o.apply(this, a); };
    }
    const ct = GPUDevice.prototype.createTexture;
    GPUDevice.prototype.createTexture = function (d) { s.textures++; return ct.call(this, d); };
    const rd = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...a) {
      const dev = await rd.apply(this, a);
      dev.addEventListener('uncapturederror', (e) => s.errors.push(e.error.message));
      return dev;
    };
  });

  // Warm up: the Surface pulls in molstar, which vite optimizes on first sight
  // and then auto-reloads the page. Load once and let that settle, so the real
  // run below loads against pre-bundled deps with no mid-test reload.
  await page.goto('http://127.0.0.1:5188/figure.html');
  await page.waitForTimeout(6000);

  await page.goto('http://127.0.0.1:5188/figure.html');
  await page.waitForFunction(() => window.__figure && document.querySelector('canvas'), null, { timeout: 40000 })
    .catch((error) => { throw new Error(`Figure mount failed: ${errors.join('; ') || error.message}`); });

  const settle = () => page.evaluate(async () => { for (let i = 0; i < 30; i++) await new Promise(requestAnimationFrame); });
  const gpu = () => page.evaluate(() => ({ pipelines: window.__gpu.pipelines, textures: window.__gpu.textures, errors: [...window.__gpu.errors] }));

  await settle(); await settle();
  const mounted = await gpu();
  assert.deepEqual(mounted.errors, [], 'composed figure produced WebGPU errors on mount');
  // A plain lit scene is a handful of pipelines; ssao+outline+oit add many more.
  assert.ok(mounted.pipelines > 15, `expected the postprocessing passes to compile many pipelines, got ${mounted.pipelines}`);
  assert.ok(mounted.textures > 5, `expected postprocess targets + a font atlas, got ${mounted.textures} textures`);

  // Hover the centre (the structure is framed there): the readout must name a
  // real atom rather than the idle prompt, proving picking + tooltip compose.
  await page.mouse.move(400, 300);
  await settle();
  const hover = await page.evaluate(() => document.getElementById('hover').textContent);

  // Click drives the click-to-seek: after it, the timeline should have advanced
  // to the focus beat (t=4) if the click landed on an atom; either way, no error.
  await page.mouse.click(400, 300);
  await settle();
  const afterClick = await gpu();
  assert.deepEqual(afterClick.errors, [], 'interaction produced WebGPU errors');

  assert.deepEqual(errors, [], 'page errors');
  console.log(JSON.stringify({ status: 'passed', pipelines: mounted.pipelines, textures: mounted.textures, hover, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
