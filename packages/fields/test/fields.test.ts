import {
  assert,
  assertEquals,
  assertMatch,
  assertNotMatch,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  annotation,
  attribute,
  categorical,
  COLOR,
  colormap,
  compile,
  constant,
  curve,
  evaluate,
  linear,
  readsNearestVolume,
  sampleVolumeGradientWgsl,
  SCALAR,
  volumeSample,
} from "../src/index.ts";
import { byPotential } from "../src/index.ts";
import type { Color } from "../src/index.ts";
import {
  ATTRIBUTE_DOMAINS,
  createVolume,
  createVolumeGrid,
  withAttributes,
} from "@molgpu/table";
import { structure } from "./fixture.ts";

const RED: Color = [1, 0, 0, 1],
  BLUE: Color = [0, 0, 1, 1],
  GREY: Color = [0.5, 0.5, 0.5, 1];
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const numeric = (v: Float32Array | string[]): Float32Array => {
  assert(v instanceof Float32Array, "expected a numeric field");
  return v;
};

Deno.test("constant broadcasts one value to every row of the target domain", () => {
  const data = structure();
  assertEquals([...evaluate(constant(0.5), data, { domain: "atom" })], [
    0.5,
    0.5,
    0.5,
    0.5,
  ]);
  assertEquals([...evaluate(constant(RED), data, { domain: "residue" })], [
    1,
    0,
    0,
    1,
    1,
    0,
    0,
    1,
  ]);
  assertEquals(evaluate(constant("site"), data, { domain: "residue" }), [
    "site",
    "site",
  ]);
  assertThrows(() => evaluate(constant(0.5), data), Error, "needs an explicit"); // no domain
});

Deno.test("attribute reads a numeric column on its own domain", () => {
  const data = structure();
  assertEquals([...evaluate(attribute("element"), data)], [6, 7, 8, 16]);
  assertEquals([...evaluate(attribute("bfactor"), data)], [10, 20, 30, 40]);
  assertStrictEquals(attribute("labelSeq").domain, "residue");
  assertEquals([...evaluate(attribute("labelSeq"), data)], [1, 2]);
});

Deno.test("registered scalar and code attributes agree across CPU and GPU bindings", () => {
  const root = structure();
  const data = withAttributes(root, {
    "user:score": {
      domain: "atom",
      kind: "scalar",
      provenance: "user",
      values: Float32Array.of(.25, .5, .75, 1),
    },
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "computed:test",
      values: Uint8Array.of(1, 2),
    },
  });
  const score = attribute("user:score", { domain: "atom" });
  assertEquals([...evaluate(score, data)], [.25, .5, .75, 1]);
  assertEquals([...compile(score).bindings[0].fill(data)], [.25, .5, .75, 1]);
  const codes = categorical(attribute("ssCode"), { 1: 10, 2: 20 }, 0);
  assertEquals([...evaluate(codes, data)], [10, 20]);
  const lifted = attribute("ssCode", { domain: "atom" });
  assertEquals([...evaluate(lifted, data)], [1, 1, 2, 2]);
  const compiled = compile(lifted);
  assertEquals(compiled.bindings.map((b) => b.id), [
    "attr:residue",
    "attr:ssCode",
  ]);
  assertEquals([...compiled.bindings[1].fill(data)], [1, 2]);
  assertMatch(compiled.wgsl, /field_get1\(u32\(field_get0\(row\)\)\)/);
  assertThrows(
    () => attribute("user:score"),
    TypeError,
    "requires options.domain",
  );
  assertThrows(
    () => evaluate(attribute("partialCharge"), data),
    TypeError,
    "missing column partialCharge",
  );
});

Deno.test("categorical maps integer categories with an explicit fallback", () => {
  const data = structure();
  const byElement = categorical(
    attribute("element"),
    { 6: RED, 7: BLUE },
    GREY,
  );
  assertStrictEquals(byElement.type, COLOR);
  assertEquals([...evaluate(byElement, data)], [
    ...RED, // C
    ...BLUE, // N
    ...GREY, // O -> fallback
    ...GREY, // S -> fallback
  ]);
});

