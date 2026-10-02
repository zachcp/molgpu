// @molgpu/fields — typed per-row value descriptions with one pure CPU evaluator
// and a renderer-free WGSL code generator.
//
// A Field<T, Domain> assigns a value of type T to every row of a domain (atom or
// residue). Selections say WHICH rows; fields say WHAT VALUE each row gets — a
// colour, a radius, an opacity, a category. One concept replaces MolViewSpec's
// color / color_from_source x categorical / continuous x domain / overflow
// matrix.
//
// The package is renderer-free: it never imports use.gpu and never returns a
// ShaderSource. `evaluate` computes values on the CPU (for tests, labels, and
// annotation joins); `compile` emits a WGSL string plus a plain-data binding
// schema that the viewer lowers to GPU sources. Numeric/vector fields lower;
// string fields are CPU-only. There is no arbitrary JS->WGSL and no user parser.

import {
  ATTRIBUTE_DOMAINS,
  attributeColumn,
  attributeNames,
  sampleVolume,
  type StructureData,
  type VolumeData,
  type VolumeGrid,
} from "@molgpu/table";
import { sampleVolumeWgsl } from "./volume.ts";
import type {
  Binding,
  Color,
  Domain,
  Field,
  Overflow,
  Target,
  ValueType,
} from "./types.ts";

// Field is opaque in the public types; these are the node kinds only this
// module reads. `Value` is one row's value: a number, a colour, or a label.
type Value = number | Color | string;
type AnyDomain = Domain | "any";
type FieldNode =
  | (Field & { readonly kind: "constant"; readonly value: Value })
  | (Field & {
    readonly kind: "attribute";
    readonly name: string;
    readonly lift: boolean;
  })
  | (Field & {
    readonly kind: "categorical";
    readonly input: FieldNode;
    readonly table: readonly (readonly [number, number | Color])[];
    readonly fallback: number | Color;
  })
  | (Field & {
    readonly kind: "linear";
    readonly input: FieldNode;
    readonly lo: number;
    readonly hi: number;
    readonly a: number;
    readonly b: number;
    readonly overflow: Overflow;
  })
  | (Field & {
    readonly kind: "colormap";
    readonly input: FieldNode;
    readonly table: readonly (readonly [number, Color])[];
  })
  | (Field & {
    readonly kind: "annotation";
    readonly values: ArrayLike<number>;
    readonly missing: ArrayLike<number> | null;
    readonly policy: "fallback" | "fail";
    readonly fallback: number | Color | null;
  })
  | (Field & {
    readonly kind: "volumeSample";
    /** Null: the nearest volume, bound by the viewer (compile's `volume` option). */
    readonly volume: VolumeData | null;
  })
  | (Field & {
    readonly kind: "curve";
    readonly table: readonly (readonly [number, number])[];
    readonly overflow: "clamp" | "wrap";
  });

/** A binding while compiling: the public Binding plus its WGSL accessor name. */
interface PendingBinding extends Omit<Binding, "accessor"> {
  readonly name: string;
}
interface EmitContext {
  readonly bindings: PendingBinding[];
  readonly helpers: string[];
  nextHelper: number;
  /** Grid of the nearest volume, for argument-free `volumeSample()`. */
  readonly nearest?: VolumeGrid;
}

function fail(field: string, message: string): never {
  throw new TypeError(`@molgpu/fields ${field}: ${message}`);
}

// ---- value types -----------------------------------------------------------

export const SCALAR: ValueType = Object.freeze({
  kind: "scalar",
  components: 1,
  wgsl: "f32",
});
export const COLOR: ValueType = Object.freeze({
  kind: "color",
  components: 4,
  wgsl: "vec4<f32>",
});
export const STRING: ValueType = Object.freeze({
  kind: "string",
  components: 0,
  wgsl: null,
});
const sameType = (a: ValueType, b: ValueType): boolean => a.kind === b.kind;
const numeric = (t: ValueType): boolean =>
  t.kind === "scalar" || t.kind === "color";

// Construction needs a domain before there is data. Values live in @molgpu/table.
const KNOWN_DOMAINS = ATTRIBUTE_DOMAINS;
const CUSTOM_ATTRIBUTE = /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/;
const resolvedAttribute = (
  data: StructureData,
  name: string,
  expected?: Domain,
) => {
  const column = attributeColumn(data, name);
  if (!column) {
    fail(
      "attribute",
      `missing column ${name}; available: ${attributeNames(data).join(", ")}`,
    );
  }
  if (expected && column.domain !== expected) {
    fail(
      "attribute",
      `column ${name} has domain ${column.domain}; expected ${expected}`,
    );
  }
  return column;
};

