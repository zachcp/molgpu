// crj.11 acceptance: resolve every public @molgpu entry the way a JSR consumer
// would, outside the workspace and without source aliases.
//
//   deno run -A test/spikes/jsr-consumer/run.ts [--browser] [--out file.json]
//
// 1. `deno publish` the workspace into a local registry (registry.ts), which
//    stores exactly the unfurled files jsr.io would serve.
// 2. In temporary consumers outside the repository, type-check every public
//    entry, measure each entry's static module graph, and type-check and
//    bundle a real JSX scene (scene.tsx). With --browser, render the bundle in
//    WebGPU Chrome and record when the lazy Mol* chunk is fetched.
// 3. Publish compatible and divergent @molgpu/table and @molgpu/timeline
//    copies and run probe-copies.ts to see whether opaque values cross copies.
//    Type-check the scene against a divergent use.gpu Live.
// Nothing is published to jsr.io; the registry exists only for this process.
import { fromFileUrl, join } from "@std/path";
import { startRegistry } from "./registry.ts";

const here = (path: string) => fromFileUrl(new URL(path, import.meta.url));
const root = here("../../../");
const args = Deno.args;
const browser = args.includes("--browser");
const out = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

const PACKAGES = [
  "table",
  "geo",
  "timeline",
  "select",
  "fields",
  "dynamics",
  "io",
  "viewer",
];
const ENTRIES = [
  ...PACKAGES.map((name) => `@molgpu/${name}`),
  "@molgpu/dynamics/wgsl",
  "@molgpu/viewer/advanced",
];
const USE_GPU = ["live", "webgpu", "workbench", "core", "shader"];

const registry = startRegistry();
const env = { JSR_URL: registry.url, NO_COLOR: "1" };
const decoder = new TextDecoder();

async function deno(args: string[], cwd: string) {
  const output = await new Deno.Command(Deno.execPath(), {
    args,
    cwd,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
}

const errors = (text: string) =>
  text.split("\n").filter((line) => /error|TS\d{4}/.test(line)).slice(0, 8);

/** A consumer project in the OS temp directory, outside any workspace. */
async function consumer(
  imports: Record<string, string>,
  files: string[] = [],
): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "molgpu-jsr-consumer-" });
  await Deno.writeTextFile(
    join(dir, "deno.json"),
    JSON.stringify(
      {
        imports,
        compilerOptions: { lib: ["ES2023", "DOM", "DOM.Iterable", "deno.ns"] },
      },
      null,
      2,
    ),
  );
  for (const file of files) {
    await Deno.copyFile(here(file), join(dir, file));
  }
  return dir;
}

const molgpu = (version = "0.1.0") =>
  Object.fromEntries(
    PACKAGES.map((
      name,
    ) => [`@molgpu/${name}`, `jsr:@molgpu/${name}@${version}`]),
  );
const useGpu = (version = "0.20.0") =>
  Object.fromEntries(
    USE_GPU.map((
      name,
    ) => [`@use-gpu/${name}`, `npm:@use-gpu/${name}@${version}`]),
  );

/** Publish a copy of one package at another version, from outside the workspace. */
async function publishCopy(name: string, version: string) {
  const dir = await Deno.makeTempDir({ prefix: `molgpu-${name}-${version}-` });
  const source = join(root, "packages", name);
  const config = JSON.parse(await Deno.readTextFile(join(source, "deno.json")));
  config.version = version;
  await Deno.writeTextFile(join(dir, "deno.json"), JSON.stringify(config));
  for (const entry of ["src", "README.md", "LICENSE", "CHANGELOG.md"]) {
    await new Deno.Command("cp", {
      args: ["-R", join(source, entry), join(dir, entry)],
    }).output();
  }
  const result = await deno(
    ["publish", "--token", "local", "--allow-dirty", "--allow-slow-types"],
    dir,
  );
  if (result.code) {
    throw new Error(`publish ${name}@${version}: ${result.stderr}`);
  }
}

