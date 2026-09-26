// @ts-self-types="./index.d.ts"
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

const fail = (field, message) => { throw new TypeError(`@molgpu/fields ${field}: ${message}`); };

// ---- value types -----------------------------------------------------------

export const SCALAR = Object.freeze({ kind: 'scalar', components: 1, wgsl: 'f32' });
export const COLOR = Object.freeze({ kind: 'color', components: 4, wgsl: 'vec4<f32>' });
export const STRING = Object.freeze({ kind: 'string', components: 0, wgsl: null });
const sameType = (a, b) => a.kind === b.kind;
const numeric = (t) => t.kind === 'scalar' || t.kind === 'color';

// ---- table attribute registry (the only columns a field may read) ----------

const ATTRIBUTES = {
  element:   { domain: 'atom', read: (d) => d.topology.atoms.element },
  occupancy: { domain: 'atom', read: (d) => d.topology.atoms.occupancy },
  bfactor:   { domain: 'atom', read: (d) => d.topology.atoms.bfactor },
  radius:    { domain: 'atom', read: (d) => d.topology.atoms.radius },
  residue:   { domain: 'atom', read: (d) => d.topology.atoms.residue },
  // Derived atom->chain (via residue): a per-atom chain index for byChain.
  atomChain: { domain: 'atom', read: (d) => Uint32Array.from(d.topology.atoms.residue, (r) => d.topology.residues.chain[r]) },
  labelSeq:  { domain: 'residue', read: (d) => d.topology.residues.labelSeq },
  chain:     { domain: 'residue', read: (d) => d.topology.residues.chain },
};

/** Min/max of a column over a dataset, for auto-ranging a built-in field's
 *  domain. Returns [lo, lo+1] for an empty or constant column. */
export function columnRange(data, name) {
  const spec = ATTRIBUTES[name];
  if (!spec) fail('columnRange', `unknown column ${name}; known: ${Object.keys(ATTRIBUTES).join(', ')}`);
  const column = spec.read(data);
  if (!column.length) return [0, 1];
  let lo = Infinity, hi = -Infinity;
  for (const v of column) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return lo === hi ? [lo, lo + 1] : [lo, hi];
}

const rowCount = (domain, data) =>
  domain === 'atom' ? data.topology.atoms.count :
  domain === 'residue' ? data.topology.residues.count :
  fail('domain', `unknown domain ${domain}`);

const reconcileDomain = (a, b, field) => {
  if (a === 'any') return b;
  if (b === 'any') return a;
  if (a !== b) fail(field, `mixes atom and residue domains`);
  return a;
};

// ---- field constructors ----------------------------------------------------

const field = (node) => Object.freeze(node);
const asColorArray = (v, where) => {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => Number.isFinite(x))) fail(where, 'expected [r,g,b,a]');
  return Object.freeze([...v]);
};

/** A single value for every row. Number -> scalar, [r,g,b,a] -> colour, string -> label. */
export function constant(value) {
  if (typeof value === 'number') return field({ kind: 'constant', type: SCALAR, domain: 'any', value });
  if (typeof value === 'string') return field({ kind: 'constant', type: STRING, domain: 'any', value });
  return field({ kind: 'constant', type: COLOR, domain: 'any', value: asColorArray(value, 'constant') });
}

/** Read a numeric table column as a scalar field on that column's domain. */
export function attribute(name) {
  const spec = ATTRIBUTES[name];
  if (!spec) fail('attribute', `unknown column ${name}; known: ${Object.keys(ATTRIBUTES).join(', ')}`);
  return field({ kind: 'attribute', type: SCALAR, domain: spec.domain, name });
}

/**
 * Map an integer-valued scalar input to per-category values, with an explicit
 * fallback for categories not listed. `cases` is { category: value }; every
 * value (and the fallback) must share one type.
 */