Deno.test("linear normalizes over a domain with clamp and wrap overflow", () => {
  const data = structure();
  const norm = numeric(
    evaluate(linear(attribute("bfactor"), { domain: [10, 40] }), data),
  );
  [0, 1 / 3, 2 / 3, 1].forEach((want, i) =>
    assert(near(norm[i], want), `row ${i}: ${norm[i]} != ${want}`)
  );
  // clamp holds ends; a tighter domain saturates
  assertEquals([
    ...evaluate(linear(attribute("bfactor"), { domain: [20, 30] }), data),
  ], [0, 0, 1, 1]);
  // fail policy throws on the CPU for out-of-range input
  assertThrows(
    () =>
      evaluate(
        linear(attribute("bfactor"), { domain: [20, 30], overflow: "fail" }),
        data,
      ),
    Error,
    "outside domain",
  );
});

Deno.test("colormap interpolates a gradient over a scalar input", () => {
  const data = structure();
  const g = colormap(linear(attribute("bfactor"), { domain: [10, 40] }), [[
    0,
    BLUE,
  ], [1, RED]]);
  assertStrictEquals(g.type, COLOR);
  const out = numeric(evaluate(g, data));
  assertEquals([...out.slice(0, 4)], [...BLUE]); // bfactor 10 -> 0 -> blue
  assertEquals([...out.slice(12)], [...RED]); // bfactor 40 -> 1 -> red
  assert(near(out[8], 2 / 3) && near(out[10], 1 / 3)); // bfactor 30 -> 2/3 up the ramp
});

Deno.test("annotation joins external per-row values with an explicit missing policy", () => {
  const data = structure();
  const values = Float32Array.from([100, 0, 200, 0]);
  const missing = Uint8Array.from([1, 0, 1, 0]); // rows 1,3 absent
  const fallbackField = annotation("atom", SCALAR, values, {
    missing,
    policy: "fallback",
    fallback: -1,
  });
  assertEquals([...evaluate(fallbackField, data)], [100, -1, 200, -1]);
  const failField = annotation("atom", SCALAR, values, {
    missing,
    policy: "fail",
  });
  assertThrows(() => evaluate(failField, data), Error, "missing value");
});

Deno.test("an annotation for another structure's rows fails on evaluate and bake", () => {
  const data = structure();
  const short = annotation("atom", SCALAR, Float32Array.from([1, 2, 3]));
  assertThrows(
    () => evaluate(short, data),
    TypeError,
    "has 3 rows; the structure has 4 atom rows",
  );
  const mapped = colormap(short, [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]]);
  const { bindings } = compile(mapped, { target: "link", domain: "atom" });
  assertThrows(() => bindings[0].fill(data), TypeError, "has 3 rows");
});

Deno.test("curve samples a scalar along the global t uniform", () => {
  const data = structure();
  const c = curve([[0, 0], [1, 10]]);
  assertEquals([...evaluate(c, data, { domain: "atom", t: 0 })], [0, 0, 0, 0]);
  assertEquals([...evaluate(c, data, { domain: "atom", t: 0.5 })], [
    5,
    5,
    5,
    5,
  ]);
  assertEquals([...evaluate(c, data, { domain: "atom", t: 2 })], [
    10,
    10,
    10,
    10,
  ]); // clamp
});

Deno.test("rejects wrong types, unknown columns, mixed domains, and CPU-only lowering", () => {
  assertThrows(() => attribute("nope"), Error, "unknown column");
  assertThrows(
    () => categorical(attribute("element"), {}, GREY),
    Error,
    "at least one case",
  );
  assertThrows(
    () => categorical(constant(RED), { 1: RED }, GREY),
    Error,
    "scalar field",
  ); // color input
  assertThrows(
    () => colormap(constant(RED), [[0, BLUE], [1, RED]]),
    Error,
    "scalar field",
  );
  assertMatch(
    (assertThrows(
      () => linear(attribute("element"), { domain: [1, 1] }),
      Error,
    )).message,
    /lo != hi/,
  );
  // string fields and 'fail' overflow do not lower to WGSL
  assertThrows(() => compile(constant("label")), Error, "CPU-only");
  assertThrows(
    () =>
      compile(
        linear(attribute("bfactor"), { domain: [0, 1], overflow: "fail" }),
      ),
    Error,
    "CPU-only",
  );
});

