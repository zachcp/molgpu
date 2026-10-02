// X2 (hardening) invalidation and GPU resource audit, in a real WebGPU tab.
//
// Drives every row of the change->work table
// (docs/findings/2026-09-17-architecture-review.md, "Invalidation is the
// central contract") for every representation, and asserts which dev-only
// counters (src/internal/instrumentation.mjs) move. Each row mounts one
// representation from scratch, resets the counters, applies exactly one
// change, waits for the counters to reach a fixed point, and inspects them.
// Then: mount/unmount a <Structure> with every representation N times and
// compare live GPU buffers with the baseline; churn selections and check that
// owned GPU buffers stay bounded.
//
// This is an AUDIT: a contract violation is recorded as a Deno `todo`
// naming the violation (so the suite stays green) rather than fixed here.
// Rows that do not apply to a representation are `skip`ped with the reason.
//
// Why a browser, not node: every row below lives inside Live components
// (useMemo keys, RawData/ColumnSource uploads, shader bindings); the pure
// kernels those components call are covered by invalidation.test.ts.
//
// Run: deno task test:viewer:invalidation
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import { launchWebGpuBrowser, startDevServer } from "./harness.mjs";

const root = fromFileUrl(new URL("../../../", import.meta.url));
const out = `${root}packages/viewer/test/results`;
const PORT = 5231;
const MOUNT_CYCLES = 5;
let server, browser, page;
const evidence = { date: new Date().toISOString(), rows: {} };
const registrations = [];

function test(name, options, fn) {
  if (typeof options === "function") {
    fn = options;
    options = {};
  }
  registrations.push({ name, options, fn });
}

async function setup() {
  server = await startDevServer({
    port: PORT,
    entries: ["packages/viewer/test/invalidation.html"],
    // Labels load @use-gpu/glyph's wasm text shaper, which breaks when
    // pre-bundled; leave it unbundled as before.
    exclude: ["@use-gpu/glyph"],
  });
  browser = await launchWebGpuBrowser();
  page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(m.text());
  });
  await page.goto(
    `http://127.0.0.1:${PORT}/packages/viewer/test/invalidation.html`,
  );
  await page.waitForFunction(
    () => globalThis.__inv?.mounted && document.querySelector("canvas"),
    null,
    { timeout: 60000 },
  )
    .catch((error) => {
      throw new Error(
        `invalidation page failed to mount: ${
          pageErrors.join("; ") || error.message
        }`,
      );
    });
  // vite may reload once after discovering a dependency; wait it out.
  await page.waitForTimeout(500);
  await page.waitForFunction(() => globalThis.__inv?.mounted, null, {
    timeout: 60000,
  });
}

async function teardown() {
  await Deno.mkdir(out, { recursive: true });
  await Deno.writeTextFile(
    `${out}/invalidation.json`,
    JSON.stringify(evidence, null, 2),
  );
  await browser?.close();
  await server?.close();
}

// ---- driving ---------------------------------------------------------------

const frames = (n) =>
  page.evaluate(async (k) => {
    for (let i = 0; i < k; i++) await new Promise(requestAnimationFrame);
  }, n);
const snapshot = () => page.evaluate(() => globalThis.__inv.snapshot());
const stableKey = (s) =>
  JSON.stringify([
    s.topologyBuilds,
    s.geometryBuilds,
    s.gathers,
    s.allocations,
    s.uploadBytes,
    s.bindingUpdates,
    s.detail,
    s.ownedBuffers,
    s.deviceBuffers.created,
    s.deviceBuffers.destroyed,
  ]);

/** Wait until the counters stop moving (and `until`, if given, holds). */
async function settle(until) {
  let previous = null, stable = 0;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await frames(6);
    const s = await snapshot();
    if (until && !until(s)) {
      stable = 0;
      previous = null;
      continue;
    }
    const key = stableKey(s);
    stable = key === previous ? stable + 1 : 0;
    previous = key;
    if (stable >= 3) return s;
    await page.waitForTimeout(40);
  }
  throw new Error("counters never reached a fixed point");
}
const setScene = (state) =>
  page.evaluate((s) => globalThis.__inv.set(s), state);
