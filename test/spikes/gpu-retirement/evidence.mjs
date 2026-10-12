// Test artifact routing only. This module does not participate in GPU lifetime.
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const root = fromFileUrl(new URL("../../../", import.meta.url));
const unavailable = { unavailable: true };

export async function outputDirectory(args = Deno.args) {
  const option = args.find((arg) => arg.startsWith("--output-dir="));
  const requested = option?.slice("--output-dir=".length) ??
    Deno.env.get("MOLGPU_RETIREMENT_OUTPUT_DIR");
  if (requested === "") throw new Error("output directory must not be empty");
  const directory = requested
    ? resolve(requested)
    : await Deno.makeTempDir({ prefix: "molgpu-retirement-" });
  await Deno.mkdir(directory, { recursive: true });
  console.log(`Retirement evidence: ${directory}`);
  return directory;
}

async function git(args) {
  try {
    const result = await new Deno.Command("git", { cwd: root, args }).output();
    return result.success
      ? new TextDecoder().decode(result.stdout).trim()
      : null;
  } catch {
    return null;
  }
}

export async function provenance(scenario, args) {
  const commit = await git(["rev-parse", "HEAD"]);
  const status = await git(["status", "--porcelain"]);
  const versions = {};
  try {
    for (const entry of Deno.readDirSync(join(root, "node_modules/.deno"))) {
      if (!entry.name.startsWith("@use-gpu+")) continue;
      const name = entry.name.slice(0, entry.name.lastIndexOf("@"))
        .replace("+", "/");
      const manifest = JSON.parse(
        await Deno.readTextFile(
          join(
            root,
            "node_modules/.deno",
            entry.name,
            "node_modules",
            name,
            "package.json",
          ),
        ),
      );
      (versions[name] ??= []).push(manifest.version);
    }
  } catch {
    // Absence of the installed package tree is explicitly recorded below.
  }
  return {
    utc: new Date().toISOString(),
    source: {
      commit: commit ?? unavailable,
      dirty: status === null ? unavailable : status !== "",
      status: status ?? unavailable,
    },
    useGpuVersions: Object.keys(versions).length ? versions : unavailable,
    scenario,
    options: args,
    browser: unavailable,
    adapter: unavailable,
  };
}

export async function createEvidence(scenario, args = Deno.args) {
  const directory = await outputDirectory(args);
  const options = args.filter((arg) => !arg.startsWith("--output-dir="));
  const suffix = options.map((arg) =>
    arg.replace(/^--/, "").replace(/[^a-zA-Z0-9-]/g, "-")
  ).join("-");
  const path = join(directory, `${scenario}${suffix ? `-${suffix}` : ""}.json`);
  const metadata = await provenance(scenario, options);
  let report = null;
  const record = (outcome, error = null) => ({
    provenance: metadata,
    outcome,
    error,
    report,
  });
  // Reserve without truncating an existing artifact, even for explicit paths.
  await Deno.writeTextFile(
    path,
    JSON.stringify(record("running"), null, 2) + "\n",
    { createNew: true },
  );
  const save = (outcome, error) =>
    Deno.writeTextFile(
      path,
      JSON.stringify(record(outcome, error), null, 2) + "\n",
    );
  return {
    path,
    async report(value) {
      report = value;
      await save("running");
    },
    async observe(page, browser) {
      metadata.browser = browser.version();
      try {
        metadata.adapter = await page.evaluate(async () => {
          const adapter = await navigator.gpu?.requestAdapter();
          if (!adapter) return { unavailable: true };
          const {
            vendor,
            architecture,
            device,
            description,
            isFallbackAdapter,
          } = adapter.info;
          return {
            vendor,
            architecture,
            device,
            description,
            isFallbackAdapter,
          };
        });
      } catch (error) {
        metadata.adapter = { unavailable: true, reason: String(error) };
      }
    },
    async run(action) {
      try {
        await action();
        await save("passed");
      } catch (error) {
        await save("failed", error.stack ?? String(error));
        throw error;
      }
    },
  };
}

async function persist(stream, file) {
  try {
    for await (const chunk of stream) {
      let offset = 0;
      while (offset < chunk.length) {
        offset += await file.write(chunk.subarray(offset));
      }
    }
  } finally {
    file.close();
  }
}

export async function runChild(directory, id, command) {
  // Reserve logs before launch; repeated explicit destinations cannot overwrite.
  const stdoutPath = join(directory, `${id}.stdout.log`);
  const stderrPath = join(directory, `${id}.stderr.log`);
  await Deno.mkdir(dirname(stdoutPath), { recursive: true });
  const stdout = await Deno.open(stdoutPath, { write: true, createNew: true });
  let stderr;
  let child;
  try {
    stderr = await Deno.open(stderrPath, { write: true, createNew: true });
    child = command.spawn();
  } catch (error) {
    stdout.close();
    stderr?.close();
    throw error;
  }
  // Drain both pipes into files while the child runs. An external timeout can
  // kill this process before status resolves; diagnostics must already be saved.
  const results = await Promise.allSettled([
    child.status,
    persist(child.stdout, stdout),
    persist(child.stderr, stderr),
  ]);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
  const output = results[0].value;
  const trace = await Deno.readTextFile(stdoutPath);
  if (trace.length) {
    console.log(trace);
  }
  if (!output.success) {
    const diagnostics = await Deno.readTextFile(stderrPath);
    throw new Error(
      `${id} failed (exit ${output.code}); diagnostics: ${stderrPath}\n${diagnostics}`,
    );
  }
}
