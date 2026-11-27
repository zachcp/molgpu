// Playback position over a recorded forward pass. Pure state: the page drives
// `tick` from requestAnimationFrame and redraws in `onStep`, so the stepping
// rules are testable without a browser or a GPU.

/** Steps through `count` trace steps, one every `interval` ms while playing. */
export class ForwardPlayer {
  readonly count: number;
  interval: number;
  #index = 0;
  #playing = false;
  #elapsed = 0;
  #onStep: (index: number) => void;

  constructor(count: number, onStep: (index: number) => void, interval = 900) {
    if (count < 1) throw new Error("ForwardPlayer: no steps");
    this.count = count;
    this.interval = interval;
    this.#onStep = onStep;
  }

  get index(): number {
    return this.#index;
  }

  get playing(): boolean {
    return this.#playing;
  }

  /** Go to a step, clamped to the trace. */
  seek(index: number): void {
    const next = Math.min(this.count - 1, Math.max(0, Math.round(index)));
    this.#elapsed = 0;
    if (next === this.#index) return;
    this.#index = next;
    this.#onStep(next);
  }

  next(): void {
    this.seek(this.#index + 1);
  }

  previous(): void {
    this.seek(this.#index - 1);
  }

  /** Play from the current step; from the first when at the last. */
  play(): void {
    if (this.#index === this.count - 1) this.seek(0);
    this.#playing = true;
    this.#elapsed = 0;
  }

  pause(): void {
    this.#playing = false;
  }

  /** Play or pause; returns whether it is now playing. */
  toggle(): boolean {
    if (this.#playing) this.pause();
    else this.play();
    return this.#playing;
  }

  /** Advance by `ms` of wall time; stops on the last step. */
  tick(ms: number): void {
    if (!this.#playing) return;
    this.#elapsed += ms;
    while (this.#elapsed >= this.interval && this.#playing) {
      const carry = this.#elapsed - this.interval;
      this.next();
      this.#elapsed = carry;
      if (this.#index === this.count - 1) this.#playing = false;
    }
  }
}
