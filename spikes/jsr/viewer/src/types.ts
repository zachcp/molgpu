// Owned element and component types: the "." entry names no use.gpu types.

/** One node of a rendered scene. Opaque: its concrete shape belongs to the renderer. */
export type ViewerElement = object | null | undefined | false;

/** A viewer component: a function of props that renders a scene element. */
export type ViewerComponent<P = {}> = (props: P) => ViewerElement;

/** A colour as an [r, g, b, a] vector in 0-1. */
export type Color = readonly [number, number, number, number];
