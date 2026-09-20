const FORMATS = {
  f32: [Float32Array, 1], i32: [Int32Array, 1], u32: [Uint32Array, 1],
  'vec2<f32>': [Float32Array, 2], 'vec3<f32>': [Float32Array, 3], 'vec4<f32>': [Float32Array, 4],
};
/** Copy exactly the view, not its backing buffer. Input stays packed CPU data. */
export function prepareColumn(data, format) {
  const layout = FORMATS[format];
  if (!layout) throw new TypeError(`Unsupported column format: ${format}`);
  const [Type, width] = layout;
  if (!(data instanceof Type) || data.length % width) throw new TypeError(`Expected packed ${format} ${Type.name}`);
  if (Type === Float32Array && data.some(x => !Number.isFinite(x))) throw new TypeError('Column values must be finite');
  return { data: data.slice(), count: data.length / width, format };
}
