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
  const examples = ['adapter', 'align', 'scene', 'structure', 'tube', 'select'];
  const settle = async () => page.evaluate(async () => {
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
  });
  const shot = () => page.locator('canvas').screenshot();
  const results = {};
  for (const example of examples) {
    await page.goto(`http://127.0.0.1:5187/?ex=${example}`);
    await page.waitForFunction((name) => window.__example === name && document.querySelector('canvas'), example);

    // Capture a cold-start frame before settling. It must contain a real render,
    // while the later pair proves transient resource work reaches a fixed point.
    const transient = await shot();
    await settle();
    const first = await shot();
    await settle();
    const second = await shot();
    assert.ok(transient.length > 1_000, `${example} canvas must render during cold start`);
    assert.deepEqual(second, first, `${example} must settle after transient frames`);
    results[example] = first.length;
  }

  // Switch once more in the same browser session, then exercise camera input.
  await page.goto('http://127.0.0.1:5187/?ex=scene');
  await page.waitForFunction(() => window.__example === 'scene' && document.querySelector('canvas'));
  await settle();
  await page.mouse.move(360, 280);
  await page.mouse.down();
  await page.mouse.move(460, 330, { steps: 8 });
  await page.mouse.up();
  await settle();
  const first = await shot();
  await settle();
  const second = await shot();
  assert.deepEqual(second, first, 'scene must settle after example switch and orbit interaction');
  assert.deepEqual(errors, [], 'scene browser errors');
  console.log(JSON.stringify({ status: 'passed', examples: results, browser: browser.version() }));
} finally {
  await browser?.close();
  await server.close();
}