/** Min/max of a column over a dataset, for auto-ranging a built-in field's
 *  domain. Returns [lo, lo+1] for an empty or constant column. */
export function columnRange(
  data: StructureData,
  name: string,
): [number, number] {
  const column = attributeColumn(data, name)?.values;
  if (!column) {
    fail(
      "columnRange",
      `unknown column ${name}; available: ${attributeNames(data).join(", ")}`,
    );
  }
  if (!column.length) return [0, 1];
  let lo = Infinity, hi = -Infinity;
  for (const v of column) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

const rowCount = (domain: string, data: StructureData): number =>
  domain === "atom"
    ? data.topology.atoms.count
    : domain === "residue"
    ? data.topology.residues.count
    : fail("domain", `unknown domain ${domain}`);

const reconcileDomain = (
  a: AnyDomain,
  b: AnyDomain,
  field: string,
): AnyDomain => {
  if (a === "any") return b;
  if (b === "any") return a;
  if (a !== b) fail(field, `mixes atom and residue domains`);
  return a;
};

// ---- field constructors ----------------------------------------------------

const field = (node: FieldNode): Field => Object.freeze(node);
const asColorArray = (v: unknown, where: string): Color => {
  if (
    !Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isFinite(x))
  ) fail(where, "expected [r,g,b,a]");
  return Object.freeze([...v]) as unknown as Color;
};

/** A single value for every row. Number -> scalar, [r,g,b,a] -> colour, string -> label. */
export function constant(value: number | string | Color): Field {
  if (typeof value === "number") {
    return field({ kind: "constant", type: SCALAR, domain: "any", value });
  }
  if (typeof value === "string") {
    return field({ kind: "constant", type: STRING, domain: "any", value });
  }
  return field({
    kind: "constant",
    type: COLOR,
    domain: "any",
    value: asColorArray(value, "constant"),
  });
}

/**
 * Read a numeric table column as a scalar field on that column's domain. A
 * custom `<ns>:<name>` column needs `options.domain`; `lift: true` reads a
 * residue column onto atoms through `atoms.residue` (implicit for built-in
 * residue columns).
 */
export function attribute(
  name: string,
  options: { domain?: Domain; lift?: boolean } = {},
): Field {
  const known = Object.hasOwn(KNOWN_DOMAINS, name)
    ? KNOWN_DOMAINS[name as keyof typeof KNOWN_DOMAINS]
    : undefined;
  if (!known && !CUSTOM_ATTRIBUTE.test(name)) {
    fail(
      "attribute",
      `unknown column ${name}; known: ${Object.keys(KNOWN_DOMAINS).join(", ")}`,
    );
  }
  if (!known && !options.domain) {
    fail("attribute", `custom column ${name} requires options.domain`);
  }
  const domain = options.domain ?? known!;
  // Built-in residue columns lift implicitly; a custom column declares that it
  // is residue-domain with `lift`, because its domain is only known from data.
  const lift = options.lift ?? (known === "residue" && domain === "atom");
  if (lift && (domain !== "atom" || (known && known !== "residue"))) {
    fail("attribute", `lift reads a residue column ${name} onto atoms`);
  }
  if (known && domain !== known && !lift) {
    fail("attribute", `column ${name} has domain ${known}`);
  }
  return field({ kind: "attribute", type: SCALAR, domain, name, lift });
}

/**
 * Map an integer-valued scalar input to per-category values, with an explicit
 * fallback for categories not listed. `cases` is { category: value }; every
 * value (and the fallback) must share one type.
 */
export function categorical(
  input: Field,
  cases: Record<number, number | Color>,
  fallback: number | Color,
): Field {
  assertField(input, "categorical.input");
  if (input.type.kind !== "scalar") {
    fail("categorical.input", "expected a scalar field");
  }
  const entries = Object.entries(cases).map((
    [k, v],
  ): [number, number | Color] => [Number(k), v]);
  if (!entries.length) fail("categorical.cases", "expected at least one case");
  const type = valueType(entries[0][1], "categorical.cases");
  for (const [, v] of entries) {
    if (!sameType(valueType(v, "categorical.cases"), type)) {
      fail("categorical.cases", "all cases must share a type");
    }
  }
  const fb = normalizeValue(fallback, type, "categorical.fallback");
  const table = entries.map((
    [category, v],
  ): [number, number | Color] => [
    category,
    normalizeValue(v, type, "categorical.cases"),
  ]);
  return field({
    kind: "categorical",
    type,
    domain: input.domain,
    input: input as FieldNode,
    table,
    fallback: fb,
  });
}

