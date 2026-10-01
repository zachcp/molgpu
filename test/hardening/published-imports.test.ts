import { assertEquals } from "@std/assert";
import { checkPublishedImports } from "../../scripts/published-imports.mjs";

const check = (source: string, name = "@molgpu/io") =>
  checkPublishedImports(
    name,
    new Map([["/src/index.ts", new TextEncoder().encode(source)]]),
  );

Deno.test("published imports accept unfurled dependencies and lazy Mol*", () => {
  assertEquals(
    check(
      'export { x } from "jsr:@molgpu/table@^0.1.0"; import("npm:/molstar@5.11.0/lib/parser.js");',
    ),
    [],
  );
});

Deno.test("published import guard detects injected dependency regressions", () => {
  for (
    const source of [
      'import { x } from "@molgpu/table";',
      'export { x } from "jsr:@molgpu/table@0.1.0";',
      'import { x } from "npm:@use-gpu/live@^0.20.0";',
      'import { x } from "npm:/molstar@5.11.0/lib/parser.js";',
      'import("npm:/molstar@^5.11.0/lib/parser.js");',
    ]
  ) assertEquals(check(source).length > 0, true, source);
  assertEquals(
    check('import("npm:molstar@5.11.0");', "@molgpu/viewer").length > 0,
    true,
  );
});

Deno.test("published use.gpu imports retain lower-package walls", () => {
  const files = (path: string, source: string) =>
    new Map([[path, new TextEncoder().encode(source)]]);
  assertEquals(
    checkPublishedImports(
      "@molgpu/timeline",
      files(
        "/src/internal/ease.ts",
        'import { x } from "npm:/@use-gpu/core@0.20.0/mjs/ease.mjs";',
      ),
    ),
    [],
  );
  assertEquals(
    checkPublishedImports(
      "@molgpu/dynamics",
      files("/src/index.ts", 'import { x } from "npm:@use-gpu/core@0.20.0";'),
    ).length > 0,
    true,
  );
});
