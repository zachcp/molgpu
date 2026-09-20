import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.RESULTS_DIR ?? `${root}results`;
await mkdir(out, { recursive: true });
const server = await createServer({ root, configFile: `${root}vite.config.mjs`, server: { host: '127.0.0.1', port: 5184, strictPort: true } });
let browser;
const report = { date: new Date().toISOString(), viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, results: [] };
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1', args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
  const run = async (query, fn) => {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(`http://127.0.0.1:5184/${query}`);
      await page.waitForFunction(() => window.__gpuProbe?.submissions > 0, null, { timeout: 45000 });
      if (!report.adapter) report.adapter = await page.evaluate(async () => {
        const a = await navigator.gpu.requestAdapter();
        return { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description, userAgent: navigator.userAgent, visibility: document.visibilityState };
      });
      await fn(page);
      await page.evaluate(() => window.__gpuProbe.drain());
      assert.deepEqual(await page.evaluate(() => window.__gpuProbe.errors), [], 'WebGPU validation errors');
      assert.deepEqual(errors, [], 'Browser errors');
    } finally { await page.close(); }
  };
  if (!process.argv.includes('--s2-only')) {
    for (const [n, size] of [[10000, 74], [100000, 74], [1000000, 74], [1000000, 18.5]]) {
      await run(`?n=${n}&size=${size}`, async page => {
        await page.waitForFunction(() => window.__bench?.done, null, { timeout: 60000 });
        const result = await page.evaluate(() => ({ ...window.__bench.stats, prep: window.__prep }));
        assert.ok(result.submissions >= result.frames * 0.9, 'Idle scene: insufficient GPU submissions');
        report.results.push({ n, size, ...result });
        await page.screenshot({ path: `${out}/s1-${n}-${size}.png` });
        console.log(JSON.stringify(report.results.at(-1)));
      });
    }
  }
  if (!process.argv.includes('--s2-only')) await run('?mode=mesh&n=100&size=1', async page => {
    await page.waitForFunction(() => window.__bench?.done, null, { timeout: 60000 });
    report.meshSmoke = await page.evaluate(() => window.__prep);
    assert.equal(report.meshSmoke.vertsPerSphere, 77);
    await page.screenshot({ path: `${out}/mesh-smoke.png` });
  });
  await run('s2.html', async page => {
    assert.equal(await page.evaluate(() => window.__s2.samplerChecks()), true);
    const settle = async () => page.evaluate(async () => { for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame); });
    await settle();
    const before = await page.evaluate(() => window.__s2.snapshot());
    assert.equal(before.geometryBuilds, 1);
    assert.equal(before.positionBuilds, 1);
    assert.ok(Object.keys(before.writes).some(k => k.startsWith('mesh:')), 'Missing mesh upload witness');
    for (const [key, writes] of Object.entries(before.writes)) assert.ok(writes > 0, `No observed upload for ${key}`);
    const states = [];
    const shots = [];
    for (const t of [0.5, 1, 1.5, 2, 1.5, 1, 0.5, 0]) {
      await page.evaluate(t => window.__s2.seek(t), t);
      await page.waitForFunction(t => window.__s2.t === t, t);
      await settle();
      const state = await page.evaluate(() => window.__s2.snapshot());
      assert.equal(state.geometryBuilds, before.geometryBuilds);
      assert.equal(state.positionBuilds, before.positionBuilds);
      assert.equal(state.sourceChanges, before.sourceChanges);
      assert.equal(state.writes.positions, before.writes.positions);
      assert.equal(state.writes.sizes, before.writes.sizes);
      for (const key of Object.keys(before.writes).filter(k => k.startsWith('mesh:'))) {
        assert.equal(state.writes[key], before.writes[key], `${key} was uploaded during seek`);
      }
      assert.ok(state.writes.colors > (states.at(-1) ?? before).writes.colors, 'Color buffer did not update');
      assert.ok(state.submissions > (states.at(-1) ?? before).submissions, 'Seek did not render');
      states.push(state);
      if (t === 0 || t === 2) shots.push(await page.locator('canvas').screenshot({ path: `${out}/s2-t${t}.png` }));
    }
    assert.ok(!shots[0].equals(shots[1]), 'Endpoint images are identical');
    report.s2 = { before, states, samplerChecks: true };
    console.log('S2: forward/backward seek assertions passed');
  });
  await writeFile(`${out}/${process.argv.includes('--s2-only') ? 's2-report' : 'report'}.json`, JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser?.close();
  await server.close();
}