/**
 * Affine map of a scalar input into `range` (default [0,1]) over `domain`
 * [lo,hi]. `overflow` handles inputs outside [lo,hi]: 'clamp' (default) or
 * 'wrap'. Both domain endpoints map to their corresponding range endpoints;
 * wrap applies only outside the domain, including when its direction reverses.
 * 'fail' rejects out-of-range on the CPU and does not lower to GPU.
 */
export function linear(
  input: Field,
  options: {
    domain: readonly [number, number];
    range?: readonly [number, number];
    overflow?: "clamp" | "wrap" | "fail";
  },
): Field {
  const { domain: dom, range = [0, 1], overflow = "clamp" } = options ?? {};
  assertField(input, "linear.input");
  if (input.type.kind !== "scalar") {
    fail("linear.input", "expected a scalar field");
  }
  if (!Array.isArray(dom) || dom.length !== 2 || dom[0] === dom[1]) {
    fail("linear.domain", "expected [lo,hi] with lo != hi");
  }
  if (!Array.isArray(range) || range.length !== 2) {
    fail("linear.range", "expected [a,b]");
  }
  if (!["clamp", "wrap", "fail"].includes(overflow)) {
    fail("linear.overflow", "expected clamp, wrap, or fail");
  }
  return field({
    kind: "linear",
    type: SCALAR,
    domain: input.domain,
    input: input as FieldNode,
    lo: dom[0],
    hi: dom[1],
    a: range[0],
    b: range[1],
    overflow,
  });
}

/** Piecewise-linear colour gradient over a scalar input. `stops` is [[t,color],...]. */
export function colormap(
  input: Field,
  stops: ReadonlyArray<readonly [number, Color]>,
): Field {
  assertField(input, "colormap.input");
  if (input.type.kind !== "scalar") {
    fail("colormap.input", "expected a scalar field");
  }
  if (!Array.isArray(stops) || stops.length < 2) {
    fail("colormap.stops", "expected at least two [t,color] stops");
  }
  const table = stops.map(([t, c], i): [number, Color] => {
    if (!Number.isFinite(t)) {
      fail("colormap.stops", `stop ${i} t must be finite`);
    }
    return [t, asColorArray(c, `colormap.stops[${i}]`)];
  }).sort((x, y) => x[0] - y[0]);
  return field({
    kind: "colormap",
    type: COLOR,
    domain: input.domain,
    input: input as FieldNode,
    table,
  });
}

/**
 * Externally supplied per-row values (the shape an annotation join produces).
 * `values` is a typed array (scalar) or length-4N array (colour). `missing` is a
 * boolean mask; absent rows take `fallback` ('fallback' policy) or throw ('fail').
 */
export function annotation(
  domain: Domain,
  type: ValueType,
  values: ArrayLike<number>,
  options: {
    missing?: ArrayLike<number> | null;
    policy?: "fallback" | "fail";
    fallback?: number | Color;
  } = {},
): Field {
  const { missing, policy = "fallback", fallback } = options;
  if (!["atom", "residue"].includes(domain)) {
    fail("annotation.domain", "expected atom or residue");
  }
  if (!numeric(type)) {
    fail("annotation.type", "annotations must be scalar or color");
  }
  if (!["fallback", "fail"].includes(policy)) {
    fail("annotation.policy", "expected fallback or fail");
  }
  const fb = policy === "fallback"
    ? normalizeValue(
      fallback ?? (type === COLOR ? [0, 0, 0, 0] : 0),
      type,
      "annotation.fallback",
    )
    : null;
  return field({
    kind: "annotation",
    type,
    domain,
    values,
    missing: missing ?? null,
    policy,
    fallback: fb,
  });
}

