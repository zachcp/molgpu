import { render, use, useState } from '@use-gpu/live';
import { WebGPU, AutoCanvas } from '@use-gpu/webgpu';
import { OrbitCamera, Pass, LineLayer, RawData, useRawSource, useDeviceContext } from '@use-gpu/workbench';
import { ColumnSource } from '../src/internal/column-source.mjs';

const probe = window.__adapter = { errors: [], sources: {}, buffers: [], destroyed: 0, mounted: false };
// Only the test adds COPY_SRC, to verify uploaded bytes via actual GPU readback.
const make = GPUDevice.prototype.createBuffer;
GPUDevice.prototype.createBuffer = function(desc) {
  return make.call(this, { ...desc, usage: desc.usage & GPUBufferUsage.STORAGE ? desc.usage | GPUBufferUsage.COPY_SRC : desc.usage });
};
const destroy = GPUBuffer.prototype.destroy;
const destroyed = new WeakSet();
GPUBuffer.prototype.destroy = function() { destroyed.add(this); return destroy.call(this); };
const request = GPUAdapter.prototype.requestDevice;
GPUAdapter.prototype.requestDevice = async function(...args) {
  const device = await request.apply(this, args);
  device.addEventListener('uncapturederror', e => probe.errors.push(e.error.message));
  return device;
};
let device;
probe.snapshot = () => ({ destroyed: probe.buffers.filter(b => destroyed.has(b)).length,
  buffers: probe.buffers.length, sources: Object.fromEntries(Object.entries(probe.sources).map(([k,s]) => [k, s && { length: s.length, version: s.version, size: s.size }])), errors: [...probe.errors] });
probe.read = async (key, elements, type = 'f32') => {
  const source = probe.sources[key];
  const staging = device.createBuffer({ size: elements * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(source.buffer, 0, staging, 0, elements * 4);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const Type = type === 'i32' ? Int32Array : type === 'u32' ? Uint32Array : Float32Array;
  const result = [...new Type(staging.getMappedRange())];
  staging.unmap(); staging.destroy(); return result;
};
probe.drain = () => device.queue.onSubmittedWorkDone();
const record = (key, source) => {
  probe.sources[key] = source;
  if (source && !probe.buffers.includes(source.buffer)) probe.buffers.push(source.buffer);
};
const columns = [
  ['f32', Float32Array.from([99,1.25,2.5,88]).subarray(1,3)],
  ['i32', Int32Array.from([99,-1,2,88]).subarray(1,3)],
  ['u32', Uint32Array.from([99,2147483649,2,88]).subarray(1,3)],
  ['vec2<f32>', Float32Array.from([99,1,2,3,4,88]).subarray(1,5)],
  ['vec3<f32>', Float32Array.from([99,1,2,3,4,5,6,88]).subarray(1,7)],
  ['vec4<f32>', Float32Array.from([99,1,2,3,4,5,6,7,8,88]).subarray(1,9)],
];
const positions = Float32Array.from([-6,-2,0, -4,-2,0, -1,0,0, 1,0,0, 4,2,0, 6,2,0]);
const segments = Int32Array.from([1,2,1,2,1,2]);
const tracePositions = Float32Array.from([-6,-2,0,-5,-1,0,-4,-2,0, 4,2,0,5,3,0,6,2,0]);
const traceSegments = Int32Array.from([1,3,2,1,3,2]);
const HookSource = ({ data, format, render }) => render(useRawSource(data, format));
const Fixture = ({ mode, trace, empty }) => {
  const p = trace ? tracePositions : positions, s = trace ? traceSegments : segments;
  const Pos = mode === 'hook-all' ? HookSource : ColumnSource;
  const Seg = mode.startsWith('hook') ? HookSource : ColumnSource;
  return use(Pos, { data: empty ? p.subarray(0,0) : p, format: 'vec3<f32>', render: pos =>
    pos && use(Seg, { data: s, format: 'i32', render: seg =>
      use(LineLayer, { positions: pos, segments: seg, width: 8, color: [1,1,1,1], join: 'round' }) }) });
};
const App = () => {
  device = useDeviceContext();
  const [state, setState] = useState({ revision: 0, empty: false, mounted: true, mode: 'adapter', trace: false });
  probe.update = patch => setState(s => ({ ...s, ...patch }));
  probe.mutate = () => { columns[0][1][0] += 10; setState(s => ({ ...s, revision: s.revision + 1 })); };
  probe.mounted = true;
  return [
    ...columns.map(([format, data]) => state.mounted && use(ColumnSource, {
      data: state.empty ? data.subarray(0,0) : data, format, revision: state.revision,
      render: source => { record(format, source); return null; },
    })),
    use(OrbitCamera, { radius: 24, bearing: 0, pitch: 0, target: [0,0,0], children:
      use(Pass, { children: state.mounted ? use(Fixture, state) : null }) }),
  ];
};
render(use(WebGPU, { fallback: e => { probe.errors.push(String(e)); return null; }, children:
  use(AutoCanvas, { selector: '#root', samples: 1, backgroundColor: [0,0,0,1], children: use(App) }) }));
