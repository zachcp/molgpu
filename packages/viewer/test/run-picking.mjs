// hj0.3 acceptance: usePicking() resolves the atom under the cursor from a
// pickable <Spacefill>, and a click seeks the caller-owned timeline to the
// picked atom's beat. Three atoms in a row; the middle (row 1) is at the camera
// target, so the canvas centre picks atom 1 and seeks to beat time 5.
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import {
  captureErrors,
  launchWebGpuBrowser,
  startDevServer,
} from "./harness.mjs";

Deno.test("viewer picking", async () => {
  const server = await startDevServer({
    port: 5213,
    entries: ["packages/viewer/test/picking.html"],
  });
  let browser;
  try {
    browser = await launchWebGpuBrowser();
    const page = await browser.newPage({
      viewport: { width: 640, height: 480 },
    });
    const errors = captureErrors(page);
    await page.goto("http://127.0.0.1:5213/packages/viewer/test/picking.html");
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    )
      .catch((error) => {
        throw new Error(
          `Picking mount failed: ${errors.join("; ") || error.message}`,
        );
      });

    const settle = () =>
      page.evaluate(async () => {
        for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
      });
    const snap = () =>
      page.evaluate(() => ({
        hover: globalThis.__probe.hover,
        pick: globalThis.__probe.pick,
        time: globalThis.__probe.time,
        errors: [...globalThis.__probe.errors],
      }));
    const cx = 320, cy = 240; // canvas centre = the middle atom

    // Let the first frames render and the picking buffer capture.
    await settle();
    await settle();

    // Off to a corner first: nothing under the cursor there.
    await page.mouse.move(8, 8);
    await settle();
    const away = await snap();
    assertEquals(away.errors, [], "picking scene produced WebGPU errors");
    assertStrictEquals(
      away.hover,
      null,
      "cursor over the background must resolve to no atom",
    );

    // Hover the centre: resolves to the middle atom (row 1) with a real object id.
    await page.mouse.move(cx, cy);
    await settle();
    const hovering = await snap();
    assertEquals(hovering.errors, [], "hovering produced WebGPU errors");
    assert(
      hovering.hover,
      "hovering the centre atom must resolve to an atom",
    );
    assertStrictEquals(
      hovering.hover.atom,
      1,
      `expected the middle atom (row 1), got ${hovering.hover?.atom}`,
    );
    assert(
      hovering.hover.id > 0,
      "a resolved hover must carry a real picking object id",
    );

    // Click the centre atom: the click-to-seek recipe moves the timeline to its
    // beat (atom row 1 -> beat time 5), from the initial time 0.
    assertStrictEquals(hovering.time, 0, "timeline should start at time 0");
    await page.mouse.click(cx, cy);
    await settle();
    const clicked = await snap();
    assertEquals(clicked.errors, [], "clicking produced WebGPU errors");
    assert(
      clicked.pick && clicked.pick.atom === 1,
      `a click must pick the middle atom, got ${JSON.stringify(clicked.pick)}`,
    );
    assertStrictEquals(
      clicked.time,
      5,
      `click-to-seek must move the timeline to beat time 5, got ${clicked.time}`,
    );

    // A selection that drops row 0: the middle atom is drawn instance 0. Its
    // position is read through the selection rows on the GPU, and the hit
    // maps back through the same rows.
    await page.goto(
      "http://127.0.0.1:5213/packages/viewer/test/picking.html?select",
    );
    await page.waitForFunction(
      () => globalThis.__probe?.mounted && document.querySelector("canvas"),
      null,
      { timeout: 30000 },
    );
    await settle();
    await settle();
    await page.mouse.move(cx, cy);
    await settle();
    const selected = await snap();
    assertEquals(selected.errors, [], "selected picking WebGPU errors");
    assertEquals(
      selected.hover && [selected.hover.atom, selected.hover.drawIndex],
      [1, 0],
      `selected draw must resolve the middle atom as instance 0, got ${
        JSON.stringify(selected.hover)
      }`,
    );

    assertEquals(errors, [], "page errors");
    console.log(
      JSON.stringify({
        status: "passed",
        hover: hovering.hover,
        pick: clicked.pick,
        time: clicked.time,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});