/** A scalar value along the global parameter `t` (uniform, same for every row). */
export function curve(
  stops: ReadonlyArray<readonly [number, number]>,
  options: { overflow?: "clamp" | "wrap" } = {},
): Field {
  const { overflow = "clamp" } = options;
  if (!Array.isArray(stops) || stops.length < 2) {
    fail("curve.stops", "expected at least two [t,value] stops");
  }
  if (!["clamp", "wrap"].includes(overflow)) {
    fail("curve.overflow", "expected clamp or wrap");
  }
  const table = stops.map(([t, v], i): [number, number] => {
    if (!Number.isFinite(t) || !Number.isFinite(v)) {
      fail("curve.stops", `stop ${i} must be finite`);
    }
    return [t, v];
  }).sort((x, y) => x[0] - y[0]);
  return field({ kind: "curve", type: SCALAR, domain: "any", table, overflow });
}

const volumeIds = new WeakMap<VolumeData, number>();
let nextVolumeId = 0;
const volumeId = (volume: VolumeData): number => {
  let id = volumeIds.get(volume);
  if (id === undefined) volumeIds.set(volume, id = nextVolumeId++);
  return id;
};

/**
 * Scalar value of a volume at each atom's position: trilinear inside the grid,
 * 0 outside (see `@molgpu/table`'s `sampleVolume`). Compiles to two GPU buffer
 * inputs: `positions` (vec3 per atom; filled 4-strided for the raw target) and `volume:<n>` (the
 * samples; its binding carries the `volume`), so the viewer can bind existing
 * sources instead of uploading a per-row colour.
 *
 * Without an argument it samples the nearest viewer volume (`<Volume>` or
 * `<EField>`): the binding is `volume:nearest`, `compile` takes that volume's
 * grid as `options.volume`, and the viewer binds its live samples. That form
 * is GPU-only; `evaluate` throws and names the explicit form.
 */
export function volumeSample(volume?: VolumeData): Field {
  if (volume === undefined) {
    return field({
      kind: "volumeSample",
      type: SCALAR,
      domain: "atom",
      volume: null,
    });
  }
  if (
    !volume || !(volume.values instanceof Float32Array) ||
    !Array.isArray(volume.dims) || !volume.transform
  ) {
    fail("volumeSample.volume", "expected a VolumeData (see createVolume)");
  }
  if (volume.components !== 1) {
    fail(
      "volumeSample.volume",
      "expected a scalar volume; extract one with volumeComponent",
    );
  }
  return field({ kind: "volumeSample", type: SCALAR, domain: "atom", volume });
}

// ---- value helpers ---------------------------------------------------------

function valueType(v: unknown, where: string): ValueType {
  if (typeof v === "number") return SCALAR;
  if (Array.isArray(v)) {
    asColorArray(v, where);
    return COLOR;
  }
  return fail(where, "expected a number or [r,g,b,a]");
}
function normalizeValue(
  v: unknown,
  type: ValueType,
  where: string,
): number | Color {
  if (type === SCALAR) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      fail(where, "expected a finite number");
    }
    return v;
  }
  return asColorArray(v, where);
}
const assertField = (f: unknown, where: string): void => {
  const node = f as Partial<Field> | null;
  if (!node || node.kind === undefined || !node.type) {
    fail(where, "expected a Field");
  }
};

// ---- CPU evaluation --------------------------------------------------------

const wrap01 = (x: number): number => x - Math.floor(x);

interface RowEnv {
  readonly t?: number;
  /** CPU samples for argument-free `volumeSample()`. */
  readonly volume?: VolumeData;
}

