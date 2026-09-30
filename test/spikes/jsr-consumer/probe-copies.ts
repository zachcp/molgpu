// crj.11 multi-copy probe, run by run.ts inside an external consumer. The
// import map gives the consumer one @molgpu/table and @molgpu/timeline copy
// ("mine"); @molgpu/select, @molgpu/fields and @molgpu/viewer resolve their
// own dependency ranges. "theirs" names the copies those packages resolve.
// Each case records whether an opaque value crosses copies safely, fails
// explicitly, or silently misbehaves.
import * as mine from "@molgpu/table";
import * as theirs from "theirs/table";
import * as myTimeline from "@molgpu/timeline";
import * as theirTimeline from "theirs/timeline";
import { all, resolve } from "@molgpu/select";
import { byElement, evaluate } from "@molgpu/fields";

const data = mine.createStructure({
  positions: new Float32Array([0, 0, 0, 1.5, 0, 0]),
  topology: {
    atoms: {
      count: 2,
      id: ["1", "2"],
      name: ["C1", "N1"],
      altloc: ["", ""],
      residue: new Uint32Array(2),
      element: Uint8Array.from([6, 7]),
      occupancy: new Float32Array([1, 1]),
      bfactor: new Float32Array(2),
      radius: new Float32Array([1.7, 1.55]),
    },
    residues: {
      count: 1,
      chain: new Uint32Array(1),
      labelSeq: new Int32Array([1]),
      authSeq: ["1"],
      insertionCode: [""],
      comp: ["GLY"],
      polymer: ["protein"],
    },
    chains: {
      count: 1,
      model: new Int32Array([1]),
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
      count: 1,
      chain: new Uint32Array(1),
      operatorId: ["identity"],
      transform: Float64Array.from([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
      ]),
    },
  },
});

// The viewer is loaded lazily: whether Deno can link it at all is a finding.
let viewer: typeof import("@molgpu/viewer/advanced") | null = null;
let viewerLoad = "ok";
try {
  viewer = await import("@molgpu/viewer/advanced");
} catch (error) {
  viewerLoad = String(error).slice(0, 200);
}

const attempt = (fn: () => unknown) => {
  try {
    const value = fn();
    return { outcome: "ok", value: JSON.stringify(value)?.slice(0, 80) };
  } catch (error) {
    return { outcome: "error", message: String(error).slice(0, 200) };
  }
};

const curve = myTimeline.createCurve([
  { time: 0, value: 0 },
  { time: 1, value: 1 },
]);

console.log(JSON.stringify({
  sameTableModule: mine.createStructure === theirs.createStructure,
  sameTimelineModule: myTimeline.createCurve === theirTimeline.createCurve,
  viewerLoad,
  cases: {
    "table: their activeAtoms(my data)": attempt(() =>
      Array.from(theirs.activeAtoms(data))
    ),
    "table: their withAttributes(my data)": attempt(() =>
      theirs.withAttributes(data, {}).revision
    ),
    "table: their bondTopology(my data)": attempt(() =>
      theirs.bondTopology(data).count
    ),
    "table: their attributeColumn(my data, element)": attempt(() =>
      theirs.attributeColumn(data, "element")?.domain
    ),
    "select: resolve(all, my data)": attempt(() =>
      Array.from(resolve(all("atom"), data).indices)
    ),
    "fields: evaluate(byElement, my data)": attempt(() =>
      evaluate(byElement(), data).length
    ),
    "viewer: createStructureResource(my data)": attempt(() => {
      if (!viewer) throw new Error("viewer did not load in Deno");
      return viewer.createStructureResource(data).identity === data.identity;
    }),
    "timeline: their sample(my curve)": attempt(() =>
      theirTimeline.sample(curve, 0.5)
    ),
  },
}));
