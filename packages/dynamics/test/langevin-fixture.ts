import {
  buildElasticNetwork,
  enmSprings,
  type LangevinSystem,
  langevinSystem,
} from "../src/index.ts";
import type { ElasticNetwork } from "../src/elastic-network.ts";

/** Toy spring constant: stiff enough that 300 K stays near-harmonic. */
export const TOY_K = 10;

/** 50 nodes in an 18 Å cube, at least 3.2 Å apart, linked within 9 Å. */
export function toyNetwork(): {
  positions: Float32Array;
  network: ElasticNetwork;
  system: LangevinSystem;
} {
  let s = 3;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const points: number[] = [];
  while (points.length < 150) {
    const p = [rand() * 18, rand() * 18, rand() * 18];
    let far = true;
    for (let j = 0; j < points.length; j += 3) {
      const d = Math.hypot(
        p[0] - points[j],
        p[1] - points[j + 1],
        p[2] - points[j + 2],
      );
      if (d < 3.2) far = false;
    }
    if (far) points.push(...p);
  }
  const positions = Float32Array.from(points);
  const rows = Array.from({ length: 50 }, (_, i) => i);
  const network = buildElasticNetwork(positions, rows, 9);
  const system = langevinSystem(
    enmSprings(network, positions, TOY_K),
    positions,
  );
  return { positions, network, system };
}

/** Rotation angle in degrees of the best rigid fit of `x` onto `reference`. */
export function rotationDegrees(
  matrix: ArrayLike<number>,
): number {
  const trace = matrix[0] + matrix[5] + matrix[10];
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2))) * 180 /
    Math.PI;
}