export function categorical(input, cases, fallback) {
  assertField(input, 'categorical.input');
  if (input.type.kind !== 'scalar') fail('categorical.input', 'expected a scalar field');
  const entries = Object.entries(cases).map(([k, v]) => [Number(k), v]);
  if (!entries.length) fail('categorical.cases', 'expected at least one case');
  const type = valueType(entries[0][1], 'categorical.cases');
  for (const [, v] of entries) if (!sameType(valueType(v, 'categorical.cases'), type)) fail('categorical.cases', 'all cases must share a type');
  const fb = normalizeValue(fallback, type, 'categorical.fallback');
  const table = entries.map(([category, v]) => [category, normalizeValue(v, type, 'categorical.cases')]);
  return field({ kind: 'categorical', type, domain: input.domain, input, table, fallback: fb });
}

/**
 * Affine map of a scalar input into `range` (default [0,1]) over `domain`
 * [lo,hi]. `overflow` handles inputs outside [lo,hi]: 'clamp' (default) or
 * 'wrap'. 'fail' rejects out-of-range on the CPU and does not lower to GPU.
 */
export function linear(input, { domain: dom, range = [0, 1], overflow = 'clamp' } = {}) {
  assertField(input, 'linear.input');
  if (input.type.kind !== 'scalar') fail('linear.input', 'expected a scalar field');
  if (!Array.isArray(dom) || dom.length !== 2 || dom[0] === dom[1]) fail('linear.domain', 'expected [lo,hi] with lo != hi');
  if (!Array.isArray(range) || range.length !== 2) fail('linear.range', 'expected [a,b]');
  if (!['clamp', 'wrap', 'fail'].includes(overflow)) fail('linear.overflow', 'expected clamp, wrap, or fail');
  return field({ kind: 'linear', type: SCALAR, domain: input.domain, input, lo: dom[0], hi: dom[1], a: range[0], b: range[1], overflow });
}

/** Piecewise-linear colour gradient over a scalar input. `stops` is [[t,color],...]. */
export function colormap(input, stops) {
  assertField(input, 'colormap.input');
  if (input.type.kind !== 'scalar') fail('colormap.input', 'expected a scalar field');
  if (!Array.isArray(stops) || stops.length < 2) fail('colormap.stops', 'expected at least two [t,color] stops');
  const table = stops.map(([t, c], i) => {
    if (!Number.isFinite(t)) fail('colormap.stops', `stop ${i} t must be finite`);
    return [t, asColorArray(c, `colormap.stops[${i}]`)];
  }).sort((x, y) => x[0] - y[0]);
  return field({ kind: 'colormap', type: COLOR, domain: input.domain, input, table });
}

/**
 * Externally supplied per-row values (the shape an annotation join produces).
 * `values` is a typed array (scalar) or length-4N array (colour). `missing` is a
 * boolean mask; absent rows take `fallback` ('fallback' policy) or throw ('fail').
 */
export function annotation(domain, type, values, { missing, policy = 'fallback', fallback } = {}) {
  if (!['atom', 'residue'].includes(domain)) fail('annotation.domain', 'expected atom or residue');
  if (!numeric(type)) fail('annotation.type', 'annotations must be scalar or color');
  if (!['fallback', 'fail'].includes(policy)) fail('annotation.policy', 'expected fallback or fail');
  const fb = policy === 'fallback' ? normalizeValue(fallback ?? (type === COLOR ? [0, 0, 0, 0] : 0), type, 'annotation.fallback') : null;
  return field({ kind: 'annotation', type, domain, values, missing: missing ?? null, policy, fallback: fb });
}

/** A scalar value along the global parameter `t` (uniform, same for every row). */
export function curve(stops, { overflow = 'clamp' } = {}) {
  if (!Array.isArray(stops) || stops.length < 2) fail('curve.stops', 'expected at least two [t,value] stops');
  if (!['clamp', 'wrap'].includes(overflow)) fail('curve.overflow', 'expected clamp or wrap');
  const table = stops.map(([t, v], i) => {
    if (!Number.isFinite(t) || !Number.isFinite(v)) fail('curve.stops', `stop ${i} must be finite`);
    return [t, v];
  }).sort((x, y) => x[0] - y[0]);
  return field({ kind: 'curve', type: SCALAR, domain: 'any', table, overflow });
}

