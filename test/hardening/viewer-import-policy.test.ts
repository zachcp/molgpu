import { assertEquals } from "@std/assert";
import { violatesViewerRepresentationBoundary } from "../../scripts/viewer-import-policy.mjs";

Deno.test("viewer providers cannot depend on molecular or volume visuals", () => {
  for (
    const importer of [
      "structure/structure-context.ts",
      "coordinates/coordinate-kernel.ts",
      "volume/volume-context.ts",
      "rendering/column-source.ts",
    ]
  ) {
    for (
      const imported of [
        "representations/surface/surface.ts",
        "volume/representations/volume-slice.ts",
      ]
    ) {
      assertEquals(
        violatesViewerRepresentationBoundary(importer, imported),
        true,
        `${importer} -> ${imported}`,
      );
    }
  }
});

Deno.test("viewer entries and visual consumers retain their permitted dependencies", () => {
  for (
    const importer of [
      "index.ts",
      "advanced.ts",
      "representations/surface/surface.ts",
      "volume/representations/isosurface.ts",
    ]
  ) {
    assertEquals(
      violatesViewerRepresentationBoundary(
        importer,
        "representations/ribbon/ribbon-geometry.ts",
      ),
      false,
    );
  }
  assertEquals(
    violatesViewerRepresentationBoundary(
      "volume/efield.ts",
      "coordinates/coordinates-context.ts",
    ),
    false,
    "provider folders remain topics rather than dependency layers",
  );
});

Deno.test("viewer visual rule normalizes Windows paths without applying to other packages", () => {
  assertEquals(
    violatesViewerRepresentationBoundary(
      "volume\\efield.ts",
      "volume\\representations\\isosurface.ts",
    ),
    true,
  );
  assertEquals(
    violatesViewerRepresentationBoundary(
      "volume/efield.ts",
      "../other/representations/example.ts",
    ),
    false,
  );
});
