// Headless Linux Chrome needs Vulkan enabled for the SwiftShader WebGPU adapter.
// Other platforms already select their local backend with unsafe WebGPU.
export const webgpuBrowserArgs = Deno.build.os === "linux"
  ? [
    "--enable-unsafe-webgpu",
    "--use-angle=vulkan",
    "--enable-features=Vulkan",
    "--disable-vulkan-surface",
  ]
  : ["--enable-unsafe-webgpu"];