const reset = () => page.evaluate(() => globalThis.__inv.reset());
const scene = (kind, { props = {}, dataKey = "base", time = 0 } = {}) => ({
  mounted: true,
  dataKey,
  time,
  reps: [{ kind, props }],
});

/** Mount `from`, reset the counters, apply `to`, and return what moved.
 * `ready` gates the mount (e.g. an async surface mesh has landed); `rebuilt`
 * gates the edit when it is expected to produce new async geometry. */
async function measure(from, to, { ready, rebuilt } = {}) {
  await setScene({ mounted: false, dataKey: "base", time: 0, reps: [] });
  await settle();
  await reset();
  await setScene(from);
  await settle(ready);
  await reset();
  await setScene(to);
  return settle(rebuilt);
}

// ---- expectations ----------------------------------------------------------

const brief = (s) =>
  JSON.stringify({
    topologyBuilds: s.topologyBuilds,
    geometryBuilds: s.geometryBuilds,
    gathers: s.gathers,
    allocations: s.allocations,
    uploadBytes: s.uploadBytes,
    bindingUpdates: s.bindingUpdates,
    detail: s.detail,
  });
const keysOf = (s, re) => Object.keys(s.detail).filter((k) => re.test(k));
const noErrors = (s) =>
  assertEquals(s.errors, [], `WebGPU errors: ${s.errors.join("; ")}`);

// Color/opacity/clock uniform and display size: bindings only.
function styleOnly(s) {
  noErrors(s);
  assertStrictEquals(
    s.topologyBuilds,
    0,
    `topology rebuilt on a style edit: ${brief(s)}`,
  );
  assertStrictEquals(
    s.geometryBuilds,
    0,
    `geometry rebuilt on a style edit: ${brief(s)}`,
  );
  assertStrictEquals(
    s.gathers,
    0,
    `columns gathered on a style edit: ${brief(s)}`,
  );
  assertStrictEquals(
    s.allocations,
    0,
    `GPU buffers allocated on a style edit: ${brief(s)}`,
  );
  assertStrictEquals(
    s.uploadBytes,
    0,
    `bytes uploaded on a style edit: ${brief(s)}`,
  );
  assert(
    s.bindingUpdates > 0,
    `a style edit must reach the bindings: ${brief(s)}`,
  );
}

// Selection membership: rebuild the mapping and gather affected columns only.
function selectionOnly(s) {
  noErrors(s);
  assertStrictEquals(
    s.topologyBuilds,
    0,
    `topology rebuilt on a selection edit: ${brief(s)}`,
  );
  assertEquals(
    keysOf(s, /structure:/),
    [],
    `shared Structure columns re-uploaded on a selection edit: ${brief(s)}`,
  );
  assert(
    s.gathers + s.geometryBuilds + (s.detail["uploadBytes:index"] ?? 0) > 0,
    `a selection edit must re-derive the mapping: ${brief(s)}`,
  );
}
selectionOnly.rebuilds = true;

// Coordinates: positions/bounds and coordinate-dependent derivations only.
// Topology-only derived columns (attribute columns and selection rows) must not
// be redone: their inputs did not change. Spacefill reads positions through its
// rows on the GPU, so it gathers nothing on a coordinate edit.
const TOPOLOGY_ONLY =
  /^(gathers:(spacefill|bonds:attr):|uploadBytes:(attr:|radii|index))/;
const coordinatesOnly = (mustRebuild) =>
  Object.assign((s) => {
    noErrors(s);
    assert(
      s.detail["uploadBytes:structure:positions"] > 0,
      `shared positions not re-uploaded: ${brief(s)}`,
    );
    assertStrictEquals(
      s.detail["uploadBytes:structure:radii"],
      undefined,
      `radii re-uploaded on a coordinate edit: ${brief(s)}`,
    );
    for (const key of mustRebuild) {
      assert(
        s.detail[key] > 0,
        `coordinate-dependent ${key} was not rebuilt: ${brief(s)}`,
      );
    }
    assertStrictEquals(
      s.topologyBuilds,
      0,
      `topology rebuilt on a coordinate edit: ${brief(s)}`,
    );
    assertEquals(
      keysOf(s, TOPOLOGY_ONLY),
      [],
      `topology-only columns re-derived on a coordinate edit: ${brief(s)}`,
    );
  }, { rebuilds: true });

