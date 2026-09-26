// @molgpu/viewer (spike): the "." entry names no use.gpu types.
import type { StructureData } from '@molgpu/table';
import { StructureProvider } from './structure-context.ts';
import type { ViewerComponent, ViewerElement } from './types.ts';

export type { Color, ViewerComponent, ViewerElement } from './types.ts';
export type { PointsProps } from './points.ts';
export type { AtomSelection, StructureResource } from './internal/structure-resource.ts';
export { Points } from './points.ts';

/** Provides one structure to its subtree. */
export const Structure: ViewerComponent<{ data: StructureData; children?: ViewerElement }> =
  StructureProvider as ViewerComponent<{ data: StructureData; children?: ViewerElement }>;
