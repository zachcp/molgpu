// Research-only published GPU DSSP buffer replacement under a retained draw.
import { React, render, unmount, useState } from "@use-gpu/live";
import { AutoCanvas, WebGPU } from "@use-gpu/webgpu";
import { OrbitCamera, Pass, useDeviceContext } from "@use-gpu/workbench";
import { GpuDssp, Spacefill, Structure } from "@molgpu/viewer";
import { attribute, bySecondaryStructure, categorical } from "@molgpu/fields";
import { structureFromBcif } from "@molgpu/io";
import { WobbleCoordinates } from "../../../packages/viewer/test/fixtures/wobble-coordinates.ts";

void React;
const bytes = new Uint8Array(
  await (await fetch("/packages/io/test/fixtures/1crn.bcif")).arrayBuffer(),
);
const data = await structureFromBcif(bytes);
const elementColor = categorical(attribute("element"), {
  6: [1, 0, 0, 1],
  7: [0, 0, 1, 1],
  8: [0, 1, 0, 1],
}, [1, 1, 1, 1]);
const secondaryColor = bySecondaryStructure();
const controls = {
  palette: (_n: number) => {},
  epoch: (_n: number) => {},
  visible: (_b: boolean) => {},
  tick: (_n: number) => {},
  fence: () => Promise.resolve(),
  unmount: () => {},
  status: 0,
};
Object.assign(globalThis, { __scene: controls });

const App = () => {
  const device = useDeviceContext();
  const [palette, setPalette] = useState(0);
  const [epoch, setEpoch] = useState(0);
  const [visible, setVisible] = useState(true);
  const [tick, setTick] = useState(0);
  Object.assign(controls, {
    palette: setPalette,
    epoch: setEpoch,
    visible: setVisible,
    tick: setTick,
    fence: () => device.queue.onSubmittedWorkDone(),
  });
  return (
    <OrbitCamera radius={40} bearing={tick * 0.01}>
      <Pass>
        {visible
          ? (
            <Structure data={data}>
              <WobbleCoordinates phase={epoch ? 1.1 : 0.7}>
                <GpuDssp onStatus={() => controls.status++}>
                  <Spacefill
                    color={palette ? elementColor : secondaryColor}
                    material={{ type: "basic" }}
                  />
                </GpuDssp>
              </WobbleCoordinates>
            </Structure>
          )
          : null}
      </Pass>
    </OrbitCamera>
  );
};
let root: ReturnType<typeof render> | null = render(
  <WebGPU fallback={null}>
    <AutoCanvas selector="#root" samples={1}>
      <App />
    </AutoCanvas>
  </WebGPU>,
);
controls.unmount = () => {
  if (root) unmount(root);
  root = null;
};
