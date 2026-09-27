// Proves the acceptance invariant: a field's WGSL evaluates the same as its CPU
// evaluator, within tolerance. Node compiles each field and computes the CPU
// reference; the browser runs the generated WGSL in a raw-WebGPU compute pass
// (no use.gpu) and reads the result back for comparison.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";
import {
  annotation,
  attribute,
  byCharge,
  bySecondaryStructure,
  categorical,
  COLOR,
  colormap,
  compile,
  curve,
  evaluate,
  linear,
  volumeSample,
} from "../src/index.ts";
import {
  createVolume,
  sampleVolume,
  volumeIndexToWorld,
  withAttributes,
} from "@molgpu/table";
import { structure } from "./fixture.ts";

Deno.test("fields GPU parity", async () => {
  const RED = [1, 0, 0, 1], BLUE = [0, 0, 1, 1], GREY = [0.5, 0.5, 0.5, 1];
  const base = structure();
  const data = withAttributes(base, {
    "user:score": {
      domain: "atom",
      kind: "scalar",
      provenance: "user",
      values: Float32Array.from(
        { length: base.topology.atoms.count },
        (_, i) => i / 3,
      ),
    },
    ssCode: {
      domain: "residue",
      kind: "code",
      provenance: "computed:test",
      values: Uint8Array.from(
        { length: base.topology.residues.count },
        (_, i) => i % 3,
      ),
    },
    partialCharge: {
      domain: "atom",
      kind: "scalar",
      provenance: "user",
      values: Float32Array.from(
        { length: base.topology.atoms.count },
        (_, i) => (i % 5) * 0.6 - 1.2,
      ),
    },
    "charge:residueNet": {
      domain: "residue",
      kind: "scalar",
      provenance: "computed:test",
      values: Float32Array.from(
        { length: base.topology.residues.count },
        (_, i) => i - 1,
      ),
    },
  });
  const atoms = data.topology.atoms.count;

  // Each case: a field, the domain it evaluates over, and any t uniform.
  const cases = {
    customScalar: {
      field: attribute("user:score", { domain: "atom" }),
      domain: "atom",
    },
    liftedResidueCode: {
      field: attribute("ssCode", { domain: "atom" }),
      domain: "atom",
    },
    byCharge: { field: byCharge(), domain: "atom" },
    bySecondaryStructure: { field: bySecondaryStructure(), domain: "atom" },
    liftedCustomResidueNet: {
      field: byCharge({ column: "charge:residueNet", lift: true }),
      domain: "atom",
    },
    byElement: {
      field: categorical(attribute("element"), {
        6: RED,
        7: BLUE,
        8: [0.9, 0.3, 0.2, 1],
        16: [0.95, 0.8, 0.3, 1],
      }, GREY),
      domain: "atom",
    },
    bfactorRamp: {
      field: colormap(linear(attribute("bfactor"), { domain: [10, 40] }), [
        [0, BLUE],
        [0.5, GREY],
        [1, RED],
      ]),
      domain: "atom",
    },
    radiusScale: {
      field: linear(attribute("radius"), {
        domain: [1.5, 1.8],
        range: [0.2, 1],
      }),
      domain: "atom",
    },
    annotationColor: {
      field: annotation("atom", COLOR, Float32Array.from(atomColors()), {}),
      domain: "atom",
    },
    clock: {
      field: curve([[0, 0], [0.5, 1], [1, 0]]),
      domain: "atom",
      t: 0.25,
    },
  };

  function atomColors() {
    const out = [];
    for (let i = 0; i < atoms; i++) out.push(i / 10, 0.2, 0.3, 1);
    return out;
  }

  const n = (
    domain,
  ) => (domain === "atom"
    ? data.topology.atoms.count
    : data.topology.residues.count);

  // Build the compute module and payload for each case on the Node side.
  const jobs = Object.entries(cases).map(([name, { field, domain, t }]) => {
    const compiled = compile(field, { domain });
    const components = compiled.valueType.components;
    const rows = n(domain);
    const K = compiled.bindings.length;
    const write = components === 4
      ? "outp[row*4u+0u]=v.x; outp[row*4u+1u]=v.y; outp[row*4u+2u]=v.z; outp[row*4u+3u]=v.w;"
      : "outp[row]=v;";
    const wgsl = `${compiled.wgsl}
@group(0) @binding(${K}) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= ${rows}u) { return; }
  let v = evalField(row);
  ${write}
}`;
    const inputs = compiled.bindings.map((b) => ({
      binding: b.binding,
      kind: b.kind,
      data: [...b.fill(b.kind === "uniform" ? { t } : data)],
    }));
    const cpu = [...evaluate(field, data, { domain, t })];
    return { name, wgsl, inputs, outBinding: K, rows, components, cpu };
  });

  // volumeSample: a sheared, rotated grid; positions are fed directly so the
  // case covers interior, face, corner and outside points, not just 4 atoms.
  {
    const transform = [
      0.9,
      0.2,
      0,
      0,
      0.3,
      1.1,
      0.1,
      0,
      0,
      -0.2,
      0.7,
      0,
      -14,
      22,
      5,
      1,
    ];
    const dims = [9, 7, 6];
    const values = new Float32Array(dims[0] * dims[1] * dims[2]);
    for (let i = 0; i < values.length; i++) {
      values[i] = Math.sin(i * 0.37) * 20 + (i % 7) - 3;
    }
    const volume = createVolume({ values, dims, transform });
    const points = [];
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      points.push([rand() * 8, rand() * 6, rand() * 5]); // interior
    }
    for (const i of [0, 8]) {
      for (const j of [0, 6]) {
        for (const k of [0, 5]) points.push([i, j, k]); // corners
      }
    }
    for (let n = 0; n < 40; n++) {
      const face = n % 6, p = [rand() * 8, rand() * 6, rand() * 5];
      p[face >> 1] = face & 1 ? dims[face >> 1] - 1 : 0; // on a face
      points.push(p);
    }
    for (let n = 0; n < 40; n++) {
      const p = [rand() * 8, rand() * 6, rand() * 5], axis = n % 3;
      p[axis] = n % 2 ? -0.5 - rand() * 3 : dims[axis] - 0.5 + rand() * 3;
      points.push(p); // outside
    }
    const world = points.map(([i, j, k]) =>
      volumeIndexToWorld(volume, i, j, k)
    );
    const field = volumeSample(volume);
    const compiled = compile(field, { domain: "atom" });
    const K = compiled.bindings.length;
    const rows = world.length;
    const input = (id) => compiled.bindings.find((b) => b.id.startsWith(id));
    jobs.push({
      name: "volumeSample",
      wgsl: `${compiled.wgsl}
@group(0) @binding(${K}) var<storage, read_write> outp: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= ${rows}u) { return; }
  outp[row] = evalField(row);
}`,
      inputs: [
        {
          binding: input("positions").binding,
          kind: "buffer",
          data: world.flatMap((w) => [...w.map(Math.fround), 0]),
        },
        {
          binding: input("volume:").binding,
          kind: "buffer",
          data: [...input("volume:").fill(data)],
        },
      ],
      outBinding: K,
      rows,
      components: 1,
      // CPU reference at the same f32 positions the GPU reads.
      cpu: world.map((w) => {
        const [x, y, z] = w.map(Math.fround);
        return sampleVolume(volume, x, y, z);
      }),
      relative: 1e-5,
    });
  }

  // WebGPU needs a secure context; http://127.0.0.1 counts as one, about:blank does not.
  const server = createServer((_, res) => {
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><meta charset=utf-8><title>fields gpu</title>");
  });
  await new Promise((r) => server.listen(5192, "127.0.0.1", r));

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-unsafe-webgpu"],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:5192/");
    const results = {};
    for (const job of jobs) {
      const out = await page.evaluate(
        async ({ wgsl, inputs, outBinding, rows, components }) => {
          if (!navigator.gpu) return { error: "no webgpu" };
          const adapter = await navigator.gpu.requestAdapter();
          const device = await adapter.requestDevice();
          const module = device.createShaderModule({ code: wgsl });
          const info = await module.getCompilationInfo();
          const errs = info.messages.filter((m) => m.type === "error").map((
            m,
          ) => `${m.lineNum}:${m.linePos} ${m.message}`);
          if (errs.length) return { error: errs.join(" | ") };

          const entries = [], layout = [], keep = [];
          for (const inp of inputs) {
            let buf;
            if (inp.kind === "uniform") {
              const arr = new Float32Array(4);
              arr.set(inp.data.slice(0, 4));
              buf = device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
              });
              device.queue.writeBuffer(buf, 0, arr);
              layout.push({
                binding: inp.binding,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "uniform" },
              });
            } else {
              const arr = new Float32Array(inp.data);
              buf = device.createBuffer({
                size: Math.max(4, arr.byteLength),
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
              });
              device.queue.writeBuffer(buf, 0, arr);
              layout.push({
                binding: inp.binding,
                visibility: GPUShaderStage.COMPUTE,
                buffer: { type: "read-only-storage" },
              });
            }
            keep.push(buf);
            entries.push({ binding: inp.binding, resource: { buffer: buf } });
          }
          const outLen = rows * components;
          const outBuf = device.createBuffer({
            size: outLen * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
          });
          entries.push({ binding: outBinding, resource: { buffer: outBuf } });
          layout.push({
            binding: outBinding,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: "storage" },
          });

          const bgl = device.createBindGroupLayout({ entries: layout });
          const pipeline = device.createComputePipeline({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
            compute: { module, entryPoint: "main" },
          });
          const bind = device.createBindGroup({ layout: bgl, entries });
          const enc = device.createCommandEncoder();
          const pass = enc.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bind);
          pass.dispatchWorkgroups(Math.ceil(rows / 64));
          pass.end();
          const read = device.createBuffer({
            size: outLen * 4,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          });
          enc.copyBufferToBuffer(outBuf, 0, read, 0, outLen * 4);
          device.queue.submit([enc.finish()]);
          await read.mapAsync(GPUMapMode.READ);
          const result = [...new Float32Array(read.getMappedRange().slice(0))];
          read.unmap();
          return { result };
        },
        job,
      );

      assert.equal(out.error, undefined, `${job.name} WGSL: ${out.error}`);
      assert.equal(out.result.length, job.cpu.length, `${job.name} length`);
      let maxErr = 0;
      for (let i = 0; i < job.cpu.length; i++) {
        const err = Math.abs(out.result[i] - job.cpu[i]);
        // Absolute 1e-5, or relative to the larger magnitude when a case sets it.
        const scale = job.relative
          ? Math.max(1, Math.abs(out.result[i]), Math.abs(job.cpu[i]))
          : 1;
        maxErr = Math.max(maxErr, err / scale);
        if (job.relative) {
          assert.ok(
            err <= 1e-5 * scale,
            `${job.name} row ${i}: GPU ${out.result[i]} vs CPU ${job.cpu[i]}`,
          );
        }
      }
      assert.ok(maxErr <= 1e-5, `${job.name} CPU/GPU disagree by ${maxErr}`);
      if (job.name === "volumeSample") {
        assert.ok(job.cpu.some((v) => v === 0), "outside points return 0");
        assert.ok(
          out.result.filter((v) => v === 0).length ===
            job.cpu.filter((v) => v === 0).length,
          "GPU and CPU agree on which points are outside",
        );
      }
      results[job.name] = {
        rows: job.rows,
        components: job.components,
        maxErr,
      };
    }
    assert.deepEqual(errors, [], "page errors");
    console.log(
      JSON.stringify({
        status: "passed",
        cases: results,
        browser: browser.version(),
      }),
    );
  } finally {
    await browser.close();
    server.close();
  }
});
