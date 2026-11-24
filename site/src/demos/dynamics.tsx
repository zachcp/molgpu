/** @jsx LiveReact.createElement */
import {
  React as LiveReact,
  useMemo,
  useOne,
  useResource,
  useState,
} from "@use-gpu/live";
import { useViewContext } from "@use-gpu/workbench";
import { intersectRayPlane } from "@use-gpu/interact";
import {
  type PointerEvent,
  useCanvasEvents,
  usePointerCapture,
} from "@use-gpu/frame";
import type { StructureData } from "@molgpu/table";
import {
  type ElasticNetworkData,
  elasticNetworkData,
  type LangevinTug,
} from "@molgpu/dynamics";
import { frameCurve } from "@molgpu/timeline";
import {
  ElasticNetwork,
  type ElasticNetworkStatus,
  PickingProvider,
  Spacefill,
  usePicking,
} from "@molgpu/viewer";
import { useCoordinateSnapshot } from "@molgpu/viewer/advanced";

// 2000 steps at 500 steps/s: the 0–4 s scrub range plays the run once, and
// the checkpoint ring makes scrubbing back and the loop's wrap cheap.
const steps = frameCurve({ frames: 2000, fps: 500, loop: true });
const RECORD = { every: 10 } as const;
const TUG_K = 2;

const host = () => document.querySelector<HTMLElement>("#molecule-canvas");

const publish = (status: ElasticNetworkStatus) => {
  const element = host();
  if (!element) return;
  element.dataset.elasticStep = String(status.step);
  element.dataset.perturbed = String(status.perturbed);
};

/**
 * Right-drag an atom to pull its residue's CA toward the pointer, on the
 * plane through the CA normal to the view. Network coordinates are world
 * coordinates here (no transform above the provider).
 */
const TugControls = (
  { network, onTug }: {
    network: ElasticNetworkData;
    onTug: (tug: LangevinTug | undefined) => void;
  },
) => {
  const { hover } = usePicking();
  const capture = usePointerCapture();
  const { pick, uniforms } = useViewContext();
  const snapshot = useCoordinateSnapshot();
  const grab = useOne(() => ({ node: -1, id: 0, anchor: [0, 0, 0] }));
  const move = (event: PointerEvent) => {
    // The view axis is the third row of the column-major view matrix.
    const view = uniforms.viewMatrix.current;
    const [x, y, z] = grab.anchor;
    const n = [view[2], view[6], view[10]];
    const [origin, ray] = pick(event);
    const hit = intersectRayPlane(origin, ray, [
      ...n,
      n[0] * x + n[1] * y + n[2] * z,
    ] as [number, number, number, number]);
    if (hit) {
      onTug({ node: grab.node, target: [hit[0], hit[1], hit[2]], k: TUG_K });
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const release = () => {
    if (grab.node < 0) return;
    if (capture.hasCapture()?.pickId === grab.id) capture.endCapture();
    grab.node = -1;
    grab.id = 0;
    host()?.setAttribute("data-tug", "released");
    onTug(undefined);
  };
  useResource((dispose) => dispose(release), []);
  // Capture only right-drag: upstream Pick's capture prop takes every button
  // and would prevent the enclosing OrbitControls from rotating on left-drag.
  return useCanvasEvents(grab.id || hover?.id || null, {
    pointerDown: (event) => {
      if (
        event.button !== "right" || !hover ||
        event.pickId !== hover.id || event.pickIndex !== hover.drawIndex
      ) return;
      const node = network.atomToNode[hover.atom];
      if (node === undefined || node === 0xffffffff) return;
      const row = network.guideRows[node];
      const positions = snapshot?.data.positions;
      grab.node = node;
      grab.id = event.pickId;
      grab.anchor = positions
        ? [positions[3 * row], positions[3 * row + 1], positions[3 * row + 2]]
        : Array.from(network.system.reference.subarray(3 * node, 3 * node + 3));
      host()?.setAttribute("data-tug", "active");
      capture.beginCapture(event);
      move(event);
    },
    pointerMove: (event) => {
      if (grab.node >= 0) move(event);
    },
    pointerUp: (event) => {
      if (event.button !== "right" || grab.node < 0) return;
      release();
      event.stopPropagation();
    },
  });
};

/** Langevin dynamics of 1CRN's CA elastic network, scrubbable and tuggable. */
export const DynamicsScene = ({ data }: { data: StructureData }) => {
  const network = useMemo(
    () => elasticNetworkData(data.positions, data.topology, { version: 1 }),
    [data],
  );
  const [tug, setTug] = useState<LangevinTug | undefined>(undefined);
  return (
    <PickingProvider>
      <ElasticNetwork
        network={network}
        step={steps}
        record={RECORD}
        tug={tug}
        onStatus={publish}
      >
        <Spacefill scale={0.6} pickable />
        <TugControls network={network} onTug={setTug} />
      </ElasticNetwork>
    </PickingProvider>
  );
};
