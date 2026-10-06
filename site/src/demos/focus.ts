import type { StructureData } from "@molgpu/table";
import { where } from "@molgpu/select";
import type { CameraCurve } from "@molgpu/viewer";

/** Seconds a click-to-focus move takes. */
export const FOCUS_SECONDS = 0.8;

/**
 * A two-frame camera curve from the current orbit target and radius to the
 * picked atom's residue. The second frame is a `focus` query, so its target
 * and radius are resolved against the current structure when sampled, exactly
 * as a timeline story's focus frame is. Bearing and pitch stay with the user's
 * orbit (the site controls ignore the curve's).
 */
export const focusCurve = (
  data: StructureData,
  row: number,
  from: { readonly target: readonly number[]; readonly radius: number },
): CameraCurve => {
  const residues = data.topology.atoms.residue;
  const residue = residues[row];
  return [
    {
      time: 0,
      bearing: 0,
      pitch: 0,
      target: from.target,
      radius: from.radius,
      ease: "cosine",
    },
    {
      time: FOCUS_SECONDS,
      bearing: 0,
      pitch: 0,
      focus: where(
        "atom",
        `residue of atom ${row}`,
        (_, i) => residues[i] === residue,
      ),
      ease: "cosine",
    },
  ];
};
