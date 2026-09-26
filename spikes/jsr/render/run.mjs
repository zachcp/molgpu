// Serve the Deno-bundled page and check it renders in Chrome WebGPU.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const dir = new URL('./', import.meta.url);
const server = createServer(async (req, res) => {
  const path = req.url === '/' ? 'index.html' : req.url.slice(1);
  try {
    const body = await readFile(new URL(path, dir));
    res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(url);
  await page.waitForFunction(() => window.__probe?.mounted, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  // A WebGPU canvas can't be read back after it presents, so count lit pixels
  // in a screenshot instead.
  const png = await page.screenshot({ path: new URL('render.png', dir).pathname });
  const lit = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
    c.drawImage(bitmap, 0, 0);
    const { data } = c.getImageData(0, 0, bitmap.width, bitmap.height);
    let n = 0; for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 60) n++;
    return n;
  }, png.toString('base64'));
  const { errors } = await page.evaluate(() => window.__probe);
  const result = { status: lit > 2000 && !errors.length && !pageErrors.length ? 'passed' : 'failed', litPixels: lit, errors, pageErrors };
  console.log(JSON.stringify(result));
  if (result.status !== 'passed') process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