function rowValue(
  node: FieldNode,
  data: StructureData,
  env: RowEnv,
  row: number,
): Value {
  switch (node.kind) {
    case "constant":
      return node.value;
    case "attribute":
      return resolvedAttribute(
        data,
        node.name,
        node.lift ? "residue" : node.domain as Domain,
      ).values[
        node.lift ? data.topology.atoms.residue[row] : row
      ];
    case "categorical": {
      const key = rowValue(node.input, data, env, row) as number;
      for (const [category, v] of node.table) {
        if (Math.abs(key - category) < 0.5) return v;
      }
      return node.fallback;
    }
    case "linear": {
      let u = ((rowValue(node.input, data, env, row) as number) - node.lo) /
        (node.hi - node.lo);
      if (u < 0 || u > 1) {
        if (node.overflow === "fail") {
          fail(
            "linear",
            `input ${rowValue(node.input, data, env, row)} outside domain`,
          );
        }
        u = node.overflow === "wrap" ? wrap01(u) : Math.min(1, Math.max(0, u));
      }
      return u * (node.b - node.a) + node.a;
    }
    case "colormap":
      return sampleColor(
        node.table,
        rowValue(node.input, data, env, row) as number,
      );
    case "annotation": {
      if (node.missing && !node.missing[row]) {
        if (node.policy === "fail") {
          fail("annotation", `missing value at row ${row}`);
        }
        return node.fallback!;
      }
      if (node.type === COLOR) {
        return [
          node.values[row * 4],
          node.values[row * 4 + 1],
          node.values[row * 4 + 2],
          node.values[row * 4 + 3],
        ] as const;
      }
      return node.values[row];
    }
    case "curve":
      return sampleScalar(node.table, env.t ?? 0, node.overflow);
    case "volumeSample": {
      const volume = node.volume ?? env.volume;
      if (!volume) {
        fail(
          "volumeSample",
          "volumeSample() samples the nearest viewer volume; evaluate it with { volume } (e.g. from useVolumeSnapshot) or pass a VolumeData",
        );
      }
      const p = data.positions;
      return sampleVolume(
        volume,
        p[row * 3],
        p[row * 3 + 1],
        p[row * 3 + 2],
      );
    }
    default:
      return fail("field", `unknown field kind ${(node as Field).kind}`);
  }
}

function sampleScalar(
  table: readonly (readonly [number, number])[],
  x: number,
  overflow: "clamp" | "wrap",
): number {
  const lo = table[0][0], hi = table[table.length - 1][0];
  if (x <= lo) {
    return overflow === "wrap"
      ? sampleScalar(
        table,
        lo + wrap01((x - lo) / (hi - lo)) * (hi - lo),
        "clamp",
      )
      : table[0][1];
  }
  if (x >= hi) {
    return overflow === "wrap"
      ? sampleScalar(
        table,
        lo + wrap01((x - lo) / (hi - lo)) * (hi - lo),
        "clamp",
      )
      : table[table.length - 1][1];
  }
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [t0, v0] = table[i - 1], [t1, v1] = table[i];
      return v0 + (v1 - v0) * (x - t0) / (t1 - t0);
    }
  }
  return table[table.length - 1][1];
}
function sampleColor(
  table: readonly (readonly [number, Color])[],
  x: number,
): Color {
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [t0, c0] = table[i - 1], [t1, c1] = table[i];
      const u = (x - t0) / (t1 - t0);
      return c0.map((c, k) => c + (c1[k] - c) * u) as unknown as Color;
    }
  }
  return table[table.length - 1][1];
}

/**
 * Evaluate a field over a domain. Numeric fields return a packed Float32Array
 * (rowCount * components); string fields return an array of strings. `domain`
 * overrides a broadcast ('any') field's target domain.
 */
export function evaluate(
  field: Field,
  data: StructureData,
  ctx: {
    t?: number;
    domain?: Domain;
    /** The volume an argument-free `volumeSample()` reads on the CPU. */
    volume?: VolumeData;
  } = {},
): Float32Array | string[] {
  const f = field as FieldNode;
  const { domain } = ctx;
  const env: RowEnv = { t: ctx.t, volume: ctx.volume };
  assertField(f, "evaluate.field");
  const dom = reconcileDomain(f.domain, domain ?? "any", "evaluate");
  if (dom === "any") {
    fail("evaluate.domain", "a broadcast field needs an explicit { domain }");
  }
  const n = rowCount(dom, data);
  checkAnnotationRows(f, data);
  if (f.type === STRING) {
    return Array.from(
      { length: n },
      (_, row) => rowValue(f, data, env, row) as string,
    );
  }
  const c = f.type.components;
  const out = new Float32Array(n * c);
  for (let row = 0; row < n; row++) {
    const v = rowValue(f, data, env, row);
    if (c === 1) out[row] = v as number;
    else out.set(v as Color, row * c);
  }
  return out;
}

// ---- WGSL code generation --------------------------------------------------

const f32 = (x: number): string => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const vec4 = (c: readonly number[]): string =>
  `vec4<f32>(${c.map(f32).join(", ")})`;

