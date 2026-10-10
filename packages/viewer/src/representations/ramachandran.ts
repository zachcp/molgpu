import { use, useMemo } from "@use-gpu/live";
import type { ShaderSource } from "@use-gpu/shader";
import { wgsl } from "@use-gpu/shader/wgsl";
import {
  FaceLayer,
  LineLayer,
  PointLayer,
  useRenderContext,
  useShader,
  useShaderRef,
  useViewContext,
} from "@use-gpu/workbench";
import type { Field } from "@molgpu/fields";
import { useCoordinateSnapshot } from "../coordinates/coordinate-snapshot.ts";
import {
  DEFAULT_RAMACHANDRAN_COLOR,
  insetRect,
  plotAxes,
  type RamachandranCorner,
  type RamachandranPoint,
  ramachandranPoints,
} from "./ramachandran-points.ts";
import type { VectorLike, ViewerComponent } from "../types.ts";
import {
  type ColumnMap,
  type ColumnSpec,
  withColumns,
} from "../rendering/representation.ts";

// Each grid/frame line is its own open segment: 1 = start, 2 = end.
const lineSegments = (count: number) =>
  Int32Array.from({ length: 2 * count }, (_, i) => i % 2 ? 2 : 1);

// Inset pixels (CSS px, origin top-left) to world positions that the scene
// camera projects straight back onto those pixels: clip = pixel / canvas,
// world = inverse(projection · view) · clip. The camera's inverse matrix is
// a ref the view updates each frame, so orbiting uploads nothing.
const INSET_POSITION = wgsl`
@link fn getPixel(index: u32) -> vec4<f32>;
@link fn getCanvas() -> vec2<f32>;
@link fn getClipToWorld() -> mat4x4<f32>;
@export fn getInsetPosition(index: u32) -> vec4<f32> {
  let pixel = getPixel(index);
  let canvas = getCanvas();
  let clip = vec4<f32>(
    pixel.x / canvas.x * 2.0 - 1.0,
    1.0 - pixel.y / canvas.y * 2.0,
    0.5,
    1.0,
  );
  let world = getClipToWorld() * clip;
  return vec4<f32>(world.xyz / world.w, 1.0);
}
`;

/** Inset layers drawn inside the scene pass with screen-locked positions. */
const InsetLayers = (
  { map, points, lines, background, gridColor, pointSize, canvas }: {
    map: ColumnMap;
    points: number;
    lines: number;
    background: VectorLike;
    gridColor: VectorLike;
    pointSize: number;
    canvas: [number, number];
  },
) => {
  const { uniforms } = useViewContext();
  const canvasRef = useShaderRef(canvas);
  const clipToWorld = useShaderRef(uniforms.inverseProjectionViewMatrix);
  const at = (source: ShaderSource | null) =>
    useShader(INSET_POSITION, [source, canvasRef, clipToWorld]);
  const quad = at(map.quad);
  const grid = at(map.lines);
  const dots = at(map.positions);
  // Screen-locked overlay: no depth, shadows, picking or lighting.
  const flat = { depthTest: false, depthWrite: false, shadow: false } as const;
  return [
    use(FaceLayer, {
      positions: quad,
      indices: map.indices,
      color: background,
      mode: "transparent",
      ...flat,
    }),
    use(LineLayer, {
      positions: grid,
      segments: map.segments,
      count: lines,
      color: gridColor,
      width: 1,
      mode: "transparent",
      ...flat,
    }),
    points
      ? use(PointLayer, {
        positions: dots,
        colors: map.colors,
        count: points,
        size: pointSize,
        mode: "transparent",
        ...flat,
      })
      : null,
  ];
};

/**
 * Inset Ramachandran plot (φ, ψ in −180…180°) of the nearest structure,
 * screen-locked in a corner of the canvas. It draws inside the scene's pass
 * (positions are mapped through the inverse camera in the vertex shader), so
 * it needs no separate pass or camera and orbiting never re-uploads it.
 * Snapshot-based: it reads published coordinates (`snapshotHz`, default 4 Hz),
 * so points can lag trajectories and coordinate providers. The final revision
 * remains scheduled within that rate interval. Grid lines mark 0 and ±90°. Mount it beneath a <Structure>.
 */
export const Ramachandran: ViewerComponent<{
  corner?: RamachandranCorner;
  /** Plot edge in CSS pixels. Defaults to 220. */
  size?: number;
  /** Gap to the canvas edges in CSS pixels. Defaults to 16. */
  margin?: number;
  /** A colour or a Field evaluated per atom (e.g. bySecondaryStructure()). */
  color?: Field | VectorLike;
  /** Point diameter in CSS pixels. Defaults to 5. */
  pointSize?: number;
  background?: VectorLike;
  gridColor?: VectorLike;
  snapshotHz?: number;
  /** Called with the plotted points whenever a snapshot changes them. */
  onPoints?: (points: readonly RamachandranPoint[]) => void;
}> = (props) => {
  const {
    corner = "bottom-right",
    size = 220,
    margin = 16,
    color = DEFAULT_RAMACHANDRAN_COLOR,
    pointSize = 5,
    background = [0.02, 0.04, 0.07, 0.8],
    gridColor = [0.35, 0.45, 0.58, 0.9],
    snapshotHz = 4,
    onPoints,
  } = props;
  const snapshot = useCoordinateSnapshot({ maxHz: snapshotHz });
  const { width, height, pixelRatio } = useRenderContext();
  const w = width / pixelRatio, h = height / pixelRatio;
  const { left, top } = insetRect(corner, size, margin, w, h);

  const points = useMemo(
    () => snapshot ? ramachandranPoints(snapshot.data, color) : [],
    [snapshot, color],
  );
  useMemo(() => onPoints?.(points), [points, onPoints]);

  const specs = useMemo(() => {
    const [x, y] = plotAxes(left, top, size);
    const positions = new Float32Array(Math.max(1, points.length) * 4);
    const colors = new Float32Array(Math.max(1, points.length) * 4);
    points.forEach((p, i) => {
      positions.set([x(p.phi), y(p.psi), 0, 1], 4 * i);
      colors.set(p.color, 4 * i);
    });
    const lines: number[] = [];
    const add = (x0: number, y0: number, x1: number, y1: number) =>
      lines.push(x0, y0, 0, 1, x1, y1, 0, 1);
    for (const t of [-180, -90, 0, 90, 180]) {
      add(x(t), y(-180), x(t), y(180));
      add(x(-180), y(t), x(180), y(t));
    }
    const r = left + size, b = top + size;
    return {
      points: points.length,
      lines: lines.length / 4,
      columns: [
        { key: "positions", data: positions, format: "vec4<f32>" },
        { key: "colors", data: colors, format: "vec4<f32>" },
        { key: "lines", data: Float32Array.from(lines), format: "vec4<f32>" },
        {
          key: "segments",
          data: lineSegments(lines.length / 8),
          format: "i32",
        },
        {
          key: "quad",
          data: Float32Array.of(
            left,
            top,
            0,
            1,
            r,
            top,
            0,
            1,
            r,
            b,
            0,
            1,
            left,
            b,
            0,
            1,
          ),
          format: "vec4<f32>",
        },
        {
          key: "indices",
          data: Uint32Array.of(0, 1, 2, 0, 2, 3),
          format: "u32",
        },
      ] as ColumnSpec[],
    };
  }, [points, left, top, size]);

  return withColumns(specs.columns, (map) =>
    use(InsetLayers, {
      map,
      points: specs.points,
      lines: specs.lines,
      background,
      gridColor,
      pointSize,
      canvas: [w, h],
    }));
};
