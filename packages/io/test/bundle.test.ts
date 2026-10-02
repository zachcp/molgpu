// Consumers bundle @molgpu/io with code splitting, so Mol* arrives in lazy
// chunks. Mol*'s mmcif.js is part of an import cycle; a second dynamic entry
// into that cycle once made bundled structureFromBcif fail with "Cannot read
// properties of undefined (reading 'Provider')" while every unbundled test
// passed. Bundle and run a real consumer to keep the lazy graph sound.
import { assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

Deno.test("structureFromBcif works from a code-split bundle", async () => {
  const dir = await Deno.makeTempDir({ prefix: "molgpu-io-bundle-" });
  try {
    const fixture = (id: string) =>
      fromFileUrl(new URL(`./fixtures/${id}.bcif`, import.meta.url));
    const entry = join(dir, "entry.ts");
    await Deno.writeTextFile(
      entry,
      `import { structureFromBcif } from ${
        JSON.stringify(
          new URL("../src/index.ts", import.meta.url).href,
        )
      };
const plain = await structureFromBcif(await Deno.readFile(${
        JSON.stringify(fixture("1ejg"))
      }));
const assembly = await structureFromBcif(await Deno.readFile(${
        JSON.stringify(fixture("1tqn"))
      }), { assembly: "2" });
console.log(JSON.stringify([plain.topology.atoms.count, assembly.topology.instances.count]));
`,
    );
    const bundle = await new Deno.Command(Deno.execPath(), {
      args: [
        "bundle",
        "--quiet",
        "--platform",
        "browser",
        "--code-splitting",
        "--outdir",
        join(dir, "dist"),
        entry,
      ],
      cwd: fromFileUrl(new URL("../../../", import.meta.url)),
    }).output();
    assertEquals(bundle.code, 0, new TextDecoder().decode(bundle.stderr));
    const run = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", join(dir, "dist", "entry.js")],
    }).output();
    const stderr = new TextDecoder().decode(run.stderr);
    assertEquals(run.code, 0, stderr);
    assertEquals(
      JSON.parse(new TextDecoder().decode(run.stdout).trim()),
      [843, 12],
      stderr,
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