/**
 * Lower a numeric field to WGSL plus a plain-data binding schema. Returns
 * `{ valueType, domain, bindings, wgsl }`. `bindings` describe storage/uniform
 * inputs the shader needs and how to fill each from data (pure functions, not
 * ShaderSources). Two targets: `raw` (default) emits a self-contained module
 * with `@group(0)` bindings and `fn evalField(row) -> T`, runnable in a plain
 * WebGPU compute pass; `link` emits `@link fn` accessors and `@export fn
 * getField(row) -> T` for the use.gpu shader linker (the viewer binds the
 * accessors to sources/uniforms in `bindings` order). No ShaderSource either way.
 */
export function compile(
  field: Field,
  options: {
    domain?: Domain;
    target?: "raw" | "link";
    /** The grid argument-free `volumeSample()` samples (the viewer's nearest volume). */
    volume?: VolumeGrid;
  } = {},
): {
  readonly valueType: ValueType;
  readonly domain: Domain | "any";
  readonly target: "raw" | "link";
  readonly entry: "evalField" | "getField";
  readonly bindings: readonly {
    readonly id: string;
    readonly binding: number;
    readonly kind: "buffer" | "uniform";
    readonly wgslType: string;
    readonly accessor: string;
    readonly fill: (
      source: StructureData | { t?: number },
    ) => Float32Array;
    readonly volume?: VolumeData;
  }[];
  readonly wgsl: string;
} {
  const f = field as FieldNode;
  const { domain, target = "raw", volume: nearest } = options;
  assertField(f, "compile.field");
  if (!numeric(f.type)) {
    fail("compile", "string fields are CPU-only and do not lower to WGSL");
  }
  if (!["raw", "link"].includes(target)) {
    fail("compile.target", "expected raw or link");
  }
  const dom = reconcileDomain(f.domain, domain ?? "any", "compile");
  const ctx: EmitContext = {
    bindings: [],
    helpers: [],
    nextHelper: 0,
    ...(nearest ? { nearest } : {}),
  };
  const { expr, type } = emit(f, ctx);
  const accessors = ctx.bindings.map((b) => accessorDecl(b, target)).join("\n");
  const helpers = ctx.helpers.join("\n");
  const entry = target === "link" ? "getField" : "evalField";
  const head = target === "link" ? "@export " : "";
  const parts = [
    accessors,
    helpers,
    `${head}fn ${entry}(row: u32) -> ${type.wgsl} {\n  return ${expr};\n}`,
  ].filter(Boolean);
  return Object.freeze({
    valueType: type,
    domain: dom,
    target,
    entry,
    bindings: Object.freeze(ctx.bindings.map(publicBinding)),
    wgsl: `${parts.join("\n")}\n`,
  });
}

const publicBinding = (b: PendingBinding): Binding =>
  Object.freeze({
    id: b.id,
    binding: b.binding,
    kind: b.kind,
    wgslType: b.wgslType,
    accessor: b.name,
    fill: b.fill,
    ...(b.volume ? { volume: b.volume } : {}),
  });

/** WGSL for one input accessor, in the chosen target's binding convention. */
function accessorDecl(b: PendingBinding, target: Target): string {
  if (b.kind === "uniform") {
    return target === "link"
      ? `@link fn ${b.name}() -> f32;`
      : `@group(0) @binding(${b.binding}) var<uniform> _uni${b.binding}: f32;\nfn ${b.name}() -> f32 { return _uni${b.binding}; }`;
  }
  if (target === "link") return `@link fn ${b.name}(i: u32) -> ${b.wgslType};`;
  const read = b.wgslType === "vec4<f32>"
    ? `vec4<f32>(_buf${b.binding}[i*4u], _buf${b.binding}[i*4u+1u], _buf${b.binding}[i*4u+2u], _buf${b.binding}[i*4u+3u])`
    : b.wgslType === "vec3<f32>"
    ? `vec3<f32>(_buf${b.binding}[i*4u], _buf${b.binding}[i*4u+1u], _buf${b.binding}[i*4u+2u])`
    : `_buf${b.binding}[i]`;
  return `@group(0) @binding(${b.binding}) var<storage, read> _buf${b.binding}: array<f32>;\nfn ${b.name}(i: u32) -> ${b.wgslType} { return ${read}; }`;
}

