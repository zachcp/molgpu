// GPU parity for @molgpu/dynamics WGSL: Philox words bitwise, inverse-CDF
// normals within 1e-5, and the Langevin integrator against the CPU-f32
// reference, with two GPU runs bitwise equal. Node computes the references;
// the browser runs the package's WGSL in raw WebGPU (no use.gpu).
import { assert, assertEquals } from "@std/assert";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "../../viewer/test/webgpu-browser-args.mjs";
import { langevinInit, langevinParams, langevinStep } from "../src/index.ts";
import { philox4x32, philoxNormal, philoxWgsl } from "../src/philox.ts";
import {
  LANGEVIN_PARAMS_BYTES,
  langevinBuffers,
  langevinUniform,
  langevinWgsl,
} from "../src/wgsl.ts";
import { toyNetwork } from "./langevin-fixture.ts";

const COUNTERS = 10_000, SEED = 5, STEP = 11, STEPS = 100;

/** Raw WebGPU in the page: Philox words, normals, and two integrator runs. */
async function onPage({ philoxModule, counters, langevin }) {
  if (!navigator.gpu) return { error: "no webgpu" };
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  const errors = [];
  device.addEventListener(
    "uncapturederror",
    (e) => errors.push(e.error.message),
  );
  const S = GPUBufferUsage.STORAGE,
    C = GPUBufferUsage.COPY_SRC,
    D = GPUBufferUsage.COPY_DST,
    U = GPUBufferUsage.UNIFORM;
  const compile = async (code) => {
    const module = device.createShaderModule({ code });
    const info = await module.getCompilationInfo();
    const bad = info.messages.filter((m) => m.type === "error");
    if (bad.length) {
      throw new Error(bad.map((m) => `${m.lineNum}: ${m.message}`).join(" | "));
    }
    return module;
  };
  const buffer = (data, usage) => {
    const b = device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: usage | D,
    });
    device.queue.writeBuffer(b, 0, data);
    return b;
  };
  const read = async (src, bytes) => {
    const out = device.createBuffer({
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | D,
    });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, out, 0, bytes);
    device.queue.submit([enc.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const copy = out.getMappedRange().slice(0);
    out.unmap();
    out.destroy();
    return copy;
  };

  // Philox words and normals per counter.
  const pm = await compile(philoxModule);
  const words = device.createBuffer({ size: counters * 16, usage: S | C });
  const normals = device.createBuffer({ size: counters * 16, usage: S | C });
  const pp = device.createComputePipeline({
    layout: "auto",
    compute: { module: pm, entryPoint: "main" },
  });
  const pg = device.createBindGroup({
    layout: pp.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: words } }, {
      binding: 1,
      resource: { buffer: normals },
    }],
  });
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pp);
  pass.setBindGroup(0, pg);
  pass.dispatchWorkgroups(Math.ceil(counters / 64));
  pass.end();
  device.queue.submit([enc.finish()]);
  const gpuWords = [...new Uint32Array(await read(words, counters * 16))];
  const gpuNormals = [...new Float32Array(await read(normals, counters * 16))];

  // Langevin: explicit layout so every entry point shares one bind group.
  const lm = await compile(langevin.wgsl);
  const storage = (type) => ({
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type },
  });
  const layout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: "uniform" },
      },
      { ...storage("storage"), binding: 1 },
      { ...storage("read-only-storage"), binding: 2 },
      { ...storage("read-only-storage"), binding: 3 },
      { ...storage("read-only-storage"), binding: 4 },
      { ...storage("storage"), binding: 5 },
      { ...storage("storage"), binding: 6 },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [layout],
  });
  const pipeline = (entryPoint) =>
    device.createComputePipeline({
      layout: pipelineLayout,
      compute: { module: lm, entryPoint },
    });
  const [bao, finish, drift, forces, forcesKick] = [
    "langevinBao",
    "langevinFinish",
    "langevinDrift",
    "langevinForces",
    "langevinForcesKick",
  ].map(pipeline);
  const run = async () => {
    const state = buffer(new Float32Array(langevin.state), S | C);
    const group = device.createBindGroup({
      layout,
      entries: [
        buffer(new Uint8Array(langevin.uniform), U),
        state,
        buffer(new Float32Array(langevin.nodes), S),
        buffer(new Uint32Array(langevin.csr), S),
        buffer(new Float32Array(langevin.restLength), S),
        device.createBuffer({ size: 4 * langevin.scratchFloats, usage: S }),
        buffer(new Uint32Array([0]), S | C),
      ].map((b, binding) => ({ binding, resource: { buffer: b } })),
    });
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, group);
    const node = (p) => {
      pass.setPipeline(p);
      pass.dispatchWorkgroups(langevin.workgroups);
    };
    node(forces);
    for (let s = 0; s < langevin.steps; s++) {
      node(bao);
      pass.setPipeline(finish);
      pass.dispatchWorkgroups(1);
      node(drift);
      node(forcesKick);
    }
    pass.end();
    device.queue.submit([enc.finish()]);
    return [...new Float32Array(await read(state, langevin.state.length * 4))];
  };
  const first = await run();
  const second = await run();
  await device.queue.onSubmittedWorkDone();
  return { gpuWords, gpuNormals, first, second, errors };
}

