// deno-lint-ignore-file jsx-key
/** @jsx LiveReact.createElement */
import { React as LiveReact } from "@use-gpu/live";
import { FontLoader, SDFFontProvider } from "@use-gpu/workbench";
import type { StructureData } from "@molgpu/table";
import { resolve, where } from "@molgpu/select";
import {
  Bonds,
  Distance,
  Label,
  PickingProvider,
  Spacefill,
  usePicking,
} from "@molgpu/viewer";
import fontUrl from "../../assets/font.ttf?url";
import { formatMeasurement, measure } from "./measurements.ts";

const FONTS = [{ family: "sans", style: "normal", weight: 400, src: fontUrl }];
const PICKED = [1, 0.85, 0.2, 1] as const;

const atom = (data: StructureData, row: number) =>
  resolve(where("atom", `picked atom ${row}`, (_, i) => i === row), data);

/** Report the atom row under each left press to the page. */
const PickListener = ({ onPick }: { onPick: (row: number) => void }) => {
  usePicking({ onPick: (hit) => hit && onPick(hit.atom) });
  return null;
};

/**
 * Click atoms to measure: two give a distance, three an angle at the middle
 * atom, four the dihedral about the central bond. Values are a snapshot of
 * `data.positions` (Compose has static coordinates); the lines and labels are
 * the viewer's <Distance> and <Label>, which follow published coordinates.
 */
export const MeasureScene = (
  { data, picks, onPick }: {
    data: StructureData;
    picks: readonly number[];
    onPick: (row: number) => void;
  },
) => {
  const selected = picks.map((row) => atom(data, row));
  const result = measure(data.positions, picks);
  const P = data.positions;
  const at = (rows: readonly number[]) =>
    [0, 1, 2].map((k) =>
      rows.reduce((sum, row) => sum + P[3 * row + k], 0) / rows.length
    );
  // Angle reads at the vertex atom, a dihedral at the central bond.
  const anchor = picks.length === 3
    ? at([picks[1]])
    : picks.length === 4
    ? at([picks[1], picks[2]])
    : null;
  return (
    <FontLoader fonts={FONTS}>
      <SDFFontProvider>
        <PickingProvider>
          <Bonds width={0.15} />
          <Spacefill scale={0.25} pickable />
          {selected.map((select) => (
            <Spacefill select={select} scale={0.35} color={PICKED} />
          ))}
          {selected.slice(1).map((b, i) => (
            <Distance
              a={selected[i]}
              b={b}
              color={PICKED}
              labelColor={[1, 1, 1, 1]}
              size={picks.length === 2 ? 18 : 12}
            />
          ))}
          {anchor && (
            <Label
              at={anchor}
              text={formatMeasurement(result)}
              size={20}
              color={PICKED}
              offset={[0, 1.2, 0]}
            />
          )}
          <PickListener onPick={onPick} />
        </PickingProvider>
      </SDFFontProvider>
    </FontLoader>
  );
};