function bufferBinding(
  ctx: EmitContext,
  id: string,
  wgslType: string,
  fill: (data: StructureData) => Float32Array,
): string {
  const binding = ctx.bindings.length;
  const name = `field_get${binding}`;
  ctx.bindings.push({
    id,
    binding,
    kind: "buffer",
    wgslType,
    fill: fill as Binding["fill"],
    name,
  });
  return `${name}(row)`;
}
function uniformBinding(
  ctx: EmitContext,
  id: string,
  fill: (source: { t?: number }) => Float32Array,
): string {
  const binding = ctx.bindings.length;
  const name = `field_uni${binding}`;
  ctx.bindings.push({
    id,
    binding,
    kind: "uniform",
    wgslType: "f32",
    fill: fill as Binding["fill"],
    name,
  });
  return `${name}()`;
}

function emit(
  node: FieldNode,
  ctx: EmitContext,
): { expr: string; type: ValueType } {
  switch (node.kind) {
    case "constant":
      return {
        expr: node.type === COLOR
          ? vec4(node.value as Color)
          : f32(node.value as number),
        type: node.type,
      };
    case "attribute": {
      const { name, lift } = node;
      const residue = lift
        ? bufferBinding(
          ctx,
          "attr:residue",
          "f32",
          (data) =>
            Float32Array.from(resolvedAttribute(data, "residue").values),
        )
        : null;
      const call = bufferBinding(
        ctx,
        `attr:${name}`,
        "f32",
        (data) =>
          Float32Array.from(
            resolvedAttribute(
              data,
              name,
              lift ? "residue" : node.domain as Domain,
            ).values,
          ),
      );
      return {
        expr: residue ? call.replace("(row)", `(u32(${residue}))`) : call,
        type: SCALAR,
      };
    }
    case "categorical": {
      const inner = emit(node.input, ctx);
      const name = `h_cat${ctx.nextHelper++}`;
      const body = node.table.map(([category, v]) =>
        `  if (abs(x - ${f32(category)}) < 0.5) { return ${
          node.type === COLOR ? vec4(v as Color) : f32(v as number)
        }; }`
      ).join("\n");
      ctx.helpers.push(
        `fn ${name}(x: f32) -> ${node.type.wgsl} {\n${body}\n  return ${
          node.type === COLOR
            ? vec4(node.fallback as Color)
            : f32(node.fallback as number)
        };\n}`,
      );
      return { expr: `${name}(${inner.expr})`, type: node.type };
    }
    case "linear": {
      if (node.overflow === "fail") {
        fail(
          "compile",
          "linear overflow 'fail' is CPU-only and does not lower",
        );
      }
      const inner = emit(node.input, ctx);
      const u = `((${inner.expr}) - ${f32(node.lo)}) / ${
        f32(node.hi - node.lo)
      }`;
      let clamped: string;
      if (node.overflow === "wrap") {
        const name = `h_wrap${ctx.nextHelper++}`;
        ctx.helpers.push(
          `fn ${name}(u: f32) -> f32 {
  return select(u, fract(u), u < 0.0 || u > 1.0);
}`,
        );
        clamped = `${name}(${u})`;
      } else clamped = `clamp(${u}, 0.0, 1.0)`;
      return {
        expr: `(${clamped}) * ${f32(node.b - node.a)} + ${f32(node.a)}`,
        type: SCALAR,
      };
    }
    case "colormap": {
      const inner = emit(node.input, ctx);
      const name = `h_cmap${ctx.nextHelper++}`;
      let body = `  if (x <= ${f32(node.table[0][0])}) { return ${
        vec4(node.table[0][1])
      }; }\n`;
      for (let i = 1; i < node.table.length; i++) {
        const [t0, c0] = node.table[i - 1], [t1, c1] = node.table[i];
        body += `  if (x <= ${f32(t1)}) { return mix(${vec4(c0)}, ${
          vec4(c1)
        }, (x - ${f32(t0)}) / ${f32(t1 - t0)}); }\n`;
      }
      body += `  return ${vec4(node.table[node.table.length - 1][1])};`;
      ctx.helpers.push(`fn ${name}(x: f32) -> vec4<f32> {\n${body}\n}`);
      return { expr: `${name}(${inner.expr})`, type: COLOR };
    }
    case "annotation": {
      const call = bufferBinding(
        ctx,
        `annotation`,
        node.type.wgsl!,
        (data) => bakeAnnotation(node, data),
      );
      return { expr: call, type: node.type };
    }
    case "curve": {
      const u = uniformBinding(
        ctx,
        "curve:t",
        ({ t } = {}) => new Float32Array([t ?? 0]),
      );
      const name = `h_curve${ctx.nextHelper++}`;
      const lo = node.table[0][0], hi = node.table[node.table.length - 1][0];
      let body = node.overflow === "wrap"
        ? `  let xc = ${f32(lo)} + fract((x - ${f32(lo)}) / ${
          f32(hi - lo)
        }) * ${f32(hi - lo)};\n`
        : `  let xc = clamp(x, ${f32(lo)}, ${f32(hi)});\n`;
      body += `  if (xc <= ${f32(node.table[0][0])}) { return ${
        f32(node.table[0][1])
      }; }\n`;
      for (let i = 1; i < node.table.length; i++) {
        const [t0, v0] = node.table[i - 1], [t1, v1] = node.table[i];
        body += `  if (xc <= ${f32(t1)}) { return mix(${f32(v0)}, ${
          f32(v1)
        }, (xc - ${f32(t0)}) / ${f32(t1 - t0)}); }\n`;
      }
      body += `  return ${f32(node.table[node.table.length - 1][1])};`;
      ctx.helpers.push(`fn ${name}(x: f32) -> f32 {\n${body}\n}`);
      return { expr: `${name}(${u})`, type: SCALAR };
    }
    case "volumeSample": {
      // vec3 per atom; the raw target reads it from a vec4-strided buffer.
      const position = bufferBinding(ctx, "positions", "vec3<f32>", (data) => {
        const n = data.topology.atoms.count, out = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          out.set(data.positions.subarray(i * 3, i * 3 + 3), i * 4);
        }
        return out;
      });
      const { volume } = node;
      const grid = volume ?? ctx.nearest;
      if (!grid) {
        fail(
          "compile",
          "volumeSample() needs the nearest volume's grid (options.volume); the viewer supplies it under <Volume> or <EField>",
        );
      }
      const id = volume ? `volume:${volumeId(volume)}` : "volume:nearest";
      const existing = ctx.bindings.find((b) => b.id === id);
      const binding = existing?.binding ?? ctx.bindings.length;
      const read = existing?.name ?? `field_get${binding}`;
      if (!existing) {
        ctx.bindings.push({
          id,
          binding,
          kind: "buffer",
          wgslType: "f32",
          fill: (volume ? () => volume.values : () =>
            fail(
              "volumeSample",
              "the nearest volume's samples are bound by the viewer, not filled",
            )) as Binding["fill"],
          name: read,
          ...(volume ? { volume } : {}),
        });
      }
      const name = `h_volume${ctx.nextHelper++}`;
      ctx.helpers.push(sampleVolumeWgsl(grid, name, read));
      return { expr: `${name}(${position})`, type: SCALAR };
    }
    default:
      return fail("compile", `unknown field kind ${(node as Field).kind}`);
  }
}

