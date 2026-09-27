// u71.3 spike: sampling a 256³ scalar volume from a storage buffer (manual
// trilinear) vs a 3D texture (manual textureLoad trilinear, hardware-filtered
// r32float when `float32-filterable` exists, hardware-filtered r16float).
// Raw WebGPU in headless Chrome, no use.gpu. Run:
//   deno run -A docs/findings/evidence/2026-09-26-volume-texture-spike/bench.mjs
import { chromium } from "playwright";

const here = new URL(".", import.meta.url).pathname;
const server = Deno.serve(
  { port: 5194, hostname: "127.0.0.1", onListen() {} },
  () =>
    new Response(
      "<!doctype html><meta charset=utf-8><title>volume spike</title>",
      { headers: { "content-type": "text/html" } },
    ),
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu"],
});
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5194/");
  const result = await page.evaluate(async () => {
    const N = 256, SLICE = 1024, RAYS = 512, STEPS = 256, REPEAT = 20;
    const adapter = await navigator.gpu.requestAdapter();
    const filterable = adapter.features.has("float32-filterable");
    const timestamps = adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({
      requiredFeatures: [
        ...(filterable ? ["float32-filterable"] : []),
        ...(timestamps ? ["timestamp-query"] : []),
      ],
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize: adapter.limits.maxBufferSize,
      },
    });
    const values = new Float32Array(N ** 3);
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          values[i + N * (j + N * k)] = Math.sin(i * 0.05) *
              Math.cos(j * 0.07) + Math.sin(k * 0.03) * 0.5;
        }
      }
    }
    const half = (() => {
      // f32 → f16 bits (round to nearest even is not needed for a spike).
      const f = new Float32Array(1), u = new Uint32Array(f.buffer);
      const out = new Uint16Array(values.length);
      for (let n = 0; n < values.length; n++) {
        f[0] = values[n];
        const x = u[0];
        const sign = (x >>> 16) & 0x8000;
        const exp = ((x >>> 23) & 0xff) - 127 + 15;
        const mant = (x >>> 13) & 0x3ff;
        out[n] = exp <= 0
          ? sign
          : exp >= 31
          ? sign | 0x7c00
          : sign | (exp << 10) | mant;
      }
      return out;
    })();
    const done = () => device.queue.onSubmittedWorkDone();
    const time = async (fn) => {
      await done();
      const t0 = performance.now();
      fn();
      await done();
      return performance.now() - t0;
    };

    // Uploads.
    const upload = {};
    const buffer = device.createBuffer({
      size: values.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    upload.storageMs = await time(() =>
      device.queue.writeBuffer(buffer, 0, values)
    );
    const tex32 = device.createTexture({
      size: [N, N, N],
      dimension: "3d",
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    upload.r32floatMs = await time(() =>
      device.queue.writeTexture(
        { texture: tex32 },
        values,
        { bytesPerRow: N * 4, rowsPerImage: N },
        [N, N, N],
      )
    );
    const tex16 = device.createTexture({
      size: [N, N, N],
      dimension: "3d",
      format: "r16float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    upload.r16floatMs = await time(() =>
      device.queue.writeTexture(
        { texture: tex16 },
        half,
        { bytesPerRow: N * 2, rowsPerImage: N },
        [N, N, N],
      )
    );
    const linear = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      addressModeW: "clamp-to-edge",
    });

    // Each variant defines `fn sampleAt(u: vec3<f32>) -> f32` in index space.
    const variants = {
      storage: {
        decl: `@group(0) @binding(1) var<storage, read> vol: array<f32>;`,
        body: `
fn at(i: vec3<u32>) -> f32 { return vol[i.x + ${N}u * (i.y + ${N}u * i.z)]; }
fn sampleAt(u: vec3<f32>) -> f32 {
  let c = clamp(u, vec3<f32>(0.0), vec3<f32>(${N - 1}.0));
  let b = min(floor(c), vec3<f32>(${N - 2}.0));
  let s = c - b; let i0 = vec3<u32>(b); let i1 = i0 + vec3<u32>(1u);
  let x00 = mix(at(i0), at(vec3<u32>(i1.x, i0.y, i0.z)), s.x);
  let x10 = mix(at(vec3<u32>(i0.x, i1.y, i0.z)), at(vec3<u32>(i1.x, i1.y, i0.z)), s.x);
  let x01 = mix(at(vec3<u32>(i0.x, i0.y, i1.z)), at(vec3<u32>(i1.x, i0.y, i1.z)), s.x);
  let x11 = mix(at(vec3<u32>(i0.x, i1.y, i1.z)), at(i1), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}`,
        bind: [{ binding: 1, resource: { buffer } }],
      },
      textureLoad: {
        decl: `@group(0) @binding(1) var vol: texture_3d<f32>;`,
        body: `
fn at(i: vec3<u32>) -> f32 { return textureLoad(vol, i, 0).x; }
fn sampleAt(u: vec3<f32>) -> f32 {
  let c = clamp(u, vec3<f32>(0.0), vec3<f32>(${N - 1}.0));
  let b = min(floor(c), vec3<f32>(${N - 2}.0));
  let s = c - b; let i0 = vec3<u32>(b); let i1 = i0 + vec3<u32>(1u);
  let x00 = mix(at(i0), at(vec3<u32>(i1.x, i0.y, i0.z)), s.x);
  let x10 = mix(at(vec3<u32>(i0.x, i1.y, i0.z)), at(vec3<u32>(i1.x, i1.y, i0.z)), s.x);
  let x01 = mix(at(vec3<u32>(i0.x, i0.y, i1.z)), at(vec3<u32>(i1.x, i0.y, i1.z)), s.x);
  let x11 = mix(at(vec3<u32>(i0.x, i1.y, i1.z)), at(i1), s.x);
  return mix(mix(x00, x10, s.y), mix(x01, x11, s.y), s.z);
}`,
        bind: [{ binding: 1, resource: tex32.createView() }],
      },
      ...(filterable
        ? {
          r32floatLinear: {
            decl: `@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var smp: sampler;`,
            body: `
fn sampleAt(u: vec3<f32>) -> f32 {
  return textureSampleLevel(vol, smp, (u + vec3<f32>(0.5)) / ${N}.0, 0.0).x;
}`,
            bind: [
              { binding: 1, resource: tex32.createView() },
              { binding: 2, resource: linear },
            ],
          },
        }
        : {}),
      r16floatLinear: {
        decl: `@group(0) @binding(1) var vol: texture_3d<f32>;
@group(0) @binding(2) var smp: sampler;`,
        body: `
fn sampleAt(u: vec3<f32>) -> f32 {
  return textureSampleLevel(vol, smp, (u + vec3<f32>(0.5)) / ${N}.0, 0.0).x;
}`,
        bind: [
          { binding: 1, resource: tex16.createView() },
          { binding: 2, resource: linear },
        ],
      },
    };

    // Slice: an oblique plane through the grid, SLICE² samples.
    const sliceMain = `
@group(0) @binding(0) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= ${SLICE}u || g.y >= ${SLICE}u) { return; }
  let st = vec2<f32>(g.xy) / ${SLICE - 1}.0;
  let u = vec3<f32>(st.x * 255.0, st.y * 255.0, 60.0 + 100.0 * st.x + 30.0 * st.y);
  outp[g.x + g.y * ${SLICE}u] = sampleAt(u);
}`;
    // Raymarch: RAYS² rays, STEPS samples each, maximum-intensity projection.
    const rayMain = `
@group(0) @binding(0) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= ${RAYS}u || g.y >= ${RAYS}u) { return; }
  let st = vec2<f32>(g.xy) / ${RAYS - 1}.0;
  var m = -1e30;
  for (var k = 0u; k < ${STEPS}u; k++) {
    let t = f32(k) / ${STEPS - 1}.0;
    let u = vec3<f32>(st.x * 255.0, st.y * 200.0 + t * 55.0, t * 255.0);
    m = max(m, sampleAt(u));
  }
  outp[g.x + g.y * ${RAYS}u] = m;
}`;

    const run = async (variant, main, width) => {
      const module = device.createShaderModule({
        code: `${variant.decl}\n${variant.body}\n${main}`,
      });
      const info = await module.getCompilationInfo();
      const errors = info.messages.filter((m) => m.type === "error");
      if (errors.length) {
        return { error: errors.map((e) => e.message).join("; ") };
      }
      const pipeline = await device.createComputePipelineAsync({
        layout: "auto",
        compute: { module, entryPoint: "main" },
      });
      const out = device.createBuffer({
        size: width * width * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const group = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: out } }, ...variant.bind],
      });
      const dispatch = () => {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.dispatchWorkgroups(width / 8, width / 8);
        pass.end();
        device.queue.submit([encoder.finish()]);
      };
      dispatch(); // warm-up
      const samples = [];
      for (let r = 0; r < REPEAT; r++) samples.push(await time(dispatch));
      samples.sort((a, b) => a - b);
      const read = device.createBuffer({
        size: width * width * 4,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(out, 0, read, 0, width * width * 4);
      device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const data = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      return { medianMs: samples[REPEAT >> 1], minMs: samples[0], data };
    };

    const results = {};
    for (const [name, variant] of Object.entries(variants)) {
      const slice = await run(variant, sliceMain, SLICE);
      const ray = await run(variant, rayMain, RAYS);
      results[name] = { slice, ray };
    }
    const reference = results.storage;
    const summary = {};
    for (const [name, { slice, ray }] of Object.entries(results)) {
      if (slice.error || ray.error) {
        summary[name] = { error: slice.error ?? ray.error };
        continue;
      }
      let sliceErr = 0, rayErr = 0;
      for (let n = 0; n < slice.data.length; n++) {
        sliceErr = Math.max(
          sliceErr,
          Math.abs(slice.data[n] - reference.slice.data[n]),
        );
      }
      for (let n = 0; n < ray.data.length; n++) {
        rayErr = Math.max(
          rayErr,
          Math.abs(ray.data[n] - reference.ray.data[n]),
        );
      }
      summary[name] = {
        sliceMedianMs: +slice.medianMs.toFixed(3),
        sliceMinMs: +slice.minMs.toFixed(3),
        rayMedianMs: +ray.medianMs.toFixed(3),
        rayMinMs: +ray.minMs.toFixed(3),
        sliceMaxAbsErrVsStorage: sliceErr,
        rayMaxAbsErrVsStorage: rayErr,
      };
    }
    const info = adapter.info ?? {};
    return {
      adapter: { vendor: info.vendor, architecture: info.architecture },
      features: { float32Filterable: filterable, timestampQuery: timestamps },
      grid: `${N}^3`,
      bytes: { f32: values.byteLength, f16: half.byteLength },
      upload: Object.fromEntries(
        Object.entries(upload).map(([k, v]) => [k, +v.toFixed(2)]),
      ),
      workload: {
        slice: `${SLICE}x${SLICE} samples`,
        raymarch: `${RAYS}x${RAYS} rays x ${STEPS} steps`,
        repeat: 20,
        timing: "wall clock around submit + onSubmittedWorkDone",
      },
      summary,
    };
  });
  result.date = new Date().toISOString();
  result.browser = browser.version();
  await Deno.writeTextFile(
    `${here}report.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await server.shutdown();
}
