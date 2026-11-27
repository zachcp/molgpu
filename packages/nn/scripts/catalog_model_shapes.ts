// Build a catalog of model layouts from safetensors headers alone: two range
// requests per file, no weights downloaded. Each entry stores the layout
// (`layoutFromNames`: experts collapsed, quantization scales dropped), not
// the raw tensor list, which runs to ~500k names for frontier MoE models. Hugging Face repos are read from
// `model.safetensors`, or every shard listed in `model.safetensors.index.json`;
// local `.safetensors` paths are read from disk.
//   deno run -A packages/nn/scripts/catalog_model_shapes.ts out.json \
//     openai-community/gpt2 facebook/esm2_t6_8M_UR50D path/to/model.safetensors
import {
  layoutFromNames,
  layoutParameters,
  readSafetensorsHeader,
  type SafetensorsEntry,
  safetensorsHeaderLength,
} from "../src/index.ts";

const [out, ...sources] = Deno.args;
if (!out || !sources.length) {
  console.error("usage: catalog_model_shapes.ts <out.json> <repo|file>...");
  Deno.exit(2);
}

const hub = (repo: string, file: string) =>
  `https://huggingface.co/${repo}/resolve/main/${file}`;

async function range(url: string, start: number, end: number) {
  const response = await fetch(url, {
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // A server that ignores Range sends the whole file; keep only what we asked for.
  return response.status === 206 ? bytes : bytes.subarray(start, end);
}

async function remoteHeader(url: string) {
  const length = safetensorsHeaderLength(await range(url, 0, 8));
  const bytes = new Uint8Array(8 + length);
  bytes.set(await range(url, 0, 8));
  bytes.set(await range(url, 8, 8 + length), 8);
  return readSafetensorsHeader(bytes);
}

async function localHeader(path: string) {
  const file = await Deno.open(path);
  try {
    const prefix = new Uint8Array(8);
    await file.read(prefix);
    const bytes = new Uint8Array(8 + safetensorsHeaderLength(prefix));
    await file.seek(0, Deno.SeekMode.Start);
    for (let at = 0; at < bytes.length;) {
      const n = await file.read(bytes.subarray(at));
      if (!n) throw new Error(`${path}: header truncated`);
      at += n;
    }
    return readSafetensorsHeader(bytes);
  } finally {
    file.close();
  }
}

async function headers(source: string) {
  if (source.endsWith(".safetensors")) {
    return { url: source, entries: await localHeader(source) };
  }
  const index = await fetch(hub(source, "model.safetensors.index.json"));
  if (!index.ok) {
    await index.body?.cancel();
    const url = hub(source, "model.safetensors");
    return { url, entries: await remoteHeader(url) };
  }
  const { weight_map } = await index.json() as {
    weight_map: Record<string, string>;
  };
  const entries = new Map<string, SafetensorsEntry>();
  const shards = [...new Set(Object.values(weight_map))];
  // A few shards at a time: large models have ~100.
  for (let i = 0; i < shards.length; i += 8) {
    const headers = await Promise.all(
      shards.slice(i, i + 8).map((shard) => remoteHeader(hub(source, shard))),
    );
    for (const header of headers) {
      for (const entry of header) entries.set(...entry);
    }
  }
  return { url: hub(source, "model.safetensors.index.json"), entries };
}

const models = [];
for (const source of sources) {
  const { url, entries } = await headers(source);
  let bytes = 0;
  const dtypes = new Set<string>();
  for (const { offsets, dtype } of entries.values()) {
    bytes += offsets[1] - offsets[0];
    dtypes.add(dtype);
  }
  const layout = layoutFromNames(entries);
  const parameters = layoutParameters(layout);
  models.push({
    id: source.endsWith(".safetensors")
      ? source.replace(/^.*\//, "").replace(/\.safetensors$/, "")
      : source,
    source: url,
    tensors: entries.size,
    bytes,
    parameters,
    dtypes: [...dtypes].sort(),
    stages: layout.stages,
  });
  console.log(
    `${source}: ${entries.size} tensors, ${layout.stages.length} stages, ${
      (parameters / 1e9).toFixed(2)
    }B matrix weights, ${(bytes / 2 ** 30).toFixed(1)} GiB`,
  );
}
await Deno.writeTextFile(
  out,
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), models }) +
    "\n",
);
