import { useContext } from '@use-gpu/live';
import { LoopContext } from '@use-gpu/workbench';

/**
 * Request one repaint whenever the calling representation renders.
 *
 * Style props (radius, colour, opacity, …) reach the GPU through shader refs
 * that upstream mutates in place, and the draw below is memoized on those refs,
 * so a style-only edit yields no new draw and <AutoCanvas>'s SyncLoop never
 * schedules a frame — the new values sit unused until something unrelated
 * redraws (molgpu-sept-jrr). Calling the loop's request with no fiber queues a
 * pure repaint: it re-dispatches the existing draws without re-rendering the
 * caller, so it cannot loop, and a representation that is not re-rendering
 * requests nothing (the scene stays idle at rest). Outside a loop the context
 * default is a no-op.
 */
export const useRepaint = () => {
  const request = useContext(LoopContext);
  request();
};
