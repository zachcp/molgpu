// A local stand-in for jsr.io, for crj.11. `deno publish` with
// JSR_URL=http://127.0.0.1:<port>/ uploads each package's publish tarball
// here (exactly the unfurled files jsr.io would store), and consumers with the
// same JSR_URL resolve `jsr:` specifiers from those files. Nothing leaves the
// machine; publishing to the real registry is never part of validation.
interface Stored {
  files: Map<string, Uint8Array<ArrayBuffer>>;
  exports: Record<string, string>;
}

const decoder = new TextDecoder();

// A publish tarball holds regular files in 512-byte ustar records.
async function untar(
  tgz: Uint8Array<ArrayBuffer>,
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const tar = new Uint8Array(
    await new Response(
      new Blob([tgz]).stream().pipeThrough(new DecompressionStream("gzip")),
    ).arrayBuffer(),
  );
  const field = (at: number, length: number) =>
    decoder.decode(tar.subarray(at, at + length)).replace(/\0.*$/s, "");
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (let at = 0; at + 512 <= tar.length && tar[at];) {
    const name = field(at, 100), prefix = field(at + 345, 155);
    const size = parseInt(field(at + 124, 12).trim() || "0", 8);
    const type = field(at + 156, 1);
    if (type === "0" || type === "") {
      const path = (prefix ? `${prefix}/` : "") + name;
      files.set(
        "/" + path.replace(/^\.?\//, ""),
        tar.slice(at + 512, at + 512 + size),
      );
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

const exportsOf = (config: { exports?: string | Record<string, string> }) =>
  typeof config.exports === "string"
    ? { ".": config.exports }
    : config.exports ?? {};

/** Start the registry; returns its base URL and a stop function. */
export function startRegistry(port = 0): {
  url: string;
  published: () => string[];
  files: (
    name: string,
    version: string,
  ) => Map<string, Uint8Array<ArrayBuffer>> | undefined;
  stop: () => Promise<void>;
} {
  // "@scope/name" -> version -> files
  const packages = new Map<string, Map<string, Stored>>();
  let tasks = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    });

  const server = Deno.serve(
    { port, hostname: "127.0.0.1", onListen() {} },
    async (req) => {
      const { pathname } = new URL(req.url);
      let m: RegExpMatchArray | null;

      // ---- publish API (what `deno publish` calls) ----
      if (
        (m = pathname.match(
          /^\/api\/scopes\/([^/]+)\/packages\/([^/]+)\/versions\/([^/]+)$/,
        ))
      ) {
        const [, scope, name, version] = m;
        const key = `@${scope}/${name}`;
        if (req.method === "GET") {
          return packages.get(key)?.has(version)
            ? json({ scope, package: name, version })
            : json({ code: "packageVersionNotFound" }, 404);
        }
        const files = await untar(new Uint8Array(await req.arrayBuffer()));
        const config = JSON.parse(
          decoder.decode(files.get("/deno.json") ?? files.get("/jsr.json")),
        );
        if (!packages.has(key)) packages.set(key, new Map());
        packages.get(key)!.set(version, { files, exports: exportsOf(config) });
        return json({ id: `task-${++tasks}`, status: "pending" });
      }
      if (pathname.match(/^\/api\/scopes\/[^/]+\/packages\/[^/]+$/)) {
        return json({});
      }
      if (pathname.startsWith("/api/publish_status/")) {
        return json({ id: pathname.split("/").pop(), status: "success" });
      }

      // ---- registry (what a consumer fetches) ----
      if ((m = pathname.match(/^\/(@[^/]+\/[^/]+)\/meta\.json$/))) {
        const versions = packages.get(m[1]);
        if (!versions) return json({}, 404);
        const sorted = [...versions.keys()].sort();
        return json({
          scope: m[1].slice(1).split("/")[0],
          name: m[1].split("/")[1],
          latest: sorted.at(-1),
          versions: Object.fromEntries(sorted.map((v) => [v, {}])),
        });
      }
      if ((m = pathname.match(/^\/(@[^/]+\/[^/]+)\/([^/]+)_meta\.json$/))) {
        const stored = packages.get(m[1])?.get(m[2]);
        if (!stored) return json({}, 404);
        const manifest: Record<string, { size: number; checksum: string }> = {};
        for (const [path, bytes] of stored.files) {
          manifest[path] = {
            size: bytes.byteLength,
            checksum: `sha256-${await sha256(bytes)}`,
          };
        }
        return json({ manifest, exports: stored.exports });
      }
      if ((m = pathname.match(/^\/(@[^/]+\/[^/]+)\/([^/]+)(\/.+)$/))) {
        const bytes = packages.get(m[1])?.get(m[2])?.files.get(
          decodeURIComponent(m[3]),
        );
        if (!bytes) return new Response("not found", { status: 404 });
        return new Response(bytes, {
          headers: {
            "content-type": m[3].endsWith(".json")
              ? "application/json"
              : "text/plain",
          },
        });
      }
      return json({ code: "notFound" }, 404);
    },
  );
  return {
    url: `http://127.0.0.1:${server.addr.port}/`,
    published: () =>
      [...packages].flatMap(([key, versions]) =>
        [...versions.keys()].map((v) => `${key}@${v}`)
      ).sort(),
    files: (name, version) => packages.get(name)?.get(version)?.files,
    stop: () => server.shutdown(),
  };
}