/** True when `field` contains an argument-free `volumeSample()`. */
export function readsNearestVolume(field: Field): boolean {
  const node = field as FieldNode;
  if (node.kind === "volumeSample") return node.volume === null;
  return "input" in node && readsNearestVolume(node.input);
}

/** Reject an annotation whose rows do not match the structure it colours. */
function checkAnnotationRows(node: FieldNode, data: StructureData): void {
  if (node.kind === "annotation") {
    const n = rowCount(node.domain, data), c = node.type.components;
    if (
      node.values.length !== n * c ||
      (node.missing && node.missing.length !== n)
    ) {
      fail(
        "annotation",
        `has ${
          Math.floor(node.values.length / c)
        } rows; the structure has ${n} ${node.domain} rows`,
      );
    }
  } else if ("input" in node) checkAnnotationRows(node.input, data);
}

/** Bake an annotation's values + missing policy into a dense f32 array for GPU. */
function bakeAnnotation(
  node: Extract<FieldNode, { kind: "annotation" }>,
  data: StructureData,
): Float32Array {
  checkAnnotationRows(node, data);
  const n = rowCount(node.domain, data);
  const c = node.type.components;
  const out = new Float32Array(n * c);
  for (let row = 0; row < n; row++) {
    if (node.missing && !node.missing[row]) {
      if (node.policy === "fail") {
        fail("annotation", `missing value at row ${row}`);
      }
      if (c === 1) out[row] = node.fallback as number;
      else out.set(node.fallback as Color, row * c);
    } else if (c === 1) out[row] = node.values[row];
    else {out.set([
        node.values[row * 4],
        node.values[row * 4 + 1],
        node.values[row * 4 + 2],
        node.values[row * 4 + 3],
      ], row * c);}
  }
  return out;
}