Deno.test("dynamics GPU parity: Philox, normals and Langevin", async () => {
  const philoxModule = `${philoxWgsl}
@group(0) @binding(0) var<storage, read_write> words: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read_write> normals: array<vec4<f32>>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= ${COUNTERS}u) { return; }
  let w = philox4x32(vec4<u32>(gid.x, 0u, 0u, 0u), vec2<u32>(${SEED}u, ${STEP}u));
  words[gid.x] = w;
  normals[gid.x] = vec4<f32>(philoxNormal(w.x), philoxNormal(w.y), philoxNormal(w.z), philoxNormal(w.w));
}`;
  const cpuWords = [], cpuNormals = [];
  for (let i = 0; i < COUNTERS; i++) {
    const w = philox4x32([i, 0, 0, 0], [SEED, STEP]);
    cpuWords.push(...w);
    cpuNormals.push(...[...w].map(philoxNormal));
  }

  const { system } = toyNetwork();
  const params = langevinParams(system, { seed: 7 });
  const packed = langevinBuffers(system);
  const cpu = langevinInit(system, params, "f32");
  langevinStep(system, params, cpu, STEPS);
  assertEquals(
    LANGEVIN_PARAMS_BYTES,
    langevinUniform(system, params).byteLength,
  );
  const langevin = {
    wgsl: langevinWgsl,
    uniform: [...new Uint8Array(langevinUniform(system, params))],
    nodes: [...packed.nodes],
    csr: [...packed.csr],
    restLength: [...packed.restLength],
    state: [...packed.state],
    scratchFloats: packed.scratchFloats,
    workgroups: packed.workgroups,
    steps: STEPS,
  };

  const server = Deno.serve(
    { port: 5193, hostname: "127.0.0.1", onListen() {} },
    () =>
      new Response(
        "<!doctype html><meta charset=utf-8><title>dynamics gpu</title>",
        {
          headers: { "content-type": "text/html" },
        },
      ),
  );
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto("http://127.0.0.1:5193/");
    const out = await page.evaluate(onPage, {
      philoxModule,
      counters: COUNTERS,
      langevin,
    });
    assert(!out.error, out.error);
    assertEquals(pageErrors, []);
    assertEquals(out.errors, [], "uncaptured WebGPU errors");

    assertEquals(out.gpuWords, cpuWords, "Philox words differ");
    let worst = 0;
    for (let i = 0; i < cpuNormals.length; i++) {
      worst = Math.max(worst, Math.abs(out.gpuNormals[i] - cpuNormals[i]));
    }
    console.log(`normals: max |GPU - CPU| = ${worst.toExponential(2)}`);
    assert(worst <= 1e-5, `normals differ by ${worst}`);

    assertEquals(out.first, out.second, "two GPU runs differ");
    const n = system.springs.nodeCount;
    let sum = 0;
    for (let i = 0; i < 3 * n; i++) sum += (out.first[i] - cpu.x[i]) ** 2;
    const rms = Math.sqrt(sum / n);
    console.log(
      `Langevin ${STEPS} steps: GPU vs CPU-f32 RMS ${rms.toExponential(2)} Å`,
    );
    assert(rms <= 1e-4, `GPU vs CPU-f32 RMS ${rms} Å`);
    assert(out.first.slice(0, 3 * n).every(Number.isFinite));
  } finally {
    await browser.close();
    await server.shutdown();
  }
});
