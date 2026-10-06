/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import { coordinateBounds, type StructureData } from "@molgpu/table";
import { byElement } from "@molgpu/fields";
import { BallAndStick, Surface } from "@molgpu/viewer";
import { ClipSlab } from "../clip.ts";
import { glassMaterial, pumiceMaterial } from "../surface-look.ts";
import type { MaterialMode, SceneOptions } from "../options.ts";

type Rgba = readonly [number, number, number, number];

const materialFor = (mode: MaterialMode, roughness: number) =>
  mode === "metal"
    ? { type: "pbr" as const, roughness, metalness: 0.8 }
    : mode === "basic"
    ? { type: "basic" as const }
    : mode === "normal"
    ? { type: "normal" as const }
    : { type: "pbr" as const, roughness, metalness: 0 };

const isPbr = (mode: MaterialMode) => mode === "matte" || mode === "metal";

// Faces the viewer's initial orbit (bearing 0.6, level): the slab's front cut
// removes the near side of the molecule and its back cut the far side. It is fixed in world space, so orbiting shows the
// cut from other angles.
const CLIP_NORMAL = [Math.sin(0.6), 0, -Math.cos(0.6)] as const;

const surfaceLayer = (options: SceneOptions) => {
  const color = (neutral: Rgba) =>
    options.surfaceColorMode === "element" ? byElement() : neutral;
  if (options.surfaceMode === "pumice") {
    return (
      <Surface
        kind={options.surfaceKind}
        resolution={0.4}
        color={color([0.52, 0.5, 0.47, 1])}
        material={pumiceMaterial({
          roughness: options.roughness,
          amplitude: options.bump,
          scale: options.bumpScale,
        })}
      />
    );
  }
  if (options.surfaceMode === "glass") {
    // Fresnel fades faces turned to the camera, so the base opacity is higher.
    const fresnel = isPbr(options.materialMode);
    return (
      <Surface
        kind={options.surfaceKind}
        resolution={0.55}
        color={color([0.55, 0.72, 0.98, 1])}
        opacity={fresnel && options.fresnel ? 0.8 : 0.3}
        material={fresnel
          ? glassMaterial({
            roughness: options.roughness,
            metalness: options.materialMode === "metal" ? 0.8 : 0,
            fresnel: options.fresnel,
          })
          : materialFor(options.materialMode, options.roughness)}
      />
    );
  }
  return (
    <Surface
      kind={options.surfaceKind}
      resolution={0.55}
      color={color([0.75, 0.78, 0.86, 1])}
      material={materialFor(options.materialMode, options.roughness)}
    />
  );
};

/** View-depth fraction (0 the near side, 1 the far side) to Å along the clip normal. */
export const clipFrom = (data: StructureData, depth: number) => {
  const { min, max, center } = coordinateBounds(data)!;
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) /
    2;
  const middle = CLIP_NORMAL[0] * center[0] + CLIP_NORMAL[1] * center[1] +
    CLIP_NORMAL[2] * center[2];
  return middle - radius + 2 * radius * depth;
};

/** Surface + material: one surface with a choice of look and a clip slab. */
export const surfaceScene = (data: StructureData, options: SceneOptions) => {
  const surface = surfaceLayer(options);
  const [front, back] = options.clip;
  const clipped = front > 0 || back < 1;
  // Atoms show through glass, and through the openings a clip cuts.
  const atoms = options.surfaceMode === "glass" || clipped
    ? <BallAndStick ball={0.22} stick={0.16} color={byElement()} />
    : null;
  return [
    atoms,
    clipped
      ? (
        <ClipSlab
          normal={CLIP_NORMAL}
          from={clipFrom(data, front)}
          to={clipFrom(data, back)}
        >
          {surface}
        </ClipSlab>
      )
      : surface,
  ].filter(Boolean);
};