// Connectivity/model/altloc: affected topology and downstream derivations
// rebuild (this row asserts the rebuild happens, i.e. nothing goes stale).
const rebuilds = (mustRebuild) =>
  Object.assign((s) => {
    noErrors(s);
    for (const key of mustRebuild) {
      assert(
        s.detail[key] > 0,
        `${key} was not rebuilt for a new topology: ${brief(s)}`,
      );
    }
  }, { rebuilds: true });

// A CPU geometry parameter: exactly one geometry build of `key`, nothing upstream.
const geometryParam = (key, upstream) =>
  Object.assign((s) => {
    noErrors(s);
    assertStrictEquals(
      s.detail[key],
      1,
      `expected exactly one ${key}: ${brief(s)}`,
    );
    assertStrictEquals(
      s.topologyBuilds,
      0,
      `topology rebuilt on a geometry-parameter edit: ${brief(s)}`,
    );
    for (const k of upstream) {
      assertStrictEquals(
        s.detail[k],
        undefined,
        `${k} rebuilt on a geometry-parameter edit: ${brief(s)}`,
      );
    }
    assertEquals(
      keysOf(s, /structure:/),
      [],
      `shared Structure columns re-uploaded: ${brief(s)}`,
    );
  }, { rebuilds: true });

// Bonds' default two-tone split vs an explicit colour is a geometry mode
// (sanctioned exception in the contract table): exactly one bond-column build,
// no topology work, and no shared Structure columns re-uploaded.
function splitModeSwitch(s) {
  noErrors(s);
  assertStrictEquals(
    s.detail["geometryBuilds:bonds:columns"],
    1,
    `expected one bond-column build: ${brief(s)}`,
  );
  assertStrictEquals(
    s.topologyBuilds,
    0,
    `topology rebuilt on a colour-mode switch: ${brief(s)}`,
  );
  assertEquals(
    keysOf(s, /structure:/),
    [],
    `shared Structure columns re-uploaded: ${brief(s)}`,
  );
}
splitModeSwitch.rebuilds = true;

// Explicit bond endpoint rows stay fixed on a root coordinate edit; their
// vertex positions are read from the GPU stream. Inferred connectivity can
// change when root StructureData positions change, but provider offsets do not
// rerun inference. Unchanged inferred pairs retain their uploaded row columns.
const liveBondsCoordinates = Object.assign((s) => {
  coordinatesOnly([])(s);
  assertStrictEquals(s.detail["geometryBuilds:bonds:columns"], undefined);
  assertStrictEquals(s.detail["uploadBytes:endpoints"], undefined);
  assertStrictEquals(s.detail["uploadBytes:segments"], undefined);
}, { rebuilds: true });
const inferredBondsKept = Object.assign((s) => {
  noErrors(s);
  assert(
    s.detail["geometryBuilds:bonds:columns"] > 0,
    `bond geometry not rebuilt: ${brief(s)}`,
  );
  assertEquals(
    keysOf(s, /attr:|uploadBytes:(rows|endpoints)/),
    [],
    `attribute or row columns re-derived for unchanged bonds: ${brief(s)}`,
  );
}, { rebuilds: true });
const inferredBondsChanged = Object.assign((s) => {
  noErrors(s);
  assertEquals(
    keysOf(s, /attr:/),
    [],
    `attribute columns re-derived for a coordinate edit: ${brief(s)}`,
  );
  assertStrictEquals(
    s.detail["uploadBytes:rows"],
    s.detail["uploadBytes:endpoints"] * 2,
    `row and endpoint columns disagree: ${brief(s)}`,
  );
}, { rebuilds: true });

// An attribute edit (a new StructureData, same topology and positions):
// exactly the listed builds happen, and nothing else is rebuilt or uploaded.
const attributesOnly = (built) =>
  Object.assign((s) => {
    noErrors(s);
    assertStrictEquals(
      s.topologyBuilds,
      0,
      `topology rebuilt on an attribute edit: ${brief(s)}`,
    );
    assertEquals(
      keysOf(s, /^geometryBuilds:/).sort(),
      built.map((k) => `geometryBuilds:${k}`).sort(),
      `unexpected geometry builds on an attribute edit: ${brief(s)}`,
    );
    assertEquals(
      keysOf(s, /structure:/),
      [],
      `shared Structure columns re-uploaded on an attribute edit: ${brief(s)}`,
    );
  }, { rebuilds: built.length > 0 });

