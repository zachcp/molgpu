# Single-file molecular viewer

[`hello.html`](hello.html) renders 1CRN with public molecular APIs beneath an
application-owned WebGPU canvas, camera, lights and pass. It needs no local
bundler or installation. The native import map uses published `@molgpu/*`
**0.2.0** through [esm.sh's JSR bridge](https://esm.sh/#supported-registries)
and use.gpu **0.20.0**. Inline JSX uses esm.sh's browser transformer at
`https://esm.sh/tsx`; that transformer endpoint is unversioned, so the entire
remote graph is not immutable even though the molecular packages are pinned.

From the repository root:

```sh
deno run --allow-net --allow-read jsr:@std/http/file-server examples --port 8080
```

Open `http://localhost:8080/hello.html` in a WebGPU-capable browser. Drag to
rotate, scroll to zoom, and click **Reset view**. Internet access is required
for modules and RCSB's 1CRN BinaryCIF. HTTPS is required outside localhost.
Opening the file directly also passed the October 10 Chrome acceptance, but
localhost is the documented default. Other browsers and their file-origin
policies have not been verified.

The camera target and radius are specific to 1CRN. The page uses `Structure`,
`Spacefill`, `structureFromBcif` and `byElement` from their public entries. A
`setImmediate` scheduling shim supports the CDN Mol* parser. There are no labels
or font assets. The browser JSX loader requested a WebAssembly compiler on the
HTTP run; the molecular scene did not request additional WASM. Import/device
errors appear in the status region; pagehide unmounts the Live root.

## Acceptance and decision

```sh
deno test -A examples/test/run-browser.mjs
```

This serves the HTML verbatim without Vite or workspace aliases, then tests
localhost and `file://` in fresh browser launches. It checks visible molecular
pixels, drag/zoom/reset, unavailable-WebGPU messaging, and browser/WebGPU errors
through unmount. It prints request counts and elapsed time; those depend on
network conditions and are not GPU timings or a guaranteed empty CDN cache.

Choose the CDN bridge for small online no-build examples. The October 10 run
loaded about 790 requests; the final run reached visible molecular pixels in 4.2
seconds over HTTP and 6.4 seconds over a file URL. One earlier file-origin run
rendered successfully but encountered a CDN HTTP 500; the final run passed with
no failed requests. Network availability is a real cost of this approach.

Native browser imports cannot execute the published TypeScript or `jsr:`
specifiers directly. A prebuilt local bundle is preferable for offline use,
controlled dependencies and fewer requests. Emitting/vendoring an ESM graph plus
an import map also works in principle, but requires an asset refresh process and
more than one file; it was not selected or built in this spike. An inline bundle
is an alternative for one distributable offline HTML file, at the cost of a
build step. No deployment or publication is part of this example.

See
[the decision record](../docs/findings/2026-10-10-clipping-and-rendering-spikes.md)
for the measured scope and follow-ups.
