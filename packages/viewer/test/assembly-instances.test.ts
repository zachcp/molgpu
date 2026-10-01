// Executable acceptance for the assembly instance decision (molgpu-sept-crj.8):
// docs/findings/2026-10-01-assembly-instances-decision.md. molgpu draws the
// asymmetric unit; `topology.instances` is a validated data contract that no
// representation consumes yet, and framing covers drawn atoms only (crj.26).
import { assert, assertEquals, assertThrows } from "@std/assert";
import { createStructure, type StructureInput } from "@molgpu/table";
import { structureFromBcif } from "@molgpu/io";
import { all } from "@molgpu/select";
import { createStructureResource } from "../src/internal/structure-resource.ts";
import { focusSelection } from "../src/camera-curve.ts";

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const SHIFTED = [...IDENTITY];
SHIFTED[12] = 100;

/** One chain, two atoms, two operators: identity and +100 Å along x. */
const twoCopies = (transform: number[] = [...IDENTITY, ...SHIFTED]) =>
  ({
    positions: Float32Array.from([0, 0, 0, 2, 0, 0]),
    topology: {
      atoms: {
        count: 2,
        id: ["1", "2"],
        name: ["C", "O"],
        altloc: ["", ""],
        residue: Uint32Array.of(0, 0),
        element: Uint8Array.of(6, 8),
        occupancy: Float32Array.of(1, 1),
        bfactor: new Float32Array(2),
      },
      residues: {
        count: 1,
        chain: Uint32Array.of(0),
        labelSeq: Int32Array.of(1),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["ACE"],
        polymer: ["other"],
      },
      chains: {
        count: 1,
        model: Int32Array.of(1),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: 0,
        a: new Uint32Array(),
        b: new Uint32Array(),
        order: new Uint8Array(),
        source: [],
      },
      instances: {
        count: transform.length / 16,
        chain: new Uint32Array(transform.length / 16),
        operatorId: ["1", "2"].slice(0, transform.length / 16),
        transform: Float64Array.from(transform),
      },
    },
  }) satisfies StructureInput;

Deno.test("assembly: two copies are instance rows, never duplicated atoms", () => {
  const data = createStructure(twoCopies());
  assertEquals(data.topology.atoms.count, 2);
  assertEquals(data.topology.instances.count, 2);
  assertEquals(data.topology.instances.operatorId, ["1", "2"]);
  assertEquals(data.topology.instances.transform[16 + 12], 100);
  const projective = [...IDENTITY, ...SHIFTED];
  projective[16 + 3] = 1;
  assertThrows(
    () => createStructure(twoCopies(projective)),
    TypeError,
    "affine",
  );
});

Deno.test("assembly: BCIF import emits one identity instance per chain", async () => {
  for (const id of ["1crn", "4c7r"]) {
    const bytes = await Deno.readFile(
      new URL(`../../io/test/fixtures/${id}.bcif`, import.meta.url),
    );
    const { chains, instances } = (await structureFromBcif(bytes)).topology;
    assertEquals(instances.count, chains.count, `${id}: one row per chain`);
    assertEquals(
      Array.from(instances.chain),
      Array.from({ length: chains.count }, (_, i) => i),
      `${id}: chain order`,
    );
    assert(
      instances.operatorId.every((op) => op === "identity"),
      `${id}: identity operators only`,
    );
    for (let i = 0; i < instances.count; i++) {
      assertEquals(
        Array.from(instances.transform.subarray(i * 16, i * 16 + 16)),
        IDENTITY,
        `${id}: instance ${i} is the identity`,
      );
    }
  }
});

Deno.test({
  name: "assembly: framing covers only drawn atoms [crj.26]",
  fn: () => {
    const frame = (transform: number[]) =>
      focusSelection(
        createStructureResource(createStructure(twoCopies(transform))),
        all("atom"),
      )?.bounds;
    // The +100 Å copy is drawn by no representation, so it must not widen the
    // camera bounds beyond those of the identity copy alone.
    const drawn = frame(IDENTITY);
    assert(drawn);
    assertEquals(frame([...IDENTITY, ...SHIFTED]), drawn);
  },
});