// ---- the matrix ------------------------------------------------------------

const GREY = [0.7, 0.7, 0.7, 1], RED = [1, 0, 0, 1];
const NA = (reason) => ({ na: reason });
const hasMesh = (s) => (s.detail["uploadBytes:indices"] ?? 0) > 0;
const surfaceReady = (s) => hasMesh(s) || s.errors.length > 0;

// row -> { from, to, expect, todo?, until? } or NA(reason). Row keys follow the table.
const MATRIX = {
  spacefill: {
    color: {
      from: { props: { color: GREY } },
      to: { props: { color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    "color field swap": {
      from: { props: { color: "field:element" } },
      to: { props: { color: "field:element2" } },
      expect: styleOnly,
    },
    clock: {
      from: { props: { color: "field:clock" }, time: 0 },
      to: { props: { color: "field:clock" }, time: 0.5 },
      expect: styleOnly,
    },
    selection: {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "B" } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "moved" },
      expect: coordinatesOnly([]),
    },
    "coordinates (field colour)": {
      from: { props: { color: "field:element" } },
      to: { props: { color: "field:element" }, dataKey: "moved" },
      expect: coordinatesOnly([]),
    },
    "coordinates (selection)": {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "A" }, dataKey: "moved" },
      expect: coordinatesOnly([]),
    },
    connectivity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "rebonded" },
      expect: rebuilds(["uploadBytes:structure:radii"]),
    },
    "model/altloc policy": NA(
      "no representation exposes a model/altloc view-policy prop; activeAtoms runs with its defaults",
    ),
    "surface probe/resolution": NA("Spacefill has no surface parameters"),
    "display size (scale)": {
      from: { props: { color: GREY, scale: 1 } },
      to: { props: { color: GREY, scale: 1.5 } },
      expect: styleOnly,
    },
    "CPU profile/width": NA(
      "Spacefill is an impostor; it bakes no profile into vertices",
    ),
  },
  bonds: {
    color: {
      from: { props: { color: GREY } },
      to: { props: { color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    "color field swap": {
      from: { props: { color: "field:element" } },
      to: { props: { color: "field:element2" } },
      expect: styleOnly,
    },
    "color default -> explicit": {
      from: { props: {} },
      to: { props: { color: RED } },
      expect: splitModeSwitch,
    },
    clock: {
      from: { props: { color: "field:clock" }, time: 0 },
      to: { props: { color: "field:clock" }, time: 0.5 },
      expect: styleOnly,
    },
    selection: {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "B" } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "moved" },
      expect: liveBondsCoordinates,
    },
    "coordinates (default colour)": {
      from: { props: {} },
      to: { props: {}, dataKey: "moved" },
      expect: liveBondsCoordinates,
    },
    "coordinates (inferred, same bonds)": {
      from: { props: {}, dataKey: "inferred" },
      to: { props: {}, dataKey: "nudged" },
      expect: inferredBondsKept,
    },
    "coordinates (inferred, bonds change)": {
      from: { props: {}, dataKey: "inferred" },
      to: { props: {}, dataKey: "pulled" },
      expect: inferredBondsChanged,
    },
    connectivity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "rebonded" },
      expect: rebuilds(["geometryBuilds:bonds:columns"]),
    },
    "model/altloc policy": NA(
      "no representation exposes a model/altloc view-policy prop",
    ),
    "surface probe/resolution": NA("Bonds has no surface parameters"),
    "display size (width)": {
      from: { props: { color: GREY, width: 0.3 } },
      to: { props: { color: GREY, width: 0.45 } },
      expect: styleOnly,
    },
    "CPU profile/width": NA("bond sticks are GPU-extruded; no CPU profile"),
  },
  ballAndStick: {
    color: {
      from: { props: { color: GREY } },
      to: { props: { color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    "color field swap": {
      from: { props: { color: "field:element" } },
      to: { props: { color: "field:element2" } },
      expect: styleOnly,
    },
    clock: {
      from: { props: { color: "field:clock" }, time: 0 },
      to: { props: { color: "field:clock" }, time: 0.5 },
      expect: styleOnly,
    },
    selection: {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "B" } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "moved" },
      expect: liveBondsCoordinates,
    },
    connectivity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "rebonded" },
      expect: rebuilds(["geometryBuilds:bonds:columns"]),
    },
    "model/altloc policy": NA(
      "no representation exposes a model/altloc view-policy prop",
    ),
    "surface probe/resolution": NA("BallAndStick has no surface parameters"),
    "display size (ball/stick)": {
      from: { props: { color: GREY, ball: 0.3, stick: 0.28 } },
      to: { props: { color: GREY, ball: 0.4, stick: 0.35 } },
      expect: styleOnly,
    },
    "CPU profile/width": NA(
      "balls are impostors and sticks GPU-extruded; no CPU profile",
    ),
  },
  tube: {
    color: {
      from: { props: { color: GREY } },
      to: { props: { color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    clock: NA(
      "Tube takes a flat colour only (no Field), so there is no clock uniform",
    ),
    selection: {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "B" } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:tube:spline"]),
    },
    "coordinates (selection)": {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "A" }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:tube:spline"]),
    },
    connectivity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "rebonded" },
      expect: rebuilds([
        "topologyBuilds:tube:activeAtoms",
        "geometryBuilds:tube:spline",
      ]),
    },
    "model/altloc policy": NA(
      "Tube exposes no view-policy prop; activeAtoms runs with its defaults",
    ),
    "surface probe/resolution": NA("Tube has no surface parameters"),
    "display size (radius)": {
      from: { props: { color: GREY, radius: 0.3 } },
      to: { props: { color: GREY, radius: 0.5 } },
      expect: styleOnly,
    },
    "CPU profile/width (smooth)": {
      from: { props: { color: GREY, smooth: 4 } },
      to: { props: { color: GREY, smooth: 6 } },
      expect: geometryParam("geometryBuilds:tube:spline", [
        "geometryBuilds:tube:trace",
      ]),
    },
    "unrelated attribute": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "charged" },
      expect: attributesOnly([]),
    },
    "ssCode change": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "ssCoil" },
      expect: attributesOnly([]),
    },
  },
  ribbon: {
    color: {
      from: { props: { color: GREY } },
      to: { props: { color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    clock: NA(
      "Ribbon takes a flat colour only (no Field), so there is no clock uniform",
    ),
    selection: {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "B" } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:ribbon:mesh"]),
    },
    "coordinates (selection)": {
      from: { props: { color: GREY, select: "A" } },
      to: { props: { color: GREY, select: "A" }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:ribbon:mesh"]),
    },
    connectivity: {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "rebonded" },
      expect: rebuilds([
        "topologyBuilds:ribbon:activeAtoms",
        "geometryBuilds:ribbon:mesh",
      ]),
    },
    "model/altloc policy": NA("Ribbon exposes no view-policy prop"),
    "surface probe/resolution": NA("Ribbon has no surface parameters"),
    "display size": NA(
      "Ribbon has no display radius/width prop; its width is baked (see the CPU profile row)",
    ),
    "CPU profile/width (smooth)": {
      from: { props: { color: GREY, smooth: 4 } },
      to: { props: { color: GREY, smooth: 6 } },
      expect: geometryParam("geometryBuilds:ribbon:mesh", [
        "geometryBuilds:ribbon:trace",
        "geometryBuilds:ribbon:ss",
      ]),
    },
    "unrelated attribute": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "charged" },
      expect: attributesOnly([]),
    },
    // ssCode is a geometry input for the cartoon (INVARIANT 4): a new column
    // rebuilds the SS trace, and the mesh only when the projection moves.
    "ssCode, same projection": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "ssSame" },
      expect: attributesOnly(["ribbon:ss"]),
    },
    // DSSP per snapshot: a coordinate edit recomputes codes from the new
    // coordinates, and toggling DSSP is an SS input, never a trace rebuild.
    "dssp, coordinates": {
      from: { props: { color: GREY, secondaryStructure: "dssp" } },
      to: {
        props: { color: GREY, secondaryStructure: "dssp" },
        dataKey: "moved",
      },
      expect: coordinatesOnly([
        "geometryBuilds:ribbon:dssp",
        "geometryBuilds:ribbon:ss",
      ]),
    },
    "dssp on": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY, secondaryStructure: "dssp" } },
      expect: Object.assign((s) => {
        assertStrictEquals(s.detail["geometryBuilds:ribbon:dssp"], 1, brief(s));
        assertStrictEquals(
          s.detail["geometryBuilds:ribbon:trace"],
          undefined,
          brief(s),
        );
        assertStrictEquals(s.topologyBuilds, 0, brief(s));
      }, { rebuilds: true }),
    },
    "ssCode, new projection": {
      from: { props: { color: GREY } },
      to: { props: { color: GREY }, dataKey: "ssCoil" },
      expect: attributesOnly(["ribbon:mesh", "ribbon:ss"]),
    },
  },
  surface: {
    color: {
      from: { props: { color: GREY, resolution: 0.8 } },
      to: { props: { color: RED, resolution: 0.8 } },
      expect: styleOnly,
      until: surfaceReady,
    },
    opacity: {
      from: { props: { color: GREY, resolution: 0.8 } },
      to: { props: { color: GREY, opacity: 0.5, resolution: 0.8 } },
      expect: styleOnly,
      until: surfaceReady,
    },
    clock: NA(
      "Surface takes a flat colour only (no Field), so there is no clock uniform",
    ),
    selection: {
      from: { props: { color: GREY, resolution: 0.8, select: "A" } },
      to: { props: { color: GREY, resolution: 0.8, select: "B" } },
      expect: selectionOnly,
      until: surfaceReady,
    },
    coordinates: {
      from: { props: { color: GREY, resolution: 0.8 } },
      to: { props: { color: GREY, resolution: 0.8 }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:surface:mesh"]),
      until: surfaceReady,
    },
    "coordinates (selection)": {
      from: { props: { color: GREY, resolution: 0.8, select: "A" } },
      to: {
        props: { color: GREY, resolution: 0.8, select: "A" },
        dataKey: "moved",
      },
      expect: coordinatesOnly(["geometryBuilds:surface:mesh"]),
      until: surfaceReady,
    },
    connectivity: {
      from: { props: { color: GREY, resolution: 0.8 } },
      to: { props: { color: GREY, resolution: 0.8 }, dataKey: "rebonded" },
      expect: rebuilds(["geometryBuilds:surface:mesh"]),
      until: surfaceReady,
    },
    "model/altloc policy": NA("Surface exposes no view-policy prop"),
    "surface probe/resolution": {
      from: { props: { color: GREY, resolution: 0.8, probeRadius: 1.4 } },
      to: { props: { color: GREY, resolution: 1.0, probeRadius: 1.6 } },
      expect: geometryParam("geometryBuilds:surface:mesh", []),
      until: surfaceReady,
    },
    "display size": NA("Surface has no display radius/width prop"),
    "CPU profile/width": NA(
      "covered by the probe/resolution row; Surface has no profile",
    ),
  },
  label: {
    color: {
      from: { props: { select: "A", text: "site", color: [1, 1, 0, 1] } },
      to: { props: { select: "A", text: "site", color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { select: "A", text: "site", color: [1, 1, 0, 1] } },
      to: {
        props: { select: "A", text: "site", color: [1, 1, 0, 1], opacity: 0.5 },
      },
      expect: styleOnly,
    },
    "text": {
      from: { props: { select: "A", text: "site", color: RED } },
      to: { props: { select: "A", text: "other", color: RED } },
      expect: styleOnly,
    },
    clock: NA("Label takes a flat colour only, so there is no clock uniform"),
    selection: {
      from: { props: { select: "A", text: "site", color: RED } },
      to: { props: { select: "B", text: "site", color: RED } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { select: "A", text: "site", color: RED } },
      to: {
        props: { select: "A", text: "site", color: RED },
        dataKey: "moved",
      },
      expect: coordinatesOnly(["geometryBuilds:label:anchor"]),
    },
    connectivity: {
      from: { props: { select: "A", text: "site", color: RED } },
      to: {
        props: { select: "A", text: "site", color: RED },
        dataKey: "rebonded",
      },
      expect: rebuilds(["geometryBuilds:label:anchor"]),
    },
    "model/altloc policy": NA("Label exposes no view-policy prop"),
    "surface probe/resolution": NA("Label has no surface parameters"),
    "display size (size)": {
      from: { props: { select: "A", text: "site", color: RED, size: 16 } },
      to: { props: { select: "A", text: "site", color: RED, size: 24 } },
      expect: styleOnly,
    },
    "CPU profile/width": NA("Label has no CPU geometry profile"),
  },
  distance: {
    color: {
      from: { props: { a: "A", b: "B", color: GREY } },
      to: { props: { a: "A", b: "B", color: RED } },
      expect: styleOnly,
    },
    opacity: {
      from: { props: { a: "A", b: "B", color: GREY } },
      to: { props: { a: "A", b: "B", color: GREY, opacity: 0.5 } },
      expect: styleOnly,
    },
    clock: NA(
      "Distance takes a flat colour only, so there is no clock uniform",
    ),
    selection: {
      from: { props: { a: "A", b: "B", color: GREY } },
      to: { props: { a: "C", b: "B", color: GREY } },
      expect: selectionOnly,
    },
    coordinates: {
      from: { props: { a: "A", b: "B", color: GREY } },
      to: { props: { a: "A", b: "B", color: GREY }, dataKey: "moved" },
      expect: coordinatesOnly(["geometryBuilds:distance:anchor"]),
    },
    connectivity: {
      from: { props: { a: "A", b: "B", color: GREY } },
      to: { props: { a: "A", b: "B", color: GREY }, dataKey: "rebonded" },
      expect: rebuilds(["geometryBuilds:distance:anchor"]),
    },
    "model/altloc policy": NA("Distance exposes no view-policy prop"),
    "surface probe/resolution": NA("Distance has no surface parameters"),
    "display size (width/size)": {
      from: { props: { a: "A", b: "B", color: GREY, width: 2, size: 14 } },
      to: { props: { a: "A", b: "B", color: GREY, width: 3, size: 18 } },
      expect: styleOnly,
    },
    "CPU profile/width": NA("Distance has no CPU geometry profile"),
  },
};

// Known contract violations found by this audit. Each is a separate bug; the
// assertion stays in place and is reported as `todo` until it is fixed.
const KNOWN = {};

for (const [kind, rows] of Object.entries(MATRIX)) {
  for (const [row, spec] of Object.entries(rows)) {
    const name = `${kind} / ${row}`;
    if (spec.na) {
      test(name, { skip: `not applicable: ${spec.na}` }, () => {});
      continue;
    }
    test(name, { todo: KNOWN[name] }, async () => {
      const s = await measure(scene(kind, spec.from), scene(kind, spec.to), {
        ready: spec.until,
        rebuilt: spec.expect.rebuilds ? spec.until : undefined,
      });
      evidence.rows[name] = s;
      spec.expect(s);
    });
  }
}

// ---- lifetime ----------------------------------------------------------------

const EVERY = [
  { kind: "spacefill", props: { color: "field:element" } },
  { kind: "bonds", props: {} },
  { kind: "ballAndStick", props: { select: "A" } },
  { kind: "tube", props: {} },
  { kind: "ribbon", props: {} },
  { kind: "surface", props: { resolution: 0.8 } },
  { kind: "label", props: { select: "A", text: "site" } },
  { kind: "distance", props: { a: "A", b: "B" } },
];
const EMPTY = { mounted: false, dataKey: "base", time: 0, reps: [] };

let lifetime;
async function mountCycles() {
  if (lifetime) return lifetime;
  const cycle = async () => {
    await setScene({ mounted: true, dataKey: "base", time: 0, reps: EVERY });
    await settle(surfaceReady);
    const mounted = await snapshot();
    await setScene(EMPTY);
    return { mounted, unmounted: await settle() };
  };
  await setScene(EMPTY);
  await settle();
  await reset();
  // One warm-up cycle: pipelines, shader modules and font atlases are cached
  // above <Structure> on first use and legitimately persist.
  const warm = await cycle();
  // Force a full GC first: a buffer use.gpu merely dropped is freed by the
  // browser, and only one still referenced is a real leak.
  const cdp = await page.context().newCDPSession(page);
  const origins = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    return page.evaluate(() => globalThis.__inv.origins());
  };
  const before = await origins();
  const cycles = [];
  for (let i = 0; i < MOUNT_CYCLES; i++) cycles.push(await cycle());
  // Device buffers that outlived the cycles, grouped by allocation site.
  const after = await origins();
  const leakedOrigins = {
    retained: Object.fromEntries(
      Object.entries(after.retained)
        .map(([origin, n]) => [origin, n - (before.retained[origin] ?? 0)])
        .filter(([, n]) => n > 0),
    ),
    collected: after.collected - before.collected,
  };
  const live = (s) => ({
    owned: s.ownedBuffers.live,
    device: s.deviceBuffers.live,
  });
  lifetime = {
    baseline: live(warm.unmounted),
    mounted: cycles.map((c) => live(c.mounted)),
    unmounted: cycles.map((c) => live(c.unmounted)),
    errors: cycles.at(-1).unmounted.errors,
    leakedOrigins,
  };
  evidence.lifetime = lifetime;
  return lifetime;
}

