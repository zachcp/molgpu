import type { SelectionDiagnostics, SelectionInput } from "../types.ts";
import { SelectionConsumer } from "../selection/selection-consumer.ts";
import type { Field } from "@molgpu/fields";
import type { Selection } from "@molgpu/select";
import type {
  MaterialSpec,
  Translucency,
  VectorLike,
  ViewerComponent,
} from "../types.ts";
import { use } from "@use-gpu/live";
import { Spacefill } from "./spacefill.ts";
import { Bonds } from "./bonds/bonds.ts";

const BallAndStickResolved: ViewerComponent<
  {
    select?: Selection | null;
    /** A flat colour or a @molgpu/fields Field, applied to balls and sticks. */
    color?: VectorLike | Field;
    /** Ball radius scale; defaults to 0.3. */
    ball?: number;
    /** Stick width; defaults to 0.28. */
    stick?: number;
    endpoints?: "both" | "either";
    /** Cast stick shadows under a shadow-enabled Pass; balls do not cast. */
    shadow?: boolean;
    /** Forwarded to both balls and sticks, so they share one shading model. */
    material?: MaterialSpec;
  } & Translucency
> = (
  {
    select = null,
    color,
    ball = 0.3,
    stick = 0.28,
    endpoints = "both",
    shadow = false,
    ...props
  },
) => {
  const shared = color !== undefined ? { color } : {};
  return [
    use(Spacefill, { select, scale: ball, ...shared, ...props }),
    use(Bonds, {
      select,
      width: stick,
      endpoints,
      shadow,
      ...shared,
      ...props,
    }),
  ];
};

/**
 * Compose Spacefill balls and Bonds sticks using the nearest live coordinates
 * and one selection. `ball` scales van der Waals radii; `stick` is the width in
 * world units. Color, material and opacity apply to both halves. `shadow`
 * enables stick shadows under a shadow-enabled Pass; balls do not cast.
 */
export const BallAndStick: ViewerComponent<
  & {
    select?: SelectionInput;
    /** A flat colour or a @molgpu/fields Field, applied to balls and sticks. */
    color?: VectorLike | Field;
    /** Ball radius scale; defaults to 0.3. */
    ball?: number;
    /** Stick width; defaults to 0.28. */
    stick?: number;
    endpoints?: "both" | "either";
    /** Cast stick shadows under a shadow-enabled Pass; balls do not cast. */
    shadow?: boolean;
    /** Forwarded to both balls and sticks, so they share one shading model. */
    material?: MaterialSpec;
  }
  & Translucency
  & SelectionDiagnostics
> = (props) =>
  use(SelectionConsumer, {
    input: props.select,
    who: "BallAndStick",
    onSelectionStatus: props.onSelectionStatus,
    warnEmptySelection: props.warnEmptySelection,
    render: (select: Selection) => {
      const { onSelectionStatus: _status, warnEmptySelection: _warn, ...draw } =
        props;
      return use(BallAndStickResolved, {
        ...draw,
        select: props.select == null ? null : select,
      });
    },
  });
