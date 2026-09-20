import { use, useMemo } from '@use-gpu/live';
import { LineLayer } from '@use-gpu/workbench';
import { byElement } from '@molgpu/fields';
import { useStructure } from './structure-context.mjs';
import { useField } from './use-field.mjs';
import { isField, fieldAttrNames, withColumns } from './internal/representation.mjs';
import { buildBondColumns, endpointAttributes } from './internal/bond-columns.mjs';

// One stable default field; passing any explicit colour preserves the existing
// unsplit geometry and styling behavior.
const DEFAULT_COLOR = byElement();

const line = (positions, segments, width, sides, shaded, extra, props) =>
  use(LineLayer, { positions, segments, width, join: 'round', ...(shaded ? { shaded: true, sides, depth: -1 } : {}), ...extra, ...props });

// A colour field colours each endpoint by its atom, composed shader-side.
const FieldBonds = ({ map, field, width, sides, shaded, ...props }) => {
  const colors = useField(field, map, { domain: 'atom' });
  return line(map.positions, map.segments, width, sides, shaded, { colors }, props);
};

/**
 * Draw bonds as world-space sticks. `select` (a @molgpu/select atom Selection)
 * keeps bonds whose endpoints satisfy `endpoints` ('both', the default, or
 * 'either'); the endpoint policy is explicit and documented. By default, each
 * bond is split at its midpoint: the first half takes element A's colour and
 * the second takes element B's. An explicit `color` retains the unsplit stroke
 * and accepts a flat colour or a @molgpu/fields Field. Connectivity comes from
 * the shared bond topology (explicit, else inferred).
 */
export const Bonds = ({ width = 0.3, select, color, endpoints = 'both', sides = 6, shaded = true, ...props }) => {
  const { resource } = useStructure();
  const { data } = resource;

  if (select !== undefined && select !== null && (select.dataset !== resource.identity || select.domain !== 'atom')) {
    throw new TypeError('Bonds received a foreign or non-atom selection');
  }
  if (!['both', 'either'].includes(endpoints)) throw new TypeError("Bonds endpoints must be 'both' or 'either'");
  const defaultColor = color === undefined;
  const effectiveColor = defaultColor ? DEFAULT_COLOR : color;
  const field = isField(effectiveColor) ? effectiveColor : null;
  const attrNames = useMemo(() => fieldAttrNames(field), [field]);
  const indices = select ? select.indices : null;
  const selectKey = select?.id ?? 'all';
  const built = useMemo(() => buildBondColumns(data, indices, endpoints, defaultColor), [data, selectKey, endpoints, defaultColor]);
  const attrs = useMemo(() => endpointAttributes(data, built.rows, attrNames), [data, built, attrNames]);
  if (!built.n) return null;

  const specs = [
    { key: 'positions', data: built.positions, format: 'vec3<f32>' },
    { key: 'segments', data: built.segments, format: 'i32' },
    ...attrNames.map((name) => ({ key: `attr:${name}`, data: attrs[name], format: 'f32' })),
  ];
  return withColumns(specs, (map) => field
    ? use(FieldBonds, { map, field, width, sides, shaded, ...props })
    : line(map.positions, map.segments, width, sides, shaded, { color: effectiveColor }, props));
};
