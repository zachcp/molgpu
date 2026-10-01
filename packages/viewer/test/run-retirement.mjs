import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const spike = (name) =>
  fromFileUrl(
    new URL(`../../../test/spikes/gpu-retirement/${name}`, import.meta.url),
  );

Deno.test("GPU retirement across held draws, compute, maps and memory churn", async () => {
  for (
    const [name, args] of [
      ["run.mjs", ["--volume", "--acceptance", "--evidence-date=2026-10-01"]],
      ["run.mjs", ["--efield", "--acceptance", "--evidence-date=2026-10-01"]],
      ["run.mjs", ["--lines", "--acceptance", "--evidence-date=2026-10-01"]],
      ["run.mjs", [
        "--attribute",
        "--acceptance",
        "--evidence-date=2026-10-01",
      ]],
      ["run-matrix.mjs", ["--passes"]],
      ["run-matrix.mjs", ["--passes", "--same-size"]],
      ["run-matrix.mjs", ["--inflight", "dssp"]],
      ["run-readbacks.mjs", []],
      ["run-status.mjs", []],
      ["run-coordinate-memory.mjs", []],
      ["run-memory.mjs", []],
    ]
  ) {
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", spike(name), ...args],
    }).output();
    const stdout = new TextDecoder().decode(output.stdout);
    const stderr = new TextDecoder().decode(output.stderr);
    if (stdout) console.log(stdout);
    assertEquals(output.code, 0, `${name} failed:\n${stderr}`);
  }
});
