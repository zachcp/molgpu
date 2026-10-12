import { useContext } from "@use-gpu/live";
import { LoopContext } from "@use-gpu/frame";

/** Request one repaint whenever the calling representation renders. */
export const useRepaint = (): void => {
  const request = useContext(LoopContext);
  request();
};
