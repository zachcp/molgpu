// From the repository root after installing pinned dependencies:
// deno run --no-config --import-map docs/findings/evidence/2026-10-04-live-import-map.json docs/findings/evidence/2026-10-04-source-failure-probe.ts
// Uses the actual request hook and pinned Live ESM entry, without GPU work.
import { renderSync, unmount, use } from "@use-gpu/live";
import { useSourceRequest } from "../../../packages/viewer/src/internal/source-request.ts";

for (const reason of [undefined, null, false, 0, "", new Error("expected")]) {
  let finish!: (state: [unknown, unknown, boolean]) => void;
  const done = new Promise<[unknown, unknown, boolean]>((r) => finish = r);
  const Probe = () => {
    const result = useSourceRequest(() => Promise.reject(reason), []);
    if (!result[2]) finish(result);
    return null;
  };
  const fiber = renderSync(use(Probe));
  const [value, failure, pending] = await done;
  console.log(JSON.stringify({
    reason: String(reason),
    value: String(value),
    failure: String(failure),
    pending,
    structureVolumeErrorBranch: Boolean(failure),
    trajectoryErrorBranch: failure !== undefined,
  }));
  unmount(fiber);
}
