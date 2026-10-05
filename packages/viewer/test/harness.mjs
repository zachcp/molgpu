// Shared browser-suite setup (molgpu-sept-s5o.6): the Vite dev server every
// dev-server runner configured by hand, WebGPU browser launch, and page error
// capture. Readiness, fixtures, lifetimes and budgets stay in each runner.
import { createServer } from "vite";
import { chromium } from "playwright";
import { webgpuBrowserArgs } from "./webgpu-browser-args.mjs";
import { workspaceAliases } from "../../../scripts/workspace-aliases.mjs";

const root = new URL("../../../", import.meta.url).pathname;

/** use.gpu entries the runners load eagerly, prebundled before navigation. */
export const USE_GPU_PREBUNDLE = [
  "@use-gpu/live",
  "@use-gpu/workbench",
  "@use-gpu/webgpu",
  "@use-gpu/core",
  // @molgpu/timeline imports this pinned easing module. Prebundle it before
  // navigation so Vite does not reload live modules with an Outdated Optimize
  // Dep response during the test.
  "@use-gpu/core/mjs/ease.mjs",
  "@use-gpu/shader",
  "@use-gpu/shader/wgsl",
  "@use-gpu/wgsl",
];

/** The automatic JSX runtime is injected by the transform, so the dependency
 * scan cannot see it; on a slow cold start Vite found it after navigation and
 * answered with an Outdated Optimize Dep 504 (PR #88 CI, run-superpose-source). */
const JSX_RUNTIME_PREBUNDLE = ["react/jsx-dev-runtime"];

/**
 * Every Mol* module @molgpu/io loads, read from its source. io is a workspace
 * package excluded from optimization, so without these Vite discovers them
 * only after navigation and reloads the page on a cold cache.
 */
export function ioMolstarModules() {
  const modules = new Set();
  const dir = new URL("../../io/src/", import.meta.url);
  for (const entry of Deno.readDirSync(dir)) {
    if (!entry.name.endsWith(".ts")) continue;
    const source = Deno.readTextFileSync(new URL(entry.name, dir));
    for (const match of source.matchAll(/"(molstar\/lib\/[^"]+\.js)"/g)) {
      modules.add(match[1]);
    }
  }
  return [...modules].sort();
}

/** Workspace packages: served from source, never prebundled. */
const workspacePackages = () =>
  Object.keys(workspaceAliases()).filter((name) =>
    name.split("/").length === 2
  );

/**
 * Start the repository-root Vite dev server on `port` for `entries` (HTML
 * paths relative to the root). `cacheDir` isolates a cold cache; `oxc`
 * passes JSX options through; `noDiscovery` forbids late optimization;
 * `exclude` adds packages to leave unbundled. Exclusion is per runner: an
 * excluded dependency of a prebundled package must still resolve from the
 * cache directory, which an isolated cacheDir outside the root cannot.
 */
export async function startDevServer(
  {
    port,
    entries,
    cacheDir,
    oxc,
    noDiscovery = false,
    strictPort = true,
    exclude = [],
  },
) {
  const server = await createServer({
    ...(cacheDir ? { cacheDir } : {}),
    root,
    configFile: false,
    ...(oxc ? { oxc } : {}),
    resolve: { alias: workspaceAliases() },
    server: { host: "127.0.0.1", port, strictPort },
    optimizeDeps: {
      ...(noDiscovery ? { noDiscovery: true } : {}),
      entries,
      exclude: [...workspacePackages(), ...exclude],
      include: [
        ...USE_GPU_PREBUNDLE,
        ...JSX_RUNTIME_PREBUNDLE,
        ...ioMolstarModules(),
      ],
    },
  });
  await server.listen();
  return server;
}

/** Headless Chrome with the WebGPU flags every suite uses. */
export function launchWebGpuBrowser() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
    args: webgpuBrowserArgs,
  });
}

/** Collect page errors and console errors from `page` into one array. */
export function captureErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}
