import {
  outputDirectory,
  runChild,
} from "../../../test/spikes/gpu-retirement/evidence.mjs";
import { fromFileUrl } from "@std/path";

const spike = (name) =>
  fromFileUrl(
    new URL(`../../../test/spikes/gpu-retirement/${name}`, import.meta.url),
  );

Deno.test("GPU retirement across held draws, compute, maps and memory churn", async () => {
  const directory = await outputDirectory();
  for (
    const [name, args] of [
      ["run.mjs", ["--volume", "--acceptance"]],
      ["run.mjs", ["--efield", "--acceptance"]],
      ["run.mjs", ["--lines", "--acceptance"]],
      ["run.mjs", [
        "--attribute",
        "--acceptance",
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
    const id = `${name.replace(".mjs", "")}${
      args.length
        ? "-" + args.map((arg) => arg.replace(/^--/, "")).join("-")
        : ""
    }`;
    await runChild(
      directory,
      id,
      new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", spike(name), ...args, `--output-dir=${directory}`],
        stdout: "piped",
        stderr: "piped",
      }),
    );
  }
});