/** Static (non-dynamic) module graph of one specifier. */
async function staticGraph(dir: string, specifier: string) {
  const { stdout, code, stderr } = await deno(
    ["info", "--json", specifier],
    dir,
  );
  if (code) throw new Error(`info ${specifier}: ${stderr}`);
  const info = JSON.parse(stdout) as {
    roots: string[];
    modules: {
      specifier: string;
      kind?: string;
      size?: number;
      dependencies?: {
        specifier: string;
        isDynamic?: boolean;
        code?: { specifier: string };
        type?: { specifier: string };
      }[];
    }[];
    redirects?: Record<string, string>;
  };
  const byId = new Map(info.modules.map((m) => [m.specifier, m]));
  const redirect = (s: string) => info.redirects?.[s] ?? s;
  const seen = new Set<string>();
  const npm = new Set<string>();
  const stack = info.roots.map(redirect);
  let bytes = 0;
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const module = byId.get(id);
    if (!module) continue;
    if (module.kind === "npm" || id.startsWith("npm:")) {
      npm.add(
        id.replace(/^npm:\/?/, "").split("/").slice(
          0,
          id.includes("npm:/@") || id.startsWith("npm:@") ? 2 : 1,
        ).join("/"),
      );
      continue;
    }
    bytes += module.size ?? 0;
    for (const dep of module.dependencies ?? []) {
      if (dep.isDynamic) continue;
      const target = dep.code?.specifier;
      if (target) stack.push(redirect(target));
    }
  }
  return {
    modules: [...seen].filter((s) => s.startsWith("http")).length,
    bytes,
    npm: [...npm].sort(),
  };
}

const report: Record<string, unknown> = {
  date: new Date().toISOString(),
  deno: Deno.version.deno,
};