// ---- value helpers ---------------------------------------------------------

function valueType(v, where) {
  if (typeof v === 'number') return SCALAR;
  if (Array.isArray(v)) { asColorArray(v, where); return COLOR; }
  fail(where, 'expected a number or [r,g,b,a]');
}
function normalizeValue(v, type, where) {
  if (type === SCALAR) { if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, 'expected a finite number'); return v; }
  return asColorArray(v, where);
}
const assertField = (f, where) => { if (!f || f.kind === undefined || !f.type) fail(where, 'expected a Field'); };

// ---- CPU evaluation --------------------------------------------------------

const wrap01 = (x) => x - Math.floor(x);

function rowValue(node, data, t, row) {
  switch (node.kind) {
    case 'constant': return node.value;
    case 'attribute': return ATTRIBUTES[node.name].read(data)[row];
    case 'categorical': {
      const key = rowValue(node.input, data, t, row);
      for (const [category, v] of node.table) if (Math.abs(key - category) < 0.5) return v;
      return node.fallback;
    }
    case 'linear': {
      let u = (rowValue(node.input, data, t, row) - node.lo) / (node.hi - node.lo);
      if (u < 0 || u > 1) {
        if (node.overflow === 'fail') fail('linear', `input ${rowValue(node.input, data, t, row)} outside domain`);
        u = node.overflow === 'wrap' ? wrap01(u) : Math.min(1, Math.max(0, u));
      }
      return u * (node.b - node.a) + node.a;
    }
    case 'colormap': return sampleColor(node.table, rowValue(node.input, data, t, row));
    case 'annotation': {
      if (node.missing && !node.missing[row]) {
        if (node.policy === 'fail') fail('annotation', `missing value at row ${row}`);
        return node.fallback;
      }
      if (node.type === COLOR) return [node.values[row * 4], node.values[row * 4 + 1], node.values[row * 4 + 2], node.values[row * 4 + 3]];
      return node.values[row];
    }
    case 'curve': return sampleScalar(node.table, t ?? 0, node.overflow);
    default: fail('field', `unknown field kind ${node.kind}`);
  }
}

function sampleScalar(table, x, overflow) {
  const lo = table[0][0], hi = table[table.length - 1][0];
  if (x <= lo) return overflow === 'wrap' ? sampleScalar(table, lo + wrap01((x - lo) / (hi - lo)) * (hi - lo), 'clamp') : table[0][1];
  if (x >= hi) return overflow === 'wrap' ? sampleScalar(table, lo + wrap01((x - lo) / (hi - lo)) * (hi - lo), 'clamp') : table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) {
    const [t0, v0] = table[i - 1], [t1, v1] = table[i];
    return v0 + (v1 - v0) * (x - t0) / (t1 - t0);
  }
  return table[table.length - 1][1];
}
function sampleColor(table, x) {
  if (x <= table[0][0]) return table[0][1];
  if (x >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) {
    const [t0, c0] = table[i - 1], [t1, c1] = table[i];
    const u = (x - t0) / (t1 - t0);
    return c0.map((c, k) => c + (c1[k] - c) * u);
  }
  return table[table.length - 1][1];
}

/**
 * Evaluate a field over a domain. Numeric fields return a packed Float32Array
 * (rowCount * components); string fields return an array of strings. `domain`
 * overrides a broadcast ('any') field's target domain.
 */
export function evaluate(f, data, { t, domain } = {}) {
  assertField(f, 'evaluate.field');
  const dom = reconcileDomain(f.domain, domain ?? 'any', 'evaluate');
  if (dom === 'any') fail('evaluate.domain', 'a broadcast field needs an explicit { domain }');
  const n = rowCount(dom, data);
  if (f.type === STRING) return Array.from({ length: n }, (_, row) => rowValue(f, data, t, row));
  const c = f.type.components;
  const out = new Float32Array(n * c);
  for (let row = 0; row < n; row++) {
    const v = rowValue(f, data, t, row);
    if (c === 1) out[row] = v; else out.set(v, row * c);
  }
  return out;
}

