// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import {
  React as LiveReact,
  useMemo,
  useOne,
  useResource,
  useState,
} from "@use-gpu/live";
import { useMouseState, useViewContext } from "@use-gpu/workbench";
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
  pointerToPlane,
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
  const mouse = useMouseState();
  const { uniforms } = useViewContext();
  const snapshot = useCoordinateSnapshot();
  const grab = useOne(() => ({ node: -1, anchor: [0, 0, 0] }));
  useResource(() => {
    const right = !!mouse.buttons?.right;
    if (right && grab.node < 0 && hover) {
      const node = network.atomToNode[hover.atom];
      if (node === undefined || node === 0xffffffff) return;
      const row = network.guideRows[node];
      const positions = snapshot?.data.positions;
      grab.node = node;
      grab.anchor = positions
        ? [positions[3 * row], positions[3 * row + 1], positions[3 * row + 2]]
        : Array.from(network.system.reference.subarray(3 * node, 3 * node + 3));
      host()?.setAttribute("data-tug", "active");
    }
    if (right && grab.node >= 0) {
      const target = pointerToPlane(
        mouse.u,
        mouse.v,
        uniforms.projectionViewMatrix.current,
        grab.anchor,
      );
      onTug({ node: grab.node, target, k: TUG_K });
    } else if (!right && grab.node >= 0) {
      grab.node = -1;
      host()?.setAttribute("data-tug", "released");
      onTug(undefined);
    }
  }, [mouse]);
  return null;
};

/** Langevin dynamics of 1CRN's CA elastic network, scrubbable and tuggable. */
export const DynamicsScene = ({ data }: { data: StructureData }) => {
  const network = useMemo(
    () => elasticNetworkData(data.positions, data.topology, { version: 1 }),
    [data],
  );
  const [tug, setTug] = useState<LangevinTug | undefined>(undefined);
  // Right-drag tugs, so keep the browser's context menu off the canvas.
  useResource((dispose) => {
    const element = host();
    if (!element) return;
    const block = (event: Event) => event.preventDefault();
    element.addEventListener("contextmenu", block);
    dispose(() => element.removeEventListener("contextmenu", block));
  }, []);
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
