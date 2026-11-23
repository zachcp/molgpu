/** One recorded integrator state (x, v, f) in a ring slot. */
export interface Checkpoint {
  step: number;
  slot: number;
  perturbed: boolean;
}

/** Checkpoint metadata only; the integrator owns the backing GPU buffer. */
export interface CheckpointHistory {
  every: number;
  /** Retained checkpoints, oldest to newest. */
  list: Checkpoint[];
  free: number[];
}

/** Choose a restore, replay from zero, or clamp to retained perturbed history. */
export function seekCheckpoint(
  history: CheckpointHistory | null,
  target: number,
  completed: number,
  dirty: boolean,
  tugging: boolean,
) {
  let goal = target, evicted = false, reset = false;
  let restore: Checkpoint | null = null;
  if (goal < completed || (history && goal > completed)) {
    const list = history?.list ?? [];
    const candidate = list.findLast((c) => c.step <= goal);
    const oldest = list[0];
    if (goal < completed) {
      if (candidate) restore = candidate;
      else if (oldest?.perturbed) {
        // Before the retained range of a perturbed run: nothing replays it.
        goal = oldest.step;
        evicted = true;
        if (completed !== oldest.step || dirty) restore = oldest;
      } else reset = true;
    } else if (
      candidate && candidate.step > completed && !dirty && !tugging
    ) {
      restore = candidate;
    }
  }
  return { goal, restore, reset, evicted };
}

/** Reserve a recording slot, branching or evicting history only when needed. */
export function recordCheckpoint(
  history: CheckpointHistory,
  step: number,
  perturbed: boolean,
  dirty: boolean,
): Checkpoint | null {
  if (step % history.every !== 0) return null;
  const { list, free } = history;
  const at = list.findIndex((c) => c.step >= step);
  // A departing run branches: later checkpoints belong to the old history.
  // An identical run keeps them, including across an evicted gap.
  if (at >= 0) {
    if (!dirty) return null;
    for (const c of list.splice(at)) free.push(c.slot);
  }
  if (!free.length) free.push(list.shift()!.slot);
  const checkpoint = { step, slot: free.pop()!, perturbed };
  list.push(checkpoint);
  return checkpoint;
}
