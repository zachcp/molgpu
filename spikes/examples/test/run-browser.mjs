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
    window.__storageBuffers = [];
    window.__storageWrites = [];
    const patch = (proto, name, key) => {
      if (!proto || typeof proto[name] !== 'function') return;
      const orig = proto[name];
      proto[name] = function (...args) {
        stats[key]++;
        const result = orig.apply(this, args);
        if (name === 'createBuffer' && (args[0].usage & GPUBufferUsage.STORAGE)) window.__storageBuffers.push(result);
        if (name === 'writeBuffer' && (args[0].usage & GPUBufferUsage.STORAGE)) window.__storageWrites.push(args[0].label);
        return result;
      };
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

  // The per-layer gallery was deleted (molgpu-sept-s15): those examples tripped
  // a per-frame PickingTarget readback-buffer realloc loop and are being
  // replaced with the new component format. `scene` is the composed reference
  // that stayed clean, so the probe now proves the whole contract on it.
  //
  // NB: this is a headless run, and headless Chrome does NOT reproduce the
  // PickingTarget loop — it only ever manifests on a real GPU/compositor. The
  // idle-quiescence and fixed-point assertions below therefore guard the
  // *reactive* contract (no unconditional redraw, no per-input allocation);
  // catching a resize/picking feedback loop needs a real-GPU run.
  const results = {};
  // Warm up: ribbon/surface pull in @molgpu/io and molstar, which vite
  // optimizes on first sight and then auto-reloads the page. Visit them once so
  // that reload cannot land in the middle of the scene assertions below.
  for (const ex of ['ribbon', 'surface']) {
    await page.goto(`http://127.0.0.1:5187/?ex=${ex}`);
    await page.waitForTimeout(6000);
  }
  await page.goto('http://127.0.0.1:5187/?ex=scene');
  await page.waitForFunction(() => window.__example === 'scene' && document.querySelector('canvas'));

  // Capture a cold-start frame before settling. It must contain a real render,
  // while the later pair proves transient resource work reaches a fixed point.
  const transient = await shot();
  const sceneWarm = await warmup();
  {
    const first = await shot();
    await settle();
    const second = await shot();
    assert.ok(transient.length > 1_000, 'scene canvas must render during cold start');
    assert.deepEqual(second, first, 'scene must settle after transient frames');

    // Idle quiescence: with no input after warm-up, a reactive renderer must
    // allocate nothing and submit nothing. Any non-zero here is the thrashing
    // signal — an allocation churn or an unconditional redraw loop.
    const idle = delta(sceneWarm, await snap());
    assert.equal(idle.createBuffer, 0, `scene must allocate no buffers at rest (got ${idle.createBuffer})`);
    assert.equal(idle.submit, 0, `scene must not redraw at rest (got ${idle.submit} submits)`);
    results.scene = first.length;
  }

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
  assert.deepEqual(second, first, 'scene must settle after orbit, wheel, and resize interaction');
  assert.deepEqual(errors, [], 'scene browser errors');

  // A single sphere has the same silhouette from every orbit angle. With a
  // world-fixed light, orbiting moves the lit side across that silhouette.
  await page.goto('http://127.0.0.1:5187/?ex=lighting');
  await page.waitForFunction(() => window.__example === 'lighting' && document.querySelector('canvas'));
  await warmup();
  const litBefore = await shot();
  await page.mouse.move(380, 300);
  await page.mouse.down();
  await page.mouse.move(540, 300, { steps: 12 });
  await page.mouse.up();
  await settle(24);
  const litAfter = await shot();
  const changedPixels = await page.evaluate(async ([a, b]) => {
    const decode = async (base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const before = await decode(a), after = await decode(b);
    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (Math.abs(before[i] - after[i]) + Math.abs(before[i + 1] - after[i + 1]) + Math.abs(before[i + 2] - after[i + 2]) > 30) changed++;
    }
    return changed;
  }, [litBefore.toString('base64'), litAfter.toString('base64')]);
  assert.ok(changedPixels > 1000, `world-fixed light must move shading across a symmetric sphere (changed ${changedPixels} pixels)`);
  assert.deepEqual(await page.evaluate(() => window.__gpuErrors), [], 'lighting WebGPU errors');
  assert.deepEqual(errors, [], 'lighting browser errors');

  // Gate 3: a visible slider scrubs one molecule field and a focus camera over
  // three named beats. Reversing t must reproduce the same rendered frames.
  await page.goto('http://127.0.0.1:5187/?ex=timeline');
  await page.waitForFunction(() => window.__example === 'timeline' && window.__timeline?.pose && document.querySelector('canvas'));
  await warmup();
  await settle(24);
  const timelineStart = await shot();
  const startPose = await page.evaluate(() => window.__timeline.pose);
  const storageStart = await page.evaluate(() => ({
    count: window.__storageBuffers.length,
    labels: window.__storageBuffers.map((buffer) => buffer.label),
    writes: window.__storageWrites.length,
  }));
  assert.ok(storageStart.labels.includes('molgpu:positions'), 'timeline probe must observe molecular positions');
  const scrub = async (time) => {
    await page.locator('#timeline-slider').evaluate((slider, t) => {
      slider.value = String(t);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, time);
    await settle(24);
  };
  await scrub(2);
  const colourShot = await shot();
  assert.ok(!colourShot.equals(timelineStart), 'colour beat must change the rendered molecule');
  assert.deepEqual(await page.evaluate(() => window.__timeline.pose), startPose, 'colour beat keeps camera fixed');
  assert.match(await page.locator('#timeline-readout').textContent(), /2\.00 s · colour/);
  await scrub(4);
  const focusShot = await shot();
  assert.ok(!focusShot.equals(colourShot), 'focus beat must change the camera view');
  assert.notDeepEqual(await page.evaluate(() => window.__timeline.pose.target), startPose.target);
  await scrub(2);
  assert.ok((await shot()).equals(colourShot), 'backward scrub must reproduce the colour beat');
  await scrub(0);
  await settle(24);
  const timelineReset = await shot();
  assert.ok(timelineReset.equals(timelineStart), 'backward scrub must reproduce the overview');
  const storageEnd = await page.evaluate(() => ({
    count: window.__storageBuffers.length,
    writes: window.__storageWrites,
  }));
  assert.equal(storageEnd.count - storageStart.count, 0, 'time-only scrubbing allocated storage buffers');
  assert.deepEqual(storageEnd.writes.slice(storageStart.writes).filter((label) =>
    ['molgpu:positions', 'molgpu:segments', 'molgpu:base-sizes'].includes(label)), [], 'time-only scrubbing rewrote molecular geometry');
  assert.deepEqual(await page.evaluate(() => window.__gpuErrors), [], 'timeline WebGPU errors');
  assert.deepEqual(errors, [], 'timeline browser errors');

  // Representation gallery: every variant of every single-component example
  // must actually paint the molecule (not just mount), and its variants must
  // differ from one another. Loaded fresh per variant via ?v=.
  const REPRESENTATIONS = {
    bonds: ['element', 'flat', 'cys only'],
    tube: ['thin', 'thick', 'gapped'],
    ribbon: ['smooth', 'coarse', 'with tube'],
    surface: ['opaque', 'no probe', 'glass'],
  };
  // Pixels clearly off the harness background (0.05, 0.06, 0.075 -> ~13,15,19).
  const painted = (png) => page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - 13) + Math.abs(px[i + 1] - 15) + Math.abs(px[i + 2] - 19) > 40) n++;
    return n;
  }, png.toString('base64'));
  results.representations = {};
  for (const [ex, variants] of Object.entries(REPRESENTATIONS)) {
    const shots = [];
    for (const v of variants) {
      await page.goto(`http://127.0.0.1:5187/?ex=${ex}&v=${encodeURIComponent(v)}`);
      await page.waitForFunction((want) => window.__variant === want && document.querySelector('canvas'), v, { timeout: 30000 });
      await warmup();
      // Surface meshes build asynchronously; wait until the frame stops changing.
      let frame = await shot();
      for (let i = 0; i < 20; i++) { await settle(12); const next = await shot(); if (next.equals(frame)) break; frame = next; }
      const n = await painted(frame);
      assert.ok(n > 2000, `${ex}/${v} must paint the molecule (only ${n} non-background pixels)`);
      shots.push(frame);
      results.representations[`${ex}/${v}`] = n;
    }
    for (let i = 1; i < shots.length; i++) {
      assert.ok(!shots[i].equals(shots[0]), `${ex}/${variants[i]} must render differently from ${variants[0]}`);
    }
    assert.deepEqual(await page.evaluate(() => window.__gpuErrors), [], `${ex} WebGPU errors`);
    assert.deepEqual(errors, [], `${ex} browser errors`);
  }

  // The toolbar must switch variants live, including a style-only change (the
  // tube radius), which only repaints because variants remount (lib/variants.mjs).
  await page.goto('http://127.0.0.1:5187/?ex=tube&v=thin');
  await page.waitForFunction(() => window.__variant === 'thin' && document.querySelector('canvas'));
  await warmup();
  const thinShot = await shot();
  await page.click('#toolbar button[data-v="thick"]');
  await page.waitForFunction(() => window.__variant === 'thick');
  await warmup();
  assert.ok(!(await shot()).equals(thinShot), 'clicking a toolbar variant must repaint the canvas');

  console.log(JSON.stringify({
    status: 'passed',
    examples: results,
    lightingOrbitChangedPixels: changedPixels,
    timelineStorageDelta: storageEnd.count - storageStart.count,
    sceneDrag: { submits: dragDelta.submit, writes: dragDelta.writeBuffer, allocations: dragDelta.createBuffer },
    sceneWheel: { submits: wheelDelta.submit, allocations: wheelDelta.createBuffer },
    sceneResize: { submits: afterResize.submit },
    browser: browser.version(),
  }));
} finally {
  await browser?.close();
  await server.close();
}
