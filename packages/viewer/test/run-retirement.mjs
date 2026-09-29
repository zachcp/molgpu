import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const spike = (name) =>
  fromFileUrl(
    new URL(`../../../test/spikes/gpu-retirement/${name}`, import.meta.url),
  );

Deno.test("published attribute retirement and GPU memory churn", async () => {
  for (
    const [name, args] of [
      ["run.mjs", ["--attribute", "--acceptance"]],
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