Deno.test("compile emits self-contained WGSL and a plain binding schema (no ShaderSource)", () => {
  const data = structure();
  const byElement = categorical(
    attribute("element"),
    { 6: RED, 7: BLUE },
    GREY,
  );
  const c = compile(byElement);
  assertStrictEquals(c.valueType, COLOR);
  assertStrictEquals(c.domain, "atom");
  assertMatch(c.wgsl, /fn evalField\(row: u32\) -> vec4<f32>/);
  assertMatch(c.wgsl, /var<storage, read> _buf0: array<f32>/);
  assertStrictEquals(c.bindings.length, 1);
  assertStrictEquals(c.bindings[0].kind, "buffer");
  // the link target swaps @group bindings for @link accessors and an @export entry
  const linked = compile(byElement, { target: "link" });
  assertMatch(linked.wgsl, /@link fn field_get0\(i: u32\) -> f32;/);
  assertMatch(linked.wgsl, /@export fn getField\(row: u32\) -> vec4<f32>/);
  assertNotMatch(linked.wgsl, /@group/);
  assertStrictEquals(linked.entry, "getField");
  assertEquals(linked.bindings.map((b) => b.accessor), ["field_get0"]);
  // the binding's fill is a pure function producing the element column as f32
  assertEquals([...c.bindings[0].fill(data)], [6, 7, 8, 16]);
  // a colormap over an attribute needs exactly one input; a curve adds a uniform
  assertStrictEquals(
    compile(
      colormap(linear(attribute("bfactor"), { domain: [10, 40] }), [[0, BLUE], [
        1,
        RED,
      ]]),
    ).bindings.length,
    1,
  );
  const cc = compile(curve([[0, 0], [1, 1]]));
  assertStrictEquals(cc.bindings[0].kind, "uniform");
  assertEquals([...cc.bindings[0].fill({ t: 0.25 })], [0.25]);
});

Deno.test("volumeSample evaluates the volume at each atom and compiles to two buffer inputs", () => {
  const data = structure();
  // Atoms sit at x = 0..3 on the x axis; the grid spans x in [-1, 2].
  const volume = createVolume({
    values: Float32Array.from([0, 10, 20, 30, 0, 10, 20, 30]),
    dims: [4, 2, 1],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1],
  });
  const field = volumeSample(volume);
  assertEquals(field.domain, "atom");
  assertEquals(Array.from(numeric(evaluate(field, data))), [10, 20, 30, 0]);
  const compiled = compile(field, { target: "link", domain: "atom" });
  assertEquals(compiled.bindings.map((b) => [b.id.split(":")[0], b.wgslType]), [
    ["positions", "vec3<f32>"],
    ["volume", "f32"],
  ]);
  assertStrictEquals(compiled.bindings[1].volume, volume);
  assertStrictEquals(compiled.bindings[1].fill(data), volume.values);
  assertEquals(
    Array.from(compiled.bindings[0].fill(data)).slice(0, 8),
    [0, 0, 0, 0, 1, 0, 0, 0],
  );
  // Same volume, same binding id; a colormap over it still compiles.
  assertStrictEquals(
    compile(volumeSample(volume)).bindings[1].id,
    compiled.bindings[1].id,
  );
  compile(
    colormap(volumeSample(volume), [[0, [0, 0, 1, 1]], [30, [1, 0, 0, 1]]]),
  );
});

Deno.test("volumeSample rejects non-volumes and multi-component volumes", () => {
  assertThrows(() => volumeSample({} as never), TypeError, "VolumeData");
  const vector = createVolume({
    values: new Float32Array(6),
    dims: [2, 1, 1],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    components: 3,
  });
  assertThrows(() => volumeSample(vector), TypeError, "volumeComponent");
});

