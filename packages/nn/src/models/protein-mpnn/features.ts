// ProteinMPNN's graph features on the CPU (ProteinFeatures.forward, without
// training noise): K nearest neighbours by CA distance, 16 Gaussian RBFs of 25
// backbone atom-pair distances per edge, and the relative-position class that
// selects a row of the positional embedding.
import type { ProteinMpnnInput } from "./input.ts";

/** Neighbours per residue in the published ProteinMPNN checkpoints. */
export const PROTEIN_MPNN_NEIGHBORS = 48;
const RBF = 16;
const MAX_RELATIVE = 32;
/** Positional classes: offsets -32..32 within a chain, plus one for other chains. */
export const PROTEIN_MPNN_POSITIONS = 2 * MAX_RELATIVE + 2;

// Atom slots: N, CA, C, O, virtual CB. Pair order is the upstream RBF_all order.
const [N, CA, C, O, CB] = [0, 1, 2, 3, 4];
const PAIRS: readonly (readonly [number, number])[] = [
  [CA, CA],
  [N, N],
  [C, C],
  [O, O],
  [CB, CB],
  [CA, N],
  [CA, C],
  [CA, O],
  [CA, CB],
  [N, C],
  [N, O],
  [N, CB],
  [CB, C],
  [CB, O],
  [O, C],
  [N, CA],
  [C, CA],
  [O, CA],
  [CB, CA],
  [C, N],
  [O, N],
  [CB, N],
  [C, CB],
  [O, CB],
  [C, O],
];
const ATOM_NAMES = ["N", "CA", "C", "O", "CB"];
/**
 * The 25 backbone atom pairs whose distances each edge encodes, in feature
 * order (`"CA-N"` is CA of residue i to N of neighbour j); each pair takes 16
 * consecutive RBF features.
 */
export const PROTEIN_MPNN_ATOM_PAIRS: readonly string[] = PAIRS.map(
  ([a, b]) => `${ATOM_NAMES[a]}-${ATOM_NAMES[b]}`,
);
/** RBF features per edge: 25 atom pairs × 16 centres. */
export const PROTEIN_MPNN_RBF_FEATURES = PAIRS.length * RBF;

/** The k-nearest-neighbour graph and per-edge inputs of one structure. */
export interface ProteinMpnnGraph {
  readonly length: number;
  /** Neighbours per residue, min(48, L); each residue is its own first neighbour. */
  readonly k: number;
  /** [L, K] neighbour residue per edge, nearest first. */
  readonly neighbors: Uint32Array;
  /** [L, K, 400] RBF features. */
  readonly rbf: Float32Array;
  /** [L, K] positional class in 0..65. */
  readonly positional: Uint32Array;
}

/** Build the neighbour graph and edge features for `input`. */
export function proteinMpnnGraph(
  input: ProteinMpnnInput,
  neighbors: number = PROTEIN_MPNN_NEIGHBORS,
): ProteinMpnnGraph {
  const length = input.sequence.length;
  const k = Math.min(neighbors, length);
  const x = input.backbone;
  // Atoms [L, 5, 3], with CB placed from N, CA and C as upstream does.
  const atoms = new Float64Array(length * 15);
  for (let i = 0; i < length; i++) {
    for (let j = 0; j < 12; j++) atoms[15 * i + j] = x[12 * i + j];
    const at = (s: number, d: number) => x[12 * i + 3 * s + d];
    const b = [0, 1, 2].map((d) => at(CA, d) - at(N, d));
    const c = [0, 1, 2].map((d) => at(C, d) - at(CA, d));
    const a = [
      b[1] * c[2] - b[2] * c[1],
      b[2] * c[0] - b[0] * c[2],
      b[0] * c[1] - b[1] * c[0],
    ];
    for (let d = 0; d < 3; d++) {
      atoms[15 * i + 12 + d] = -0.58273431 * a[d] + 0.56802827 * b[d] -
        0.54067466 * c[d] + at(CA, d);
    }
  }
  const distance = (i: number, s: number, j: number, t: number) => {
    let sum = 0;
    for (let d = 0; d < 3; d++) {
      sum += (atoms[15 * i + 3 * s + d] - atoms[15 * j + 3 * t + d]) ** 2;
    }
    return Math.sqrt(sum + 1e-6);
  };

  const graph = new Uint32Array(length * k);
  const order = Array.from({ length }, (_, j) => j);
  const caDistance = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    for (let j = 0; j < length; j++) caDistance[j] = distance(i, CA, j, CA);
    order.sort((p, q) => caDistance[p] - caDistance[q] || p - q);
    graph.set(order.slice(0, k), i * k);
  }

  const rbf = new Float32Array(length * k * PROTEIN_MPNN_RBF_FEATURES);
  const positional = new Uint32Array(length * k);
  const sigma = (22 - 2) / RBF;
  for (let i = 0; i < length; i++) {
    for (let e = 0; e < k; e++) {
      const edge = i * k + e;
      const j = graph[edge];
      PAIRS.forEach(([s, t], p) => {
        const dist = distance(i, s, j, t);
        for (let r = 0; r < RBF; r++) {
          const mu = 2 + r * (20 / (RBF - 1));
          rbf[edge * PROTEIN_MPNN_RBF_FEATURES + p * RBF + r] = Math.exp(
            -(((dist - mu) / sigma) ** 2),
          );
        }
      });
      positional[edge] = input.chain[i] === input.chain[j]
        ? Math.min(
          Math.max(
            input.residueIndex[i] - input.residueIndex[j] + MAX_RELATIVE,
            0,
          ),
          2 * MAX_RELATIVE,
        )
        : 2 * MAX_RELATIVE + 1;
    }
  }
  return { length, k, neighbors: graph, rbf, positional };
}
