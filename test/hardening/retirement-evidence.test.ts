import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  createEvidence,
  outputDirectory,
  runChild,
} from "../spikes/gpu-retirement/evidence.mjs";

Deno.test("retirement artifacts use fresh destinations and refuse collisions", async () => {
  const previous = Deno.env.get("MOLGPU_RETIREMENT_OUTPUT_DIR");
  Deno.env.delete("MOLGPU_RETIREMENT_OUTPUT_DIR");
  const first = await outputDirectory([]);
  const second = await outputDirectory([]);
  try {
    assert(first !== second);
    Deno.env.set("MOLGPU_RETIREMENT_OUTPUT_DIR", second);
    assertEquals(await outputDirectory([]), second);
    assertEquals(await outputDirectory([`--output-dir=${first}`]), first);
    const args = [`--output-dir=${first}`, "--passes"];
    const evidence = await createEvidence("owner", args);
    await evidence.run(async () => await evidence.report({ held: true }));
    const record = JSON.parse(await Deno.readTextFile(evidence.path));
    assertEquals(record.outcome, "passed");
    assertEquals(record.report, { held: true });
    assertEquals(record.provenance.options, ["--passes"]);
    assert(!Number.isNaN(Date.parse(record.provenance.utc)));
    assertEquals(typeof record.provenance.source.commit, "string");
    assertEquals(typeof record.provenance.source.dirty, "boolean");
    assertEquals(record.provenance.useGpuVersions["@use-gpu/live"], [
      "0.21.0-rc.7",
    ]);
    assertEquals(record.provenance.browser, { unavailable: true });
    assertEquals(record.provenance.adapter, { unavailable: true });
    await assertRejects(
      () => createEvidence("owner", args),
      Deno.errors.AlreadyExists,
    );
    const other = await createEvidence("owner", [...args, "--same-size"]);
    assert(other.path !== evidence.path);
    assertEquals(JSON.parse(await Deno.readTextFile(evidence.path)), record);
  } finally {
    if (previous === undefined) Deno.env.delete("MOLGPU_RETIREMENT_OUTPUT_DIR");
    else Deno.env.set("MOLGPU_RETIREMENT_OUTPUT_DIR", previous);
    await Deno.remove(first, { recursive: true });
    await Deno.remove(second, { recursive: true });
  }
});

Deno.test("retirement diagnostics reach files before a hung child is terminated", async () => {
  const directory = await Deno.makeTempDir();
  const pidPath = join(directory, "child.pid");
  let pid: number | undefined;
  const running = runChild(
    directory,
    "hung",
    new Deno.Command(Deno.execPath(), {
      args: [
        "eval",
        `await Deno.writeTextFile(${JSON.stringify(pidPath)}, String(Deno.pid));
console.log("before timeout"); console.error("held resource diagnostic");
setInterval(() => {}, 1000);`,
      ],
      stdout: "piped",
      stderr: "piped",
    }),
  );
  // Attach a rejection handler immediately; termination is expected below.
  const settled = running.catch((error) => error);
  try {
    const deadline = Date.now() + 5000;
    let retained = false;
    while (Date.now() < deadline) {
      try {
        pid = Number(await Deno.readTextFile(pidPath));
        retained =
          await Deno.readTextFile(join(directory, "hung.stdout.log")) ===
            "before timeout\n" &&
          await Deno.readTextFile(join(directory, "hung.stderr.log")) ===
            "held resource diagnostic\n";
        if (retained) break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert(retained, "both streams must be persisted while the child is alive");
  } finally {
    // Also clean up on a regression, when the buffered implementation times out.
    if (pid === undefined) {
      try {
        pid = Number(await Deno.readTextFile(pidPath));
      } catch {
        // No child was launched.
      }
    }
    if (pid !== undefined) Deno.kill(pid, "SIGTERM");
    const error = await settled;
    await Deno.remove(directory, { recursive: true });
    assert(error instanceof Error);
    assert(error.message.includes("hung failed (exit"));
  }
});

Deno.test("retirement failures retain reports and child diagnostics and propagate", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const evidence = await createEvidence("failure", [
      `--output-dir=${directory}`,
    ]);
    await assertRejects(
      () =>
        evidence.run(async () => {
          await evidence.report({ pendingMaps: 1 });
          throw new Error("held map assertion");
        }),
      Error,
      "held map assertion",
    );
    const record = JSON.parse(await Deno.readTextFile(evidence.path));
    assertEquals(record.outcome, "failed");
    assertEquals(record.report, { pendingMaps: 1 });
    assert(record.error.includes("held map assertion"));
    await assertRejects(
      () =>
        runChild(
          directory,
          "child",
          new Deno.Command(Deno.execPath(), {
            args: [
              "eval",
              'console.log("trace"); console.error("assertion failed"); Deno.exit(7);',
            ],
            stdout: "piped",
            stderr: "piped",
          }),
        ),
      Error,
      "exit 7",
    );
    assertEquals(
      await Deno.readTextFile(join(directory, "child.stdout.log")),
      "trace\n",
    );
    assertEquals(
      await Deno.readTextFile(join(directory, "child.stderr.log")),
      "assertion failed\n",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
