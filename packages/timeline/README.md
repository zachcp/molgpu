# @molgpu/timeline

Pure, scrubbable time values. Time is measured in **seconds** everywhere. No
clock runs inside this package: callers pass `t` to `sample(curve, t)`, and the
result depends only on the curve and `t` — never on wall time or on earlier
samples — so scrubbing backwards, jumping, and exporting frames are all
deterministic. Named beats give a story its anchor times; curves turn keyframes
into numbers or fixed-width vectors.

## Install

```sh
deno add jsr:@molgpu/timeline
```

The only runtime dependency is `@use-gpu/core`, pinned exactly (`0.20.0`) and
used for its pure easing math behind a private adapter. No use.gpu types appear
in this package's public API.

## Example

```js
import { createCurve, createTimeline, sample } from "@molgpu/timeline";

const story = createTimeline([
  { name: "overview", time: 0 },
  { name: "site", time: 2 },
]);
const opacity = createCurve([
  { time: story.time("overview"), value: 0, ease: "cosine" },
  { time: story.time("site"), value: 1 },
]);
const position = createCurve([
  { time: 0, value: [0, 0, 0] },
  { time: 2, value: [4, 2, 0] },
], { extrapolate: "loop" });

sample(opacity, 1); // ≈ 0.5; sampling 2, then 1 gives the same result
sample(opacity, 5); // 1 (clamped past the last frame)
sample(position, 1); // [2, 1, 0], a fresh array the caller owns
sample(position, 3); // [2, 1, 0] (wrapped by extrapolate: 'loop')
```

`createCurve` accepts number or fixed-width vector values (plain arrays or
`Float32Array`/`Float64Array`; all frames must share one shape). A frame's
`ease` describes the segment starting at that frame: `linear` (default),
`cosine`, `hold`, or `bezier` (with four `bezier` controls). `knots` give
explicit spline controls. With `automatic: true` the curve derives smooth knots
and easing itself, and frames must not set `ease` or `knots`. `type: 'angle'`
interpolates along the short arc. Out-of-range samples clamp by default, or wrap
with `extrapolate: 'loop'`. Invalid beats or frames throw `TypeError` or
`RangeError` at construction. `sample` rejects non-finite time or a curve that
was not created by the same installed copy of this package. Keep one resolved
version of `@molgpu/timeline` when sharing curves with the viewer.

## API

| Export           | Stability    | Description                                                                                                                                 |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `createTimeline` | stable       | Build an immutable set of named beats with strictly increasing times in seconds.                                                            |
| `createCurve`    | stable       | Build an immutable keyframe curve over numbers or fixed-width vectors.                                                                      |
| `sample`         | stable       | Pure sample of a curve at an arbitrary time in seconds; vectors are fresh arrays.                                                           |
| `Curve`          | stable       | Opaque curve value returned by `createCurve`; read it only through `sample`.                                                                |
| `CurveValue`     | stable       | A sampled value: `number` or `readonly number[]`.                                                                                           |
| `Beat`           | stable       | A named instant, `{ name, time }`.                                                                                                          |
| `Timeline`       | stable       | Result of `createTimeline`: `unit`, `beats`, and `time(name)`.                                                                              |
| `Keyframe`       | experimental | One curve frame: `time`, `value`, and optional `ease`, `bezier`, `knots`.                                                                   |
| `CurveOptions`   | experimental | `createCurve` options: `type`, `automatic`, `extrapolate`.                                                                                  |
| `frameCurve`     | experimental | Linear curve from seconds to frames: frame `i` starts at `start + i/fps`; every frame, the last included, shows for `1/fps`; optional loop. |
| `frameTime`      | experimental | Seconds at which a frame starts, for placing beats at frames.                                                                               |
| `FramePlayback`  | experimental | `frameCurve` options: `frames`, `fps`, `start`, `loop`.                                                                                     |

## Trajectory timing

Use `frameCurve` to convert seconds to a fractional frame index, and `frameTime`
to place a named beat at the start of a frame:

```ts
import { frameCurve, frameTime, sample } from "@molgpu/timeline";

const playback = { frames: 60, fps: 30, start: 1, loop: true };
const frames = frameCurve(playback);
sample(frames, 1.5); // 15
frameTime(playback, 15); // 1.5 seconds
```

The curve spans `frames / fps` seconds. Its final interval lets a trajectory
hold the last frame for `1 / fps` before looping. With `loop: true`, samples
before `start` wrap too; without looping they clamp to frame 0.

## Using it with the viewer

`@molgpu/viewer` supplies a controlled `TimelineProvider`. Set its `time` prop
in seconds from a slider, animation callback, narration or frame-export loop.
The provider does not run a clock. Fields with a `curve:t` binding and
trajectory frame curves read that time automatically:

```tsx
import {
  Spacefill,
  Structure,
  TimelineProvider,
  Trajectory,
} from "@molgpu/viewer";
import { frameCurve } from "@molgpu/timeline";

const frames = frameCurve({ frames: 60, fps: 30 });

// `seconds` is controlled by your application. The trajectory must match the
// structure's atom order (or supply the appropriate trajectory atom map).
<TimelineProvider time={seconds}>
  <Structure src="/structure.bcif">
    <Trajectory src="/frames.dcd" frame={frames}>
      <Spacefill />
    </Trajectory>
  </Structure>
</TimelineProvider>;
```

For an ordinary camera property, use `sample(cameraRadius, seconds)` and pass
that number to the application's `OrbitCamera`. For selection-focused camera
keyframes, `useCameraCurve` samples a `CameraCurve` array inside a Live
component:

```ts
import { element } from "@molgpu/select";
import { type CameraCurve, useCameraCurve } from "@molgpu/viewer";
import { useStructureResource } from "@molgpu/viewer/advanced";

const camera: CameraCurve = [
  { time: 0, target: [0, 0, 0], radius: 25, bearing: 0, pitch: 0 },
  { time: 2, focus: element(8), bearing: 0.8, pitch: 0.2 },
];

// Inside a Live component beneath TimelineProvider and Structure:
const pose = useCameraCurve(camera, useStructureResource());
// Pass pose.target, pose.radius, pose.bearing and pose.pitch to OrbitCamera.
```

Focus queries read the supplied resource's CPU data. Under a coordinate
provider, pass the resource from `useCoordinateSnapshot()` to follow published
positions, or use `useCoordinateFocus` for GPU bounds. Empty focus queries frame
the first model's primary conformers by default; `empty: "null"` on
`useCoordinateFocus` returns no focus result instead.

## Dependencies

This package is renderer-free and has no dependency on other `@molgpu/*`
packages. Its private interpolation adapter uses pure math from the pinned
`@use-gpu/core`; public values are plain numbers, arrays and immutable curves.
