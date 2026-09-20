import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}vite.config.mjs`,
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  // Instrument GPU resource churn before any page script runs, so the device is
  // created against the patched prototypes. These counters are what separate a
  // reactive renderer (quiet at rest, one redraw per input) from the thrashing
  // this probe guards against: a redraw loop keeps `submit` climbing with no
  // input, and per-camera buffer re-uploads keep `createBuffer` climbing during
  // a drag. See molgpu-sept-s15.
  await page.addInitScript(() => {
    const stats = { createBuffer: 0, writeBuffer: 0, submit: 0, createTexture: 0 };
    window.__gpuStats = stats;
    const patch = (proto, name, key) => {
      if (!proto || typeof proto[name] !== 'function') return;
      const orig = proto[name];
      proto[name] = function (...args) { stats[key]++; return orig.apply(this, args); };
    };
    try { patch(GPUDevice.prototype, 'createBuffer', 'createBuffer'); } catch {}
    try { patch(GPUDevice.prototype, 'createTexture', 'createTexture'); } catch {}
    try { patch(GPUQueue.prototype, 'submit', 'submit'); } catch {}
    try { patch(GPUQueue.prototype, 'writeBuffer', 'writeBuffer'); } catch {}
    window.__snap = () => ({ ...window.__gpuStats });

    // WebGPU validation failures surface as `uncapturederror` events on the
    // device — they do not throw, so `pageerror`/console listeners miss them.
    // Hook requestDevice to attach a listener the moment any device is created.
    window.__gpuErrors = [];
    try {
      const requestDevice = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = async function (...args) {
        const device = await requestDevice.apply(this, args);
        try {
          device.addEventListener('uncapturederror', (event) => {
            window.__gpuErrors.push(String(event.error?.message ?? event.error));
          });
        } catch {}
        return device;
      };
    } catch {}
  });

  const settle = (frames = 8) => page.evaluate(async (n) => {
    for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
  }, frames);
  const snap = () => page.evaluate(() => window.__snap());
  const delta = (before, after) => Object.fromEntries(Object.keys(after).map(k => [k, after[k] - before[k]]));
  const shot = () => page.locator('canvas').screenshot();

  // Warm up until GPU resource creation reaches a fixed point. Startup does
  // async pipeline/texture/buffer work that trickles in over several frames, so
  // a fixed frame count is not enough to separate "still starting" from "idle".
  const warmup = async (maxWindows = 16) => {
    let prev = await snap();
    for (let i = 0; i < maxWindows; i++) {
      await settle(8);
      const cur = await snap();
      if (cur.createBuffer === prev.createBuffer && cur.submit === prev.submit && cur.writeBuffer === prev.writeBuffer) return cur;
      prev = cur;
    }
    return prev;
  };

  const examples = ['adapter', 'align', 'scene', 'structure', 'tube', 'select'];
  const results = {};
  for (const example of examples) {
    await page.goto(`http://127.0.0.1:5187/?ex=${example}`);
    await page.waitForFunction((name) => window.__example === name && document.querySelector('canvas'), example);

    // Capture a cold-start frame before settling. It must contain a real render,
    // while the later pair proves transient resource work reaches a fixed point.
    const transient = await shot();
    const warm = await warmup();
    const first = await shot();
    await settle();
    const second = await shot();
    assert.ok(transient.length > 1_000, `${example} canvas must render during cold start`);
    assert.deepEqual(second, first, `${example} must settle after transient frames`);

    // Idle quiescence: with no input after warm-up, a reactive renderer must
    // allocate nothing and submit nothing. Any non-zero here is the thrashing
    // signal — an allocation churn or an unconditional redraw loop.
    const idle = delta(warm, await snap());
    assert.equal(idle.createBuffer, 0, `${example} must allocate no buffers at rest (got ${idle.createBuffer})`);
    assert.equal(idle.submit, 0, `${example} must not redraw at rest (got ${idle.submit} submits)`);

    results[example] = { bytes: first.length, warm };
  }

  // Switch once more in the same session, then trace a real orbit drag frame by
  // frame. Interaction must move the image AND drive submissions (redraw
  // responds to input), but must not allocate per camera update, and must reach
  // a fixed point once the pointer is released.
  await page.goto('http://127.0.0.1:5187/?ex=scene');
  await page.waitForFunction(() => window.__example === 'scene' && document.querySelector('canvas'));
  const sceneWarm = await warmup();

  const preDrag = await shot();
  await page.mouse.move(360, 280);
  await page.mouse.down();
  const midDrag = [];
  for (let i = 0; i < 8; i++) {
    await page.mouse.move(360 + i * 12, 280 + i * 8, { steps: 2 });
    await settle(2);
    midDrag.push({ frame: await shot(), stats: await snap() });
  }
  await page.mouse.up();
  const afterDrag = await snap();

  // Frames sampled during the drag must differ from the resting frame: the
  // scene is actually redrawing in response to the pointer, not frozen.
  assert.ok(midDrag.some(s => !s.frame.equals(preDrag)), 'scene must redraw during drag');
  const dragDelta = delta(sceneWarm, afterDrag);
  assert.ok(dragDelta.submit > 0, 'drag must drive render submissions');
  assert.equal(dragDelta.createBuffer, 0, `drag must not allocate buffers per camera update (got ${dragDelta.createBuffer})`);

  // After release + settle the scene must return to a fixed point: a bounded
  // number of trailing redraws and no further allocation.
  await settle(24);
  const settled = delta(afterDrag, await snap());
  assert.equal(settled.createBuffer, 0, `scene must allocate nothing after drag (got ${settled.createBuffer})`);
  assert.ok(settled.submit <= 2, `scene must stop redrawing after drag (got ${settled.submit} trailing submits)`);

  // Wheel zoom: same contract as the drag. It must move the image and drive
  // submissions, allocate nothing per wheel tick, and settle to a fixed point.
  const preWheel = await shot();
  const beforeWheel = await snap();
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -80); await settle(2); }
  const afterWheel = await snap();
  const wheelDelta = delta(beforeWheel, afterWheel);
  assert.ok(!(await shot()).equals(preWheel), 'wheel zoom must redraw the scene');
  assert.ok(wheelDelta.submit > 0, 'wheel zoom must drive render submissions');
  assert.equal(wheelDelta.createBuffer, 0, `wheel zoom must not allocate buffers per tick (got ${wheelDelta.createBuffer})`);
  await settle(24);
  const settledWheel = delta(afterWheel, await snap());
  assert.equal(settledWheel.createBuffer, 0, `scene must allocate nothing after wheel (got ${settledWheel.createBuffer})`);
  assert.ok(settledWheel.submit <= 2, `scene must stop redrawing after wheel (got ${settledWheel.submit} trailing submits)`);

  // Resize: AutoCanvas must reallocate its swapchain/attachment textures for the
  // new size (a real render, not a frozen frame), then return to a fixed point
  // — no resize-driven redraw loop.
  const beforeResize = await snap();
  await page.setViewportSize({ width: 1024, height: 720 });
  await settle(24);
  const afterResize = delta(beforeResize, await snap());
  assert.ok(afterResize.submit > 0, 'resize must trigger a redraw at the new size');
  const resizeQuiesced = await snap();
  await settle(24);
  const settledResize = delta(resizeQuiesced, await snap());
  assert.equal(settledResize.submit, 0, `scene must not redraw-loop after resize (got ${settledResize.submit} submits)`);
  await page.setViewportSize({ width: 800, height: 600 });
  await settle(16);

  assert.deepEqual(await page.evaluate(() => window.__gpuErrors), [], 'uncaptured WebGPU errors');

  const first = await shot();
  await settle();
  const second = await shot();
  assert.deepEqual(second, first, 'scene must settle after example switch and orbit interaction');
  assert.deepEqual(errors, [], 'scene browser errors');
  console.log(JSON.stringify({
    status: 'passed',
    examples: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.bytes])),
    sceneDrag: { submits: dragDelta.submit, writes: dragDelta.writeBuffer, allocations: dragDelta.createBuffer },
    sceneWheel: { submits: wheelDelta.submit, allocations: wheelDelta.createBuffer },
    sceneResize: { submits: afterResize.submit },
    browser: browser.version(),
  }));
} finally {
  await browser?.close();
  await server.close();
}