test(`mount/unmount every representation ${MOUNT_CYCLES}x: viewer-owned live GPU buffers return to baseline`, async () => {
  const l = await mountCycles();
  assertEquals(l.errors, []);
  assert(
    l.mounted.every((m) => m.owned > l.baseline.owned),
    `mounting must allocate owned buffers: ${JSON.stringify(l)}`,
  );
  assertEquals(
    l.unmounted.map((u) => u.owned),
    l.unmounted.map(() => l.baseline.owned),
    `owned buffers leak per cycle: ${JSON.stringify(l)}`,
  );
});

// use.gpu 0.20.0 never calls destroy() on two kinds of small buffers:
// useBoundShader's per-draw uniforms (makeBoundUniforms) and useAggregator's
// storage buffers. That is 12 buffers of 16-240 bytes per mount/unmount cycle.
// Nothing references them after unmount, so the browser frees them on GC. The
// contract is "nothing retained", checked after a forced GC. The
// created-minus-destroyed count keeps growing by design and stays in the evidence.
test(`mount/unmount every representation ${MOUNT_CYCLES}x: no device GPU buffer outlives unmount after GC`, async () => {
  const l = await mountCycles();
  assertEquals(
    l.leakedOrigins.retained,
    {},
    `device buffers still referenced after unmount + GC: ${JSON.stringify(l)}`,
  );
});