// ---- WGSL code generation --------------------------------------------------

const f32 = (x) => (Number.isInteger(x) ? `${x}.0` : `${x}`);
const vec4 = (c) => `vec4<f32>(${c.map(f32).join(', ')})`;

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
export function compile(f, { domain, target = 'raw' } = {}) {
  assertField(f, 'compile.field');
  if (!numeric(f.type)) fail('compile', 'string fields are CPU-only and do not lower to WGSL');
  if (!['raw', 'link'].includes(target)) fail('compile.target', 'expected raw or link');
  const dom = reconcileDomain(f.domain, domain ?? 'any', 'compile');
  const ctx = { bindings: [], helpers: [], nextHelper: 0 };
  const { expr, type } = emit(f, ctx);
  const accessors = ctx.bindings.map((b) => accessorDecl(b, target)).join('\n');
  const helpers = ctx.helpers.join('\n');
  const entry = target === 'link' ? 'getField' : 'evalField';
  const head = target === 'link' ? '@export ' : '';
  const parts = [accessors, helpers, `${head}fn ${entry}(row: u32) -> ${type.wgsl} {\n  return ${expr};\n}`].filter(Boolean);
  return Object.freeze({ valueType: type, domain: dom, target, entry, bindings: Object.freeze(ctx.bindings.map(publicBinding)), wgsl: `${parts.join('\n')}\n` });
}

const publicBinding = (b) => Object.freeze({ id: b.id, binding: b.binding, kind: b.kind, wgslType: b.wgslType, accessor: b.name, fill: b.fill });

/** WGSL for one input accessor, in the chosen target's binding convention. */
function accessorDecl(b, target) {
  if (b.kind === 'uniform') {
    return target === 'link'
      ? `@link fn ${b.name}() -> f32;`
      : `@group(0) @binding(${b.binding}) var<uniform> _uni${b.binding}: f32;\nfn ${b.name}() -> f32 { return _uni${b.binding}; }`;
  }
  if (target === 'link') return `@link fn ${b.name}(i: u32) -> ${b.wgslType};`;
  const read = b.wgslType === 'vec4<f32>'
    ? `vec4<f32>(_buf${b.binding}[i*4u], _buf${b.binding}[i*4u+1u], _buf${b.binding}[i*4u+2u], _buf${b.binding}[i*4u+3u])`
    : `_buf${b.binding}[i]`;
  return `@group(0) @binding(${b.binding}) var<storage, read> _buf${b.binding}: array<f32>;\nfn ${b.name}(i: u32) -> ${b.wgslType} { return ${read}; }`;
}

function bufferBinding(ctx, id, wgslType, fill) {
  const binding = ctx.bindings.length;
  const name = `field_get${binding}`;
  ctx.bindings.push({ id, binding, kind: 'buffer', wgslType, fill, name });
  return `${name}(row)`;
}
function uniformBinding(ctx, id, fill) {
  const binding = ctx.bindings.length;
  const name = `field_uni${binding}`;
  ctx.bindings.push({ id, binding, kind: 'uniform', wgslType: 'f32', fill, name });
  return `${name}()`;
}