try {
  // ---- 1. publish the workspace ----
  const published = await deno(
    ["publish", "--token", "local", "--allow-dirty"],
    root,
  );
  if (published.code) throw new Error(published.stderr);
  report.published = registry.published();

  // ---- 2a. every public entry, and its static cost ----
  const entries = await consumer({ ...molgpu(), ...useGpu() });
  await Deno.writeTextFile(
    join(entries, "entries.ts"),
    ENTRIES.map((entry, i) => `import * as e${i} from "${entry}";\nvoid e${i};`)
      .join("\n"),
  );
  const entryCheck = await deno(["check", "entries.ts"], entries);
  report.entries = {
    check: entryCheck.code === 0 ? "pass" : "fail",
    errors: errors(entryCheck.stderr),
    graphs: Object.fromEntries(
      await Promise.all(
        ENTRIES.map(async (
          entry,
        ) => [entry, await staticGraph(entries, entry)]),
      ),
    ),
  };

  // ---- 2b. a real JSX scene: check and bundle ----
  const scene = await consumer({ ...molgpu(), ...useGpu() }, ["scene.tsx"]);
  const sceneCheck = await deno(["check", "scene.tsx"], scene);
  const bundle = await deno(
    [
      "bundle",
      "--platform",
      "browser",
      "--code-splitting",
      "--outdir",
      "dist",
      "scene.tsx",
    ],
    scene,
  );
  // The entry's static closure is what loads with the page; everything else
  // is reached only through import(). Mol* chunks are named after its modules.
  const MOLSTAR =
    /^(mmcif|cif|ccp4|parser|mol-task|molecular-surface|boundary|ordered-set|grid|symbols|symbol-table|all|chem_comp|struct_conn|secondary-structure|util)-/;
  const chunks = {
    static: [] as string[],
    lazy: [] as string[],
    staticBytes: 0,
    totalBytes: 0,
    molstarStatic: [] as string[],
  };
  if (!bundle.code) {
    const dist = join(scene, "dist");
    const text = new Map<string, string>();
    for await (const file of Deno.readDir(dist)) {
      if (file.name.endsWith(".js")) {
        text.set(file.name, await Deno.readTextFile(join(dist, file.name)));
      }
    }
    const seen = new Set<string>(), stack = ["scene.js"];
    while (stack.length) {
      const name = stack.pop()!;
      if (seen.has(name) || !text.has(name)) continue;
      seen.add(name);
      for (
        const m of text.get(name)!.matchAll(
          /(?:^|\n)\s*(?:import|export)[^;()]*?from\s*"\.\/([^"]+)"/g,
        )
      ) stack.push(m[1]);
      for (
        const m of text.get(name)!.matchAll(
          /(?:^|\n)\s*import\s*"\.\/([^"]+)"/g,
        )
      ) stack.push(m[1]);
    }
    for (const [name, body] of text) {
      chunks.totalBytes += body.length;
      if (seen.has(name)) {
        chunks.static.push(name);
        chunks.staticBytes += body.length;
        if (MOLSTAR.test(name)) chunks.molstarStatic.push(name);
      } else chunks.lazy.push(name);
    }
    chunks.static.sort();
    chunks.lazy.sort();
  }
  report.scene = {
    check: sceneCheck.code === 0 ? "pass" : "fail",
    checkErrors: errors(sceneCheck.stderr),
    bundle: bundle.code === 0 ? "pass" : "fail",
    bundleErrors: errors(bundle.stderr),
    chunks,
  };
  if (browser && !bundle.code) {
    const { renderScene } = await import("./render.ts");
    (report.scene as Record<string, unknown>).render = await renderScene(
      join(scene, "dist"),
      join(root, "packages/io/test/fixtures/1ejg.bcif"),
    );
  }

  // ---- 3. copies ----
  const probe = async (label: string, mine: string, theirs: string) => {
    const dir = await consumer({
      ...molgpu(),
      "@molgpu/table": `jsr:@molgpu/table@${mine}`,
      "@molgpu/timeline": `jsr:@molgpu/timeline@${mine}`,
      "theirs/table": `jsr:@molgpu/table@${theirs}`,
      "theirs/timeline": `jsr:@molgpu/timeline@${theirs}`,
      ...useGpu(),
    }, ["probe-copies.ts"]);
    const result = await deno(["run", "-A", "probe-copies.ts"], dir);
    if (result.code) {
      return { label, error: errors(result.stderr).join("\n") };
    }
    return { label, mine, theirs, ...JSON.parse(result.stdout) };
  };
  await publishCopy("table", "0.1.1");
  await publishCopy("timeline", "0.1.1");
  const compatible = await probe("compatible", "0.1.1", "^0.1.0");
  await publishCopy("table", "0.2.0");
  await publishCopy("timeline", "0.2.0");
  const divergent = await probe("divergent", "0.2.0", "^0.1.0");

  // A consumer on another use.gpu line than the viewer's exact pin.
  const otherLive = await consumer({ ...molgpu(), ...useGpu("0.19.0") }, [
    "scene.tsx",
  ]);
  const otherCheck = await deno(["check", "scene.tsx"], otherLive);
  const otherGraph = await deno(["info", "--json", "scene.tsx"], otherLive);
  const liveVersions = [
    ...new Set(
      [...otherGraph.stdout.matchAll(/@use-gpu\/live@(\d+\.\d+\.\d+)/g)].map((
        m,
      ) => m[1]),
    ),
  ].sort();
  report.copies = {
    compatible,
    divergent,
    useGpu: {
      consumer: "0.19.0",
      viewer: "0.20.0",
      liveVersionsInGraph: liveVersions,
      check: otherCheck.code === 0 ? "pass" : "fail",
      errors: errors(otherCheck.stderr),
    },
  };
  report.status = "complete";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
} finally {
  await registry.stop();
  const text = JSON.stringify(report, null, 2);
  if (out) await Deno.writeTextFile(out, text + "\n");
  console.log(text);
}