Deno.test("volumeSample() binds the nearest volume by grid and evaluates with { volume }", () => {
  const data = structure();
  const volume = createVolume({
    values: Float32Array.from([0, 10, 20, 30, 0, 10, 20, 30]),
    dims: [4, 2, 1],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1],
  });
  const nearest = volumeSample();
  assert(readsNearestVolume(nearest));
  assert(readsNearestVolume(linear(nearest, { domain: [0, 1] })));
  assert(!readsNearestVolume(volumeSample(volume)));
  assert(!readsNearestVolume(constant(1)));
  // Compiling needs the nearest grid; the viewer passes it.
  assertThrows(() => compile(nearest), TypeError, "options.volume");
  const grid = createVolumeGrid({
    dims: volume.dims,
    transform: volume.transform,
  });
  const compiled = compile(nearest, { target: "link", volume: grid });
  assertEquals(compiled.bindings.map((b) => b.id), [
    "positions",
    "volume:nearest",
  ]);
  assertEquals(compiled.bindings[1].volume, undefined);
  assertThrows(() => compiled.bindings[1].fill(data), TypeError, "viewer");
  // Two samples of the nearest volume share one binding.
  const twice = compile(
    linear(nearest, { domain: [0, 30], range: [0, 1] }),
    { target: "link", volume: grid },
  );
  assertEquals(twice.bindings.length, 2);
  // CPU parity needs an explicit snapshot.
  assertThrows(() => evaluate(nearest, data), TypeError, "{ volume }");
  assertEquals(Array.from(numeric(evaluate(nearest, data, { volume }))), [
    10,
    20,
    30,
    0,
  ]);
});

Deno.test("byPotential is red-white-blue over ±range of the sampled potential", () => {
  const data = structure();
  // Atoms at x = 0..3 sample -15, 0, 15 and outside (0).
  const volume = createVolume({
    values: Float32Array.from([-30, -15, 0, 15, -30, -15, 0, 15]),
    dims: [4, 2, 1],
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1],
  });
  // byCharge's (Mol*'s) stops: red, white, blue.
  const red = [191 / 255, 34 / 255, 34 / 255, 1].map(Math.fround);
  const blue = [51 / 255, 97 / 255, 225 / 255, 1].map(Math.fround);
  const colors = numeric(evaluate(byPotential({ volume }), data));
  assertEquals(Array.from(colors.subarray(0, 4)), red);
  assertEquals(Array.from(colors.subarray(4, 8)), [1, 1, 1, 1]);
  assertEquals(Array.from(colors.subarray(8, 12)), blue);
  assertEquals(Array.from(colors.subarray(12, 16)), [1, 1, 1, 1]);
  // Half of range 30 is halfway from red to white.
  const narrow = numeric(evaluate(byPotential({ volume, range: 30 }), data));
  assert(near(narrow[1], (red[1] + 1) / 2, 1e-5));
  assert(readsNearestVolume(byPotential()));
  assertThrows(() => byPotential({ range: 0 }), TypeError);
});

Deno.test("sampleVolumeGradientWgsl declares a sampler and a zero-at-faces gradient", () => {
  const grid = createVolumeGrid({
    dims: [4, 3, 2],
    transform: [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  const wgsl = sampleVolumeGradientWgsl(grid, "grad", "read");
  assertMatch(wgsl, /fn grad_sample\(p: vec3<f32>\) -> f32/);
  assertMatch(wgsl, /fn grad\(p: vec3<f32>\) -> vec3<f32>/);
  assertMatch(wgsl, /let h = 0\.25;/);
  assertMatch(wgsl, /return vec3<f32>\(0\.0\);/);
});

Deno.test("attribute fields use the table's built-in domain registry", () => {
  for (const [name, domain] of Object.entries(ATTRIBUTE_DOMAINS)) {
    assertEquals(attribute(name).domain, domain, name);
  }
});
