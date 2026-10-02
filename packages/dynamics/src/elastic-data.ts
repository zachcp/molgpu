import type { Topology } from "@molgpu/table";
import { buildElasticNetwork } from "./elastic-network.ts";
import { enmSprings, type LangevinSystem, langevinSystem } from "./langevin.ts";
import { residueGuideMap } from "./normal-mode.ts";

/** Everything `<ElasticNetwork>` integrates, built once from a reference. */
export interface ElasticNetworkData {
  /** Springs, reference node positions, masses and rigid frame. */
  readonly system: LangevinSystem;
  /** Sorted atom rows of the guide nodes, in node order. */
  readonly guideRows: Uint32Array;
  /** Atom row to guide node, or 0xffffffff for atoms that follow upstream. */
  readonly atomToNode: Uint32Array;
  /** Identifies the reference; change it whenever the inputs change. */
  readonly version: number;
}

export interface ElasticNetworkOptions {
  /**
   * `"CA"` (default): one CA per protein residue of the first model, the
   * first CA row of each residue (so altloc copies do not become nodes).
   * Otherwise sorted, unique atom rows; non-residue guides need `masses`.
   */
  readonly guide?: "CA" | ArrayLike<number>;
  /** Å, default 15. */
  readonly cutoff?: number;
  /** kcal/mol/Å², default 1. */
  readonly k?: number;
  /** amu per node; defaults to 110 for `"CA"`. */
  readonly masses?: Float32Array;
  /** Contact cap; above it construction throws a RangeError, never thins. */
  readonly maxContacts?: number;
  readonly version: number;
}

/** CA rows: one per protein residue of the first model. */
export function caGuideRows(topology: Topology): Uint32Array {
  const { atoms, residues, chains } = topology;
  if (chains.count === 0) return new Uint32Array();
  const model = chains.model[residues.chain[atoms.residue[0]] ?? 0];
  const rows: number[] = [];
  let last = -1;
  for (let i = 0; i < atoms.count; i++) {
    const residue = atoms.residue[i];
    if (
      residue === last || atoms.name[i] !== "CA" ||
      residues.polymer[residue] !== "protein" ||
      chains.model[residues.chain[residue]] !== model
    ) continue;
    rows.push(i);
    last = residue;
  }
  return Uint32Array.from(rows);
}

/**
 * Build `<ElasticNetwork>` input from reference atom positions the application
 * chooses (packed xyz over all atoms): guide nodes, CSR springs within
 * `cutoff`, node masses and the atom-to-node map.
 */
export function elasticNetworkData(
  positions: Float32Array,
  topology: Topology,
  options: ElasticNetworkOptions,
): ElasticNetworkData {
  const {
    guide = "CA",
    cutoff = 15,
    k = 1,
    masses,
    maxContacts = 1_000_000,
    version,
  } = options;
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new TypeError("elastic network version must be a safe integer");
  }
  if (positions.length !== 3 * topology.atoms.count) {
    throw new TypeError("reference positions must cover every atom");
  }
  if (guide !== "CA" && !masses) {
    throw new TypeError(
      "custom elastic guides need explicit node masses (110 amu is a residue)",
    );
  }
  const inputRows = guide === "CA" ? caGuideRows(topology) : guide;
  if (inputRows.length < 3) {
    throw new TypeError("an elastic network needs at least three guide nodes");
  }
  const network = buildElasticNetwork(
    positions,
    inputRows,
    cutoff,
    maxContacts,
  );
  // Reuse the kernel's owned rows, validated before integer packing.
  const guideRows = network.rows;
  const reference = new Float32Array(3 * guideRows.length);
  guideRows.forEach((row, node) =>
    reference.set(positions.subarray(3 * row, 3 * row + 3), 3 * node)
  );
  const system = langevinSystem(
    enmSprings(network, positions, k),
    reference,
    masses,
  );
  return Object.freeze({
    system,
    guideRows,
    atomToNode: residueGuideMap(topology, guideRows),
    version,
  });
}