// ---- churn --------------------------------------------------------------------

test("selection churn: 64 distinct Spacefill selections keep owned live GPU buffers bounded", async () => {
  await setScene(EMPTY);
  await settle();
  const liveAfter = [];
  for (let k = 0; k < 64; k++) {
    await setScene({
      mounted: true,
      dataKey: "base",
      time: 0,
      reps: [{ kind: "spacefill", props: { color: GREY, select: `W${k}` } }],
    });
    const s = await settle();
    liveAfter.push(s.ownedBuffers.live);
  }
  evidence.churn = { liveAfter };
  const first = liveAfter[7], last = liveAfter.at(-1);
  assert(
    last <= first,
    `owned live GPU buffers grow with selection churn: ${
      JSON.stringify(liveAfter)
    }`,
  );
});

let setupPromise;
let remaining =
  registrations.filter(({ options }) => !options.skip && !options.todo).length;
let serial = Promise.resolve();
for (const { name, options, fn } of registrations) {
  Deno.test({
    name,
    ignore: Boolean(options.skip || options.todo),
    permissions: {
      read: true,
      write: true,
      net: true,
      run: true,
      env: true,
      sys: true,
    },
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      let release;
      const previous = serial;
      serial = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        setupPromise ??= setup();
        await setupPromise;
        await fn();
      } finally {
        try {
          if (--remaining === 0) await teardown();
        } finally {
          release();
        }
      }
    },
  });
}
