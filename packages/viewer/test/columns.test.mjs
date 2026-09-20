import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareColumn } from '../src/internal/columns.mjs';

test('offset vec3 view retains two logical rows, no prefix/suffix, independent storage', () => {
  const backing = Float32Array.from([99,1,2,3,4,5,6,88]);
  const column = prepareColumn(backing.subarray(1,7), 'vec3<f32>');
  assert.equal(column.count, 2);
  assert.deepEqual([...column.data], [1,2,3,4,5,6]);
  backing[1] = 999; assert.equal(column.data[0], 1);
  assert.equal(column.data.byteOffset, 0);
});

test('used formats, empty rows and validation', () => {
  for (const [format, Type, stride] of [['f32',Float32Array,1],['i32',Int32Array,1],['u32',Uint32Array,1],['vec2<f32>',Float32Array,2],['vec3<f32>',Float32Array,3],['vec4<f32>',Float32Array,4]]) {
    assert.equal(prepareColumn(new Type(stride * 2), format).count, 2);
    assert.equal(prepareColumn(new Type(), format).count, 0);
  }
  assert.throws(() => prepareColumn(new Float32Array(4), 'vec3<f32>'), /packed/);
  assert.throws(() => prepareColumn(new Float32Array(1), 'i32'), /Int32/);
  assert.throws(() => prepareColumn(Float32Array.of(NaN), 'f32'), /finite/);
  assert.throws(() => prepareColumn(new Float32Array(), 'unknown'), /Unsupported/);
});
