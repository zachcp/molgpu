// Run from the repository root with deno run <this-file>.
import {
  flatAlpha,
  modeProps,
} from "../../../packages/viewer/src/rendering/opacity.ts";
const rgba = [1, 0, 0, 0.5];
console.log({
  flat: modeProps(undefined, flatAlpha(rgba, false)),
  field: modeProps(
    undefined,
    flatAlpha({ kind: "constant", type: "color", value: rgba }, true),
  ),
  explicit: modeProps("transparent", 1),
});
