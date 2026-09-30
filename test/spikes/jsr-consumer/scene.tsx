/**
 * A consumer's JSX scene, written only against published entries: one
 * caller-owned use.gpu canvas composing molecular components with field
 * colours and a selection. crj.11 type-checks and bundles it outside the
 * workspace, resolving every @molgpu entry from the local registry.
 */
import { React, render } from "@use-gpu/live";
import type { LiveElement } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  DirectionalLight,
  OrbitCamera,
  Pass,
} from "@use-gpu/workbench";
import { createStructure, type StructureData } from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import { attribute, byElement, colormap } from "@molgpu/fields";
import { Bonds, Spacefill, Structure } from "@molgpu/viewer";
import type { StructureLoader } from "@molgpu/viewer";

void React;

const RING = 6;
const ring = (): StructureData =>
  createStructure({
    positions: Float32Array.from({ length: RING * 3 }, (_, i) => {
      const atom = Math.floor(i / 3), angle = (atom / RING) * Math.PI * 2;
      return [Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0][i % 3];
    }),
    topology: {
      atoms: {
        count: RING,
        id: Array.from({ length: RING }, (_, i) => String(i + 1)),
        name: Array.from({ length: RING }, (_, i) => `C${i + 1}`),
        altloc: new Array(RING).fill(""),
        residue: new Uint32Array(RING),
        element: Uint8Array.from({ length: RING }, (_, i) => i % 2 ? 7 : 6),
        occupancy: new Float32Array(RING).fill(1),
        bfactor: Float32Array.from({ length: RING }, (_, i) => i * 10),
        radius: new Float32Array(RING).fill(0.7),
      },
      residues: {
        count: 1,
        chain: new Uint32Array(1),
        labelSeq: new Int32Array([1]),
        authSeq: ["1"],
        insertionCode: [""],
        comp: ["BNZ"],
        polymer: ["other"],
      },
      chains: {
        count: 1,
        model: new Int32Array([1]),
        labelId: ["A"],
        authId: ["A"],
      },
      bonds: {
        count: RING,
        a: Uint32Array.from({ length: RING }, (_, i) => i),
        b: Uint32Array.from({ length: RING }, (_, i) => (i + 1) % RING),
        order: new Uint8Array(RING).fill(1),
        source: new Array(RING).fill("explicit"),
      },
      instances: {
        count: 1,
        chain: new Uint32Array(1),
        operatorId: ["identity"],
        transform: Float64Array.from([
          ...[1, 0, 0, 0],
          ...[0, 1, 0, 0],
          ...[0, 0, 1, 0],
          ...[0, 0, 0, 1],
        ]),
      },
    },
  });

const DATA = ring();
const NITROGEN = resolve(
  where(
    "atom",
    "nitrogen",
    (data, row) => data.topology.atoms.element[row] === 7,
  ),
  DATA,
);
const BY_B = colormap(attribute("bfactor"), [[0, [0.2, 0.4, 1, 1]], [
  50,
  [1, 0.3, 0.2, 1],
]]);

// A BCIF source goes through @molgpu/io, which loads Mol* only on demand.
const loader: StructureLoader = async (src) => {
  const { structureFromBcif } = await import("@molgpu/io");
  return await structureFromBcif(
    new Uint8Array(await (await fetch(src)).arrayBuffer()),
  );
};

export const Scene = ({ src }: { src?: string }): LiveElement => (
  <OrbitCamera radius={12} bearing={0.4} pitch={0.3} target={[0, 0, 0]}>
    <Pass lights>
      <AmbientLight color={[1, 1, 1]} intensity={0.5} />
      <DirectionalLight
        position={[1, 2, 3]}
        color={[1, 1, 1]}
        intensity={0.9}
      />
      {src
        ? (
          <Structure src={src} loader={loader}>
            <Spacefill color={byElement()} />
          </Structure>
        )
        : (
          <Structure data={DATA}>
            <Spacefill color={BY_B} scale={0.6} />
            <Spacefill color={[1, 1, 1, 1]} select={NITROGEN} scale={0.8} />
            <Bonds />
          </Structure>
        )}
    </Pass>
  </OrbitCamera>
);

if (typeof document !== "undefined") {
  const src = new URLSearchParams(location.search).get("src") ?? undefined;
  render(
    <WebGPU
      fallback={(failure: unknown) => {
        (globalThis as { __errors?: string[] }).__errors?.push(
          String(failure),
        );
        return null;
      }}
    >
      <AutoCanvas selector="#root" samples={4} backgroundColor={[0, 0, 0, 1]}>
        <Scene src={src} />
      </AutoCanvas>
    </WebGPU>,
  );
}
