// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { byElement } from "@molgpu/fields";
import { BallAndStick, Surface } from "@molgpu/viewer";
import { ClipSlab } from "../clip.ts";
import type { MaterialMode, SceneOptions } from "../options.ts";

type Rgba = readonly [number, number, number, number];

const materialFor = (mode: MaterialMode) =>
  mode === "metal"
    ? { type: "pbr" as const, roughness: 0.2, metalness: 0.8 }
    : mode === "basic"
    ? { type: "basic" as const }
    : mode === "normal"
    ? { type: "normal" as const }
    : { type: "pbr" as const, roughness: 0.85, metalness: 0 };

// Faces the viewer's initial orbit (bearing 0.6, level): the slab removes the
// near side of the molecule. It is fixed in world space, so orbiting shows the
// cut from other angles.
const CLIP_NORMAL = [Math.sin(0.6), 0, -Math.cos(0.6)] as const;

const surfaceLayer = (options: SceneOptions) => {
  const color = (neutral: Rgba) =>
    options.surfaceColorMode === "element" ? byElement() : neutral;
  if (options.surfaceMode === "pumice") {
    return (
      <Surface
        probeRadius={0.5}
        resolution={0.4}
        color={color([0.52, 0.5, 0.47, 1])}
        material={{ type: "pbr", roughness: 1, metalness: 0 }}
      />
    );
  }
  const material = materialFor(options.materialMode);
  return options.surfaceMode === "glass"
    ? (
      <Surface
        resolution={0.55}
        color={color([0.55, 0.72, 0.98, 1])}
        opacity={0.3}
        material={material}
      />
    )
    : (
      <Surface
        resolution={0.55}
        color={color([0.75, 0.78, 0.86, 1])}
        material={material}
      />
    );
};

/** Clip depth (0 none, 0.5 through the centre, 1 everything) to slab start in Å. */
export const clipFrom = (data: StructureData, depth: number) => {
  const { min, max, center } = coordinateBounds(data)!;
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) /
    2;
  const middle = CLIP_NORMAL[0] * center[0] + CLIP_NORMAL[1] * center[1] +
    CLIP_NORMAL[2] * center[2];
  return middle - radius + 2 * radius * depth;
};

/** Surface + material: one SES surface with a choice of look and a clip slab. */
export const surfaceScene = (data: StructureData, options: SceneOptions) => {
  const surface = surfaceLayer(options);
  const clipped = options.clipDepth > 0;
  // Atoms show through glass, and through the opening a clip cuts.
  const atoms = options.surfaceMode === "glass" || clipped
    ? <BallAndStick ball={0.22} stick={0.16} color={byElement()} />
    : null;
  return [
    atoms,
    clipped
      ? (
        <ClipSlab
          normal={CLIP_NORMAL}
          from={clipFrom(data, options.clipDepth)}
        >
          {surface}
        </ClipSlab>
      )
      : surface,
  ].filter(Boolean);
};
