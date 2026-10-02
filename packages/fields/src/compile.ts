// Renderer-free WGSL lowering and binding schema.
import type { StructureData, VolumeData, VolumeGrid } from "@molgpu/table";
import type {
  Binding,
  Color,
  Domain,
  Field,
  Target,
  ValueType,
} from "./types.ts";
import {
  assertField,
  COLOR,
  fail,
  type FieldNode,
  numeric,
  reconcileDomain,
  resolvedAttribute,
  rowCount,
  SCALAR,
  volumeId,
} from "./construction.ts";
import { checkAnnotationRows } from "./evaluation.ts";
import { f32Literal as f32, f32Span } from "./internal-numeric.ts";
import { sampleVolumeWgsl } from "./volume.ts";
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

// ---- WGSL code generation --------------------------------------------------

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
        f32Span(node.lo, node.hi)
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
        }, (x - ${f32(t0)}) / ${f32Span(t0, t1)}); }\n`;
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
          f32Span(lo, hi)
        }) * ${f32Span(lo, hi)};\n`
        : `  let xc = clamp(x, ${f32(lo)}, ${f32(hi)});\n`;
      body += `  if (xc <= ${f32(node.table[0][0])}) { return ${
        f32(node.table[0][1])
      }; }\n`;
      for (let i = 1; i < node.table.length; i++) {
        const [t0, v0] = node.table[i - 1], [t1, v1] = node.table[i];
        body += `  if (xc <= ${f32(t1)}) { return mix(${f32(v0)}, ${
          f32(v1)
        }, (xc - ${f32(t0)}) / ${f32Span(t0, t1)}); }\n`;
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
