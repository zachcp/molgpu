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
  type StructureData,
  type VolumeData,
} from "@molgpu/table";
import type { Color, Domain, Field, Overflow, ValueType } from "./types.ts";
// Field is opaque in the public types; these are the node kinds only this
// implementation reads. `Value` is one row's value: a number, a colour, or a label.
export type Value = number | Color | string;
export type AnyDomain = Domain | "any";
export type FieldNode =
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

export function fail(field: string, message: string): never {
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
export const numeric = (t: ValueType): boolean =>
  t.kind === "scalar" || t.kind === "color";

// Construction needs a domain before there is data. Values live in @molgpu/table.
const KNOWN_DOMAINS = ATTRIBUTE_DOMAINS;
const CUSTOM_ATTRIBUTE = /^[a-z][a-z0-9-]*:[A-Za-z][A-Za-z0-9_-]*$/;
export const resolvedAttribute = (
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

export const rowCount = (domain: string, data: StructureData): number =>
  domain === "atom"
    ? data.topology.atoms.count
    : domain === "residue"
    ? data.topology.residues.count
    : fail("domain", `unknown domain ${domain}`);

export const reconcileDomain = (
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
    !Array.isArray(v) || v.length !== 4 ||
    !Array.from(v).every((x) => Number.isFinite(x))
  ) fail(where, "expected [r,g,b,a]");
  return Object.freeze([...v]) as unknown as Color;
};

/** A single value for every row. Number -> scalar, [r,g,b,a] -> colour, string -> label. */
export function constant(value: number | string | Color): Field {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("constant", "expected a finite number");
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
  for (const [category, v] of entries) {
    if (!Number.isFinite(category)) {
      fail("categorical.cases", "category must be finite");
    }
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
  if (
    !Array.isArray(dom) || dom.length !== 2 || !Number.isFinite(dom[0]) ||
    !Number.isFinite(dom[1]) ||
    dom[0] === dom[1]
  ) {
    fail("linear.domain", "expected finite [lo,hi] with lo != hi");
  }
  if (
    !Array.isArray(range) || range.length !== 2 || !Number.isFinite(range[0]) ||
    !Number.isFinite(range[1])
  ) {
    fail("linear.range", "expected finite [a,b]");
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
export const volumeId = (volume: VolumeData): number => {
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
export const assertField = (f: unknown, where: string): void => {
  const node = f as Partial<Field> | null;
  if (!node || node.kind === undefined || !node.type) {
    fail(where, "expected a Field");
  }
};

/** True when `field` contains an argument-free `volumeSample()`. */
export function readsNearestVolume(field: Field): boolean {
  const node = field as FieldNode;
  if (node.kind === "volumeSample") return node.volume === null;
  return "input" in node && readsNearestVolume(node.input);
}
