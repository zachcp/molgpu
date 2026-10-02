// Pure CPU evaluation and annotation cardinality.
import {
  sampleVolume,
  type StructureData,
  type VolumeData,
} from "@molgpu/table";
import type { Color, Domain, Field } from "./types.ts";
import {
  assertField,
  COLOR,
  fail,
  type FieldNode,
  reconcileDomain,
  resolvedAttribute,
  rowCount,
  STRING,
  type Value,
} from "./construction.ts";
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

/** Reject an annotation whose rows do not match the structure it colours. */
export function checkAnnotationRows(
  node: FieldNode,
  data: StructureData,
): void {
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
