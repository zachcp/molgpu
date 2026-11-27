// Renderer-free data for the left-to-right flow panels: what each column of
// the encoder and sequence flows shows for a structure and a hovered residue.
import {
  PROTEIN_MPNN_ALPHABET,
  type ProteinMpnnGraph,
  type ProteinMpnnInput,
} from "@molgpu/nn";

/** [L, 21] one-hot rows of a sequence of alphabet indices. */
export function oneHot(sequence: Uint8Array): Float32Array {
  const letters = PROTEIN_MPNN_ALPHABET.length;
  const out = new Float32Array(sequence.length * letters);
  sequence.forEach((a, i) => {
    if (a >= letters) throw new Error(`oneHot: letter ${a} at ${i}`);
    out[i * letters + a] = 1;
  });
  return out;
}

/** One edge of the model's neighbour graph, seen from residue i. */
export interface Neighbor {
  /** Model position of the neighbour. */
  readonly position: number;
  /** 0 for the nearest (residue i itself), up to K - 1. */
  readonly rank: number;
  /** CA–CA distance in Å. */
  readonly distance: number;
}

/** Residue i's K neighbours, nearest first, as the encoder sees them. */
export function neighborsOf(
  input: ProteinMpnnInput,
  graph: ProteinMpnnGraph,
  i: number,
): Neighbor[] {
  if (i < 0 || i >= graph.length) throw new Error(`neighborsOf: residue ${i}`);
  const ca = (r: number, d: number) => input.backbone[12 * r + 3 + d];
  return Array.from(graph.neighbors.subarray(i * graph.k, (i + 1) * graph.k))
    .map((position, rank) => ({
      position,
      rank,
      distance: Math.hypot(
        ca(i, 0) - ca(position, 0),
        ca(i, 1) - ca(position, 1),
        ca(i, 2) - ca(position, 2),
      ),
    }));
}

/** [K, 400] RBF distance features of residue i's edges. */
export function edgeFeaturesOf(
  graph: ProteinMpnnGraph,
  i: number,
): Float32Array {
  const width = graph.rbf.length / (graph.length * graph.k);
  return graph.rbf.subarray(i * graph.k * width, (i + 1) * graph.k * width);
}
