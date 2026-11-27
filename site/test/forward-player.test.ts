import { assertEquals, assertThrows } from "@std/assert";
import { ForwardPlayer } from "../src/experiments/mpnn/forward.ts";

Deno.test("ForwardPlayer plays one step per interval and stops at the end", () => {
  const seen: number[] = [];
  const player = new ForwardPlayer(4, (i) => seen.push(i), 100);
  player.tick(500);
  assertEquals(seen, [], "paused players do not advance");
  player.play();
  player.tick(99);
  assertEquals(seen, []);
  player.tick(1);
  assertEquals(seen, [1]);
  // A long frame catches up without overshooting the last step.
  player.tick(1000);
  assertEquals(seen, [1, 2, 3]);
  assertEquals(player.playing, false);
  // Playing from the end restarts from the first step.
  player.play();
  assertEquals(seen, [1, 2, 3, 0]);
  assertEquals(player.playing, true);
});

Deno.test("ForwardPlayer seeks within the trace and reports only changes", () => {
  const seen: number[] = [];
  const player = new ForwardPlayer(5, (i) => seen.push(i), 100);
  player.previous();
  player.seek(-3);
  assertEquals(seen, [], "already at the first step");
  player.seek(99);
  player.next();
  player.previous();
  player.seek(2.4);
  assertEquals(seen, [4, 3, 2]);
  // Seeking while playing restarts the interval at the new step.
  player.play();
  player.tick(60);
  player.seek(0);
  player.tick(60);
  assertEquals(player.index, 0);
  player.tick(40);
  assertEquals(player.index, 1);
  assertThrows(() => new ForwardPlayer(0, () => {}));
});
