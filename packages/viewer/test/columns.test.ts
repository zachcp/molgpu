import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { type ColumnFormat, prepareColumn } from "../src/internal/columns.ts";

Deno.test("offset vec3 view retains two logical rows, no prefix/suffix, independent storage", () => {
  const backing = Float32Array.from([99, 1, 2, 3, 4, 5, 6, 88]);
  const column = prepareColumn(backing.subarray(1, 7), "vec3<f32>");
  assertStrictEquals(column.count, 2);
  assertEquals([...column.data], [1, 2, 3, 4, 5, 6]);
  backing[1] = 999;
  assertStrictEquals(column.data[0], 1);
  assertStrictEquals(column.data.byteOffset, 0);
});

Deno.test("used formats, empty rows and validation", () => {
  const formats: [
    ColumnFormat,
    Float32ArrayConstructor | Int32ArrayConstructor | Uint32ArrayConstructor,
    number,
  ][] = [
    ["f32", Float32Array, 1],
    ["i32", Int32Array, 1],
    ["u32", Uint32Array, 1],
    ["vec2<f32>", Float32Array, 2],
    ["vec3<f32>", Float32Array, 3],
    ["vec4<f32>", Float32Array, 4],
  ];
  for (const [format, Type, stride] of formats) {
    assertStrictEquals(prepareColumn(new Type(stride * 2), format).count, 2);
    assertStrictEquals(prepareColumn(new Type(), format).count, 0);
  }
  assertThrows(
    () => prepareColumn(new Float32Array(4), "vec3<f32>"),
    Error,
    "packed",
  );
  assertThrows(() => prepareColumn(new Float32Array(1), "i32"), Error, "Int32");
  assertThrows(
    () => prepareColumn(Float32Array.of(NaN), "f32"),
    Error,
    "finite",
  );
  assertThrows(
    // @ts-expect-error: not a format
    () => prepareColumn(new Float32Array(), "unknown"),
    Error,
    "Unsupported",
  );
});
