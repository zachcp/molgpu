// Headless Linux Chrome needs Vulkan enabled for the SwiftShader WebGPU adapter.
// Other platforms already select their local backend with unsafe WebGPU.
// MOLGPU_CHROME_ARGS (space-separated) replaces the defaults, e.g. to probe CI.
const override = Deno.env.get("MOLGPU_CHROME_ARGS")?.trim();
export const webgpuBrowserArgs = override
  ? override.split(/\s+/)
  : Deno.build.os === "linux"
  ? [
    "--enable-unsafe-webgpu",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--disable-vulkan-surface",
  ]
  : ["--enable-unsafe-webgpu"];
