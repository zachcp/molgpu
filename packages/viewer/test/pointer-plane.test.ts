import { assert, assertThrows } from "@std/assert";
import { pointerToPlane, projectToPointer } from "../src/pointer-plane.ts";

/** Column-major perspective · lookAt, as a camera would build them. */
function camera(eye: number[], target: number[]): number[] {
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
  const norm = (a: number[]) => {
    const l = Math.hypot(...a);
    return a.map((x) => x / l);
  };
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: number[], b: number[]) =>
    a.reduce((s, x, i) => s + x * b[i], 0);
  const f = norm(sub(target, eye)), s = norm(cross(f, [0, 1, 0]));
  const u = cross(s, f);
  const view = [
    ...[s[0], u[0], -f[0], 0],
    ...[s[1], u[1], -f[1], 0],
    ...[s[2], u[2], -f[2], 0],
    ...[-dot(s, eye), -dot(u, eye), dot(f, eye), 1],
  ];
  const fov = 0.8, aspect = 1.4, near = 0.5, far = 500;
  const t = 1 / Math.tan(fov / 2);
  const proj = [
    ...[t / aspect, 0, 0, 0],
    ...[0, t, 0, 0],
    ...[0, 0, far / (near - far), -1],
    ...[0, 0, (near * far) / (near - far), 0],
  ];
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      for (let k = 0; k < 4; k++) {
        out[c * 4 + r] += proj[k * 4 + r] * view[c * 4 + k];
      }
    }
  }
  return out;
}

Deno.test("pointerToPlane round-trips projectToPointer within 1e-4 relative", () => {
  const pv = camera([40, 25, 60], [12, 8, 10]);
  let seed = 5;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    const p = [rand() * 30, rand() * 20, rand() * 25];
    const [u, v] = projectToPointer(p, pv);
    const back = pointerToPlane(u, v, pv, p);
    const error = Math.hypot(...back.map((x, k) => x - p[k])) /
      Math.hypot(...p);
    assert(error < 1e-4, `round trip error ${error}`);
  }
});

Deno.test("a moved pointer stays on the view-normal plane and under the pointer", () => {
  const eye = [40, 25, 60], target = [12, 8, 10];
  const pv = camera(eye, target);
  const anchor = [15, 10, 12];
  const axis = target.map((x, i) => x - eye[i]);
  const [u, v] = projectToPointer(anchor, pv);
  for (const [du, dv] of [[0.1, 0], [0, -0.05], [0.07, 0.03]]) {
    const r = pointerToPlane(u + du, v + dv, pv, anchor);
    const offPlane = axis.reduce((s, a, i) => s + a * (r[i] - anchor[i]), 0) /
      Math.hypot(...axis);
    assert(Math.abs(offPlane) < 1e-6, `left the plane by ${offPlane}`);
    const [ru, rv] = projectToPointer(r, pv);
    assert(Math.abs(ru - (u + du)) < 1e-9 && Math.abs(rv - (v + dv)) < 1e-9);
  }
  assertThrows(() => pointerToPlane(Number.NaN, 0, pv, anchor), TypeError);
  assertThrows(
    () => pointerToPlane(0.5, 0.5, new Array(16).fill(0), anchor),
    RangeError,
  );
});
