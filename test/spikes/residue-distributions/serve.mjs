import { startDevServer } from "../../../packages/viewer/test/harness.mjs";

export function startSketch() {
  return startDevServer({
    port: 5287,
    entries: ["test/spikes/residue-distributions/index.html"],
    oxc: {
      jsx: {
        runtime: "classic",
        pragma: "React.createElement",
        pragmaFrag: "React.Fragment",
      },
    },
  });
}

if (import.meta.main) {
  await startSketch();
  console.log(
    "Open http://127.0.0.1:5287/test/spikes/residue-distributions/index.html",
  );
}
