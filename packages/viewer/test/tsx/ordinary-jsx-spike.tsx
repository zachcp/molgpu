/**
 * crj.9 public acceptance scene. No declared/mock components or advanced imports.
 * BaselineScene and AcceptanceScene use real public query props. Browser
 * coverage mounts AcceptanceScene alongside controlled snapshot consumers.
 */
import { React, render } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import {
  AmbientLight,
  OrbitCamera,
  Pass,
  PBRMaterial,
} from "@use-gpu/workbench";
import { comp, protein, secondaryStructure, within } from "@molgpu/select";
import { byElement, byPotential } from "@molgpu/fields";
import {
  BallAndStick,
  EField,
  GpuDssp,
  Isosurface,
  Ribbon,
  Spacefill,
  Structure,
  Trajectory,
  Transform,
} from "@molgpu/viewer";
import type {
  MaterialSpec,
  SelectionStatus,
  StructureLoader,
  TrajectoryLoader,
  ViewerElement,
} from "@molgpu/viewer";

void React;

// Public JSX and native wrappers share the pinned LiveElement boundary.
const matte: MaterialSpec = { roughness: 0.6, metalness: 0 };
const lazyMaterial: MaterialSpec = (children) => (
  <PBRMaterial roughness={() => 0.6}>{children}</PBRMaterial>
);

// Reusable molecular values; residue queries expand to atoms in the proposed
// viewer adapter. No row packing, resource handles, or revision bookkeeping.
const ligand = comp(["HEM"]);
const site = within(5, ligand);
const helixSite = within(5, secondaryStructure("helix"));
const polymer = protein();
const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1];

export interface SceneProps {
  src: string;
  trajectorySrc: string;
  frame: number;
  loader?: StructureLoader;
  trajectoryLoader?: TrajectoryLoader;
  onSelectionStatus?: (status: SelectionStatus) => void;
  loading?: ViewerElement;
  error?: (failure: unknown) => ViewerElement;
}

/** Current public subset: runnable with a charged BCIF and matching trajectory. */
export function BaselineScene(props: SceneProps): ViewerElement {
  return (
    <Structure
      src={props.src}
      loader={props.loader}
      loading={props.loading}
      error={props.error}
    >
      <Trajectory
        src={props.trajectorySrc}
        loader={props.trajectoryLoader}
        frame={props.frame}
      >
        <Transform matrix={shift} select={polymer}>
          <Ribbon color={[0.7, 0.8, 0.9, 1]} material={matte} />
          <BallAndStick color={byElement()} material={lazyMaterial} />
          <EField spacing={2} maxSamples={128 ** 3}>
            <Spacefill color={byPotential()} scale={0.25} />
            <Isosurface level={1} opacity={0.25} />
          </EField>
        </Transform>
      </Trajectory>
    </Structure>
  );
}

/** Target: the same source-owned scene with subtree-local query selections. */
export function AcceptanceScene(props: SceneProps): ViewerElement {
  // Every selection is a reusable public molecular value.
  const ribbon = <Ribbon select={polymer} color={[0.7, 0.8, 0.9, 1]} />;
  const atoms = <BallAndStick select={ligand} color={byElement()} />;
  const potentialSelection: Parameters<typeof EField>[0]["select"] = polymer;
  const potential = (
    <EField select={potentialSelection} spacing={2}>
      <Spacefill color={byPotential()} scale={0.25} />
      <Isosurface level={1} opacity={0.25} />
    </EField>
  );
  const nearby = <Spacefill select={site} color={byElement()} scale={0.3} />;
  const helixNeighbors = (
    <Spacefill
      onSelectionStatus={props.onSelectionStatus}
      select={helixSite}
      color={[1, 0.4, 0.2, 1]}
      scale={0.2}
    />
  );
  return (
    <Structure
      src={props.src}
      loader={props.loader}
      loading={props.loading}
      error={props.error}
    >
      <Trajectory
        src={props.trajectorySrc}
        loader={props.trajectoryLoader}
        frame={props.frame}
      >
        <Transform matrix={shift} select={polymer}>
          {ribbon}
          {atoms}
          {nearby}
          {potential}
          <GpuDssp>{helixNeighbors}</GpuDssp>
        </Transform>
      </Trajectory>
    </Structure>
  );
}

/** Caller owns the entire render tree. Mount only the supported baseline today. */
export function mountBaseline(selector: string, props: SceneProps): void {
  render(
    <WebGPU fallback={null}>
      <AutoCanvas selector={selector} samples={4}>
        <OrbitCamera radius={50}>
          <Pass lights oit>
            <AmbientLight intensity={0.7} />
            <BaselineScene {...props} />
          </Pass>
        </OrbitCamera>
      </AutoCanvas>
    </WebGPU>,
  );
}
