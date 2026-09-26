export type ColumnFormat =
  | "f32"
  | "i32"
  | "u32"
  | "vec2<f32>"
  | "vec3<f32>"
  | "vec4<f32>";
type Column = Float32Array | Int32Array | Uint32Array;

const FORMATS: Record<
  ColumnFormat,
  [
    Float32ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor,
    number,
  ]
> = {
  f32: [Float32Array, 1],
  i32: [Int32Array, 1],
  u32: [Uint32Array, 1],
  "vec2<f32>": [Float32Array, 2],
  "vec3<f32>": [Float32Array, 3],
  "vec4<f32>": [Float32Array, 4],
};

/** Copy exactly the view, not its backing buffer. Input stays packed CPU data. */
export function prepareColumn(
  data: Column,
  format: ColumnFormat,
): { data: Column; count: number; format: ColumnFormat } {
  const layout = FORMATS[format];
  if (!layout) throw new TypeError(`Unsupported column format: ${format}`);
  const [Type, width] = layout;
  if (!(data instanceof Type) || data.length % width) {
    throw new TypeError(`Expected packed ${format} ${Type.name}`);
  }
  if (data instanceof Float32Array && data.some((x) => !Number.isFinite(x))) {
    throw new TypeError("Column values must be finite");
  }
  return { data: data.slice(), count: data.length / width, format };
}
