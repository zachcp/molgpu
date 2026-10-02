// Bounded reproductions for the second architecture review. No large grids/GPU.
// Run: deno run -A docs/findings/evidence/2026-10-02-second-pass-science-probe.ts
import { structureFromBcif } from "@molgpu/io";
import {
  buildElasticNetwork,
  elasticNetworkData,
  normalModeFromElastic,
} from "@molgpu/dynamics";
// The private byte adapter isolates the download ceiling from format decoding.
import { urlByteSource } from "../../../packages/io/src/byte-source.ts";

const data = await structureFromBcif(
  await Deno.readFile(
    new URL("../../../packages/io/test/fixtures/1crn.bcif", import.meta.url),
  ),
);
for (
  const guide of [[0.5, 1.5, 2.5], [NaN, 1, 2], [2 ** 32, 1, 2]]
) {
  const result = elasticNetworkData(data.positions, data.topology, {
    guide,
    masses: new Float32Array([110, 110, 110]),
    version: 0,
  });
  let kernelResult = "accepted";
  try {
    buildElasticNetwork(data.positions, guide, 15);
  } catch (error) {
    kernelResult = (error as Error).message;
  }
  console.log({
    guide,
    adapterRows: [...result.guideRows],
    kernelResult,
  });
}

const source = await urlByteSource("https://example.invalid/file", {
  maxDownload: NaN,
  fetch: (() =>
    Promise.resolve(new Response(Uint8Array.of(1, 2, 3)))) as typeof fetch,
});
console.log({ nanDownloadBudgetAcceptedBytes: source.size });

const mapping = new Uint32Array([0]);
const mode = normalModeFromElastic(
  {
    kind: "anm",
    vector: new Float32Array([1, 0, 0]),
    eigenvalue: 1,
    residual: 0,
  },
  mapping,
  0,
);
mapping[0] = 0xffffffff;
console.log({ retainedMapAfterInputMutation: mode.atomToNode[0] });
