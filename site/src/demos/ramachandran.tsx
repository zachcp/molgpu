import React, { useRef, useState } from "react";
import {
  attributeColumn,
  backboneDihedrals,
  dssp,
  ssKind,
  type StructureData,
} from "@molgpu/table";

/** One plotted residue: its row, torsions (degrees) and display class. */
export interface RamaPoint {
  readonly residue: number;
  readonly phi: number;
  readonly psi: number;
  readonly kind: "helix" | "sheet" | "coil";
  readonly glycine: boolean;
  readonly label: string;
}

/** φ/ψ box in degrees, inclusive. */
export interface RamaBrush {
  readonly phi: readonly [number, number];
  readonly psi: readonly [number, number];
}

const cache = new WeakMap<StructureData, RamaPoint[]>();

/** Residues with both torsions defined, classed by secondary structure. */
export const ramachandranPoints = (data: StructureData): RamaPoint[] => {
  const hit = cache.get(data);
  if (hit) return hit;
  const { phi, psi } = backboneDihedrals(data);
  const { residues } = data.topology;
  const ss = attributeColumn(data, "ssCode")?.values ?? dssp(data);
  const points: RamaPoint[] = [];
  for (let r = 0; r < residues.count; r++) {
    if (!Number.isFinite(phi[r]) || !Number.isFinite(psi[r])) continue;
    points.push({
      residue: r,
      phi: phi[r],
      psi: psi[r],
      kind: ssKind(ss[r]),
      glycine: residues.comp[r] === "GLY",
      label: `${residues.comp[r]}${residues.authSeq[r]}`,
    });
  }
  cache.set(data, points);
  return points;
};

/** Residue rows whose φ/ψ lie in the brush. */
export const brushed = (
  points: readonly RamaPoint[],
  brush: RamaBrush | null,
): number[] =>
  brush
    ? points.filter((p) =>
      p.phi >= brush.phi[0] && p.phi <= brush.phi[1] &&
      p.psi >= brush.psi[0] && p.psi <= brush.psi[1]
    ).map((p) => p.residue)
    : [];

const SIZE = 240, PAD = 28;
const KIND_COLOR = { helix: "#e0409a", sheet: "#f2d33d", coil: "#c9d3df" };
const toX = (phi: number) => PAD + (phi + 180) / 360 * SIZE;
const toY = (psi: number) => PAD + (180 - psi) / 360 * SIZE;
const fromX = (x: number) =>
  Math.max(-180, Math.min(180, (x - PAD) / SIZE * 360 - 180));
const fromY = (y: number) =>
  Math.max(-180, Math.min(180, 180 - (y - PAD) / SIZE * 360));

/**
 * φ/ψ scatter with a drag-to-select box. Points are coloured by DSSP kind;
 * glycines are hollow. `marked` rings residues picked in the 3D view.
 */
export const RamachandranPlot = (
  { points, brush, marked, onBrush }: {
    points: readonly RamaPoint[];
    brush: RamaBrush | null;
    marked: number | null;
    onBrush: (brush: RamaBrush | null) => void;
  },
) => {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<[number, number, number, number] | null>(
    null,
  );
  const local = (event: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    const scale = (SIZE + 2 * PAD) / rect.width;
    return [
      (event.clientX - rect.left) * scale,
      (event.clientY - rect.top) * scale,
    ] as const;
  };
  const inBrush = new Set(brushed(points, brush));
  const box = drag
    ? {
      x: Math.min(drag[0], drag[2]),
      y: Math.min(drag[1], drag[3]),
      w: Math.abs(drag[2] - drag[0]),
      h: Math.abs(drag[3] - drag[1]),
    }
    : brush
    ? {
      x: toX(brush.phi[0]),
      y: toY(brush.psi[1]),
      w: toX(brush.phi[1]) - toX(brush.phi[0]),
      h: toY(brush.psi[0]) - toY(brush.psi[1]),
    }
    : null;
  const ticks = [-180, -90, 0, 90, 180];
  return (
    <svg
      ref={svg}
      className="ramachandran"
      role="img"
      aria-label="Ramachandran plot: drag to select residues by phi and psi"
      viewBox={`0 0 ${SIZE + 2 * PAD} ${SIZE + 2 * PAD}`}
      onPointerDown={(event) => {
        const [x, y] = local(event);
        svg.current!.setPointerCapture(event.pointerId);
        setDrag([x, y, x, y]);
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        const [x, y] = local(event);
        setDrag([drag[0], drag[1], x, y]);
      }}
      onPointerUp={() => {
        if (!drag) return;
        const [x0, y0, x1, y1] = drag;
        setDrag(null);
        // A click without a drag clears the brush.
        if (Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3) {
          return onBrush(null);
        }
        onBrush({
          phi: [fromX(Math.min(x0, x1)), fromX(Math.max(x0, x1))],
          psi: [fromY(Math.max(y0, y1)), fromY(Math.min(y0, y1))],
        });
      }}
    >
      <rect x={PAD} y={PAD} width={SIZE} height={SIZE} className="rama-frame" />
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={toX(t)}
            x2={toX(t)}
            y1={PAD}
            y2={PAD + SIZE}
            className="rama-grid"
          />
          <line
            y1={toY(t)}
            y2={toY(t)}
            x1={PAD}
            x2={PAD + SIZE}
            className="rama-grid"
          />
          <text x={toX(t)} y={PAD + SIZE + 14} textAnchor="middle">{t}</text>
          <text x={PAD - 4} y={toY(t) + 3} textAnchor="end">{t}</text>
        </g>
      ))}
      <text x={PAD + SIZE / 2} y={PAD - 10} textAnchor="middle">
        φ (°) → ψ (°) ↑
      </text>
      {points.map((p) => (
        <circle
          key={p.residue}
          cx={toX(p.phi)}
          cy={toY(p.psi)}
          r={inBrush.has(p.residue) ? 4.5 : 3}
          fill={p.glycine ? "none" : KIND_COLOR[p.kind]}
          stroke={KIND_COLOR[p.kind]}
          strokeWidth={1.4}
          opacity={brush && !inBrush.has(p.residue) ? 0.35 : 1}
        >
          <title>
            {`${p.label} φ ${p.phi.toFixed(1)}° ψ ${p.psi.toFixed(1)}°`}
          </title>
        </circle>
      ))}
      {points.filter((p) => p.residue === marked).map((p) => (
        <circle
          key="marked"
          data-marked={p.label}
          cx={toX(p.phi)}
          cy={toY(p.psi)}
          r={8}
          className="rama-marked"
        />
      ))}
      {box && (
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          className="rama-brush"
        />
      )}
    </svg>
  );
};
