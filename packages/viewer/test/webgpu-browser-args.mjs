// Headless Linux Chrome (CI, no GPU) renders WebGPU through SwiftShader for
// Vulkan, ANGLE and the adapter; without the blocklist override, rendering
// suites draw nothing or lose the GPU instance. Other platforms already select
// their local backend with unsafe WebGPU.
// MOLGPU_CHROME_ARGS (space-separated) replaces the defaults, e.g. to probe CI.
const override = Deno.env.get("MOLGPU_CHROME_ARGS")?.trim();
export const webgpuBrowserArgs = override
  ? override.split(/\s+/)
  : Deno.build.os === "linux"
  ? [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan",
    "--use-vulkan=swiftshader",
    "--use-webgpu-adapter=swiftshader",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
  ]
  : ["--enable-unsafe-webgpu"];