function emit(node, ctx) {
  switch (node.kind) {
    case 'constant':
      return { expr: node.type === COLOR ? vec4(node.value) : f32(node.value), type: node.type };
    case 'attribute': {
      const call = bufferBinding(ctx, `attr:${node.name}`, 'f32', (data) => Float32Array.from(ATTRIBUTES[node.name].read(data)));
      return { expr: call, type: SCALAR };
    }
    case 'categorical': {
      const inner = emit(node.input, ctx);
      const name = `h_cat${ctx.nextHelper++}`;
      const body = node.table.map(([category, v]) =>
        `  if (abs(x - ${f32(category)}) < 0.5) { return ${node.type === COLOR ? vec4(v) : f32(v)}; }`).join('\n');
      ctx.helpers.push(`fn ${name}(x: f32) -> ${node.type.wgsl} {\n${body}\n  return ${node.type === COLOR ? vec4(node.fallback) : f32(node.fallback)};\n}`);
      return { expr: `${name}(${inner.expr})`, type: node.type };
    }
    case 'linear': {
      if (node.overflow === 'fail') fail('compile', "linear overflow 'fail' is CPU-only and does not lower");
      const inner = emit(node.input, ctx);
      const u = `((${inner.expr}) - ${f32(node.lo)}) / ${f32(node.hi - node.lo)}`;
      const clamped = node.overflow === 'wrap' ? `fract(${u})` : `clamp(${u}, 0.0, 1.0)`;
      return { expr: `(${clamped}) * ${f32(node.b - node.a)} + ${f32(node.a)}`, type: SCALAR };
    }
    case 'colormap': {
      const inner = emit(node.input, ctx);
      const name = `h_cmap${ctx.nextHelper++}`;
      let body = `  if (x <= ${f32(node.table[0][0])}) { return ${vec4(node.table[0][1])}; }\n`;
      for (let i = 1; i < node.table.length; i++) {
        const [t0, c0] = node.table[i - 1], [t1, c1] = node.table[i];
        body += `  if (x <= ${f32(t1)}) { return mix(${vec4(c0)}, ${vec4(c1)}, (x - ${f32(t0)}) / ${f32(t1 - t0)}); }\n`;
      }
      body += `  return ${vec4(node.table[node.table.length - 1][1])};`;
      ctx.helpers.push(`fn ${name}(x: f32) -> vec4<f32> {\n${body}\n}`);
      return { expr: `${name}(${inner.expr})`, type: COLOR };
    }
    case 'annotation': {
      const call = bufferBinding(ctx, `annotation`, node.type.wgsl, (data) => bakeAnnotation(node, rowCount(node.domain, data)));
      return { expr: call, type: node.type };
    }
    case 'curve': {
      const u = uniformBinding(ctx, 'curve:t', ({ t } = {}) => new Float32Array([t ?? 0]));
      const name = `h_curve${ctx.nextHelper++}`;
      const lo = node.table[0][0], hi = node.table[node.table.length - 1][0];
      let body = node.overflow === 'wrap'
        ? `  let xc = ${f32(lo)} + fract((x - ${f32(lo)}) / ${f32(hi - lo)}) * ${f32(hi - lo)};\n`
        : `  let xc = clamp(x, ${f32(lo)}, ${f32(hi)});\n`;
      body += `  if (xc <= ${f32(node.table[0][0])}) { return ${f32(node.table[0][1])}; }\n`;
      for (let i = 1; i < node.table.length; i++) {
        const [t0, v0] = node.table[i - 1], [t1, v1] = node.table[i];
        body += `  if (xc <= ${f32(t1)}) { return mix(${f32(v0)}, ${f32(v1)}, (xc - ${f32(t0)}) / ${f32(t1 - t0)}); }\n`;
      }
      body += `  return ${f32(node.table[node.table.length - 1][1])};`;
      ctx.helpers.push(`fn ${name}(x: f32) -> f32 {\n${body}\n}`);
      return { expr: `${name}(${u})`, type: SCALAR };
    }
    default: fail('compile', `unknown field kind ${node.kind}`);
  }
}

/** Bake an annotation's values + missing policy into a dense f32 array for GPU. */
function bakeAnnotation(node, n) {
  const c = node.type.components;
  const out = new Float32Array(n * c);
  for (let row = 0; row < n; row++) {
    if (node.missing && !node.missing[row]) {
      if (node.policy === 'fail') fail('annotation', `missing value at row ${row}`);
      if (c === 1) out[row] = node.fallback; else out.set(node.fallback, row * c);
    } else if (c === 1) out[row] = node.values[row];
    else out.set([node.values[row * 4], node.values[row * 4 + 1], node.values[row * 4 + 2], node.values[row * 4 + 3]], row * c);
  }
  return out;
}

// Built-in colour presets composed from the primitives above.
export { byElement, byBfactor, bySeq, byChain } from './builtins.mjs';

// Identity-keyed annotation joins that produce annotation fields.
export { joinAnnotation, residueIdentity, chainIdentity } from './annotation-join.mjs';
