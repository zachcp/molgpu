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
`RangeError` at construction; `sample` throws only for a non-finite time.

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

## Using it with the viewer

In a use.gpu scene, `@molgpu/viewer` supplies a controlled `TimelineProvider`.
Its `time` prop is the global second value; no clock runs in the viewer either.
Fields with a `curve:t` binding read this value automatically, and
`useTimelineSample(curve)` samples a camera or other component prop at the same
time. Updating `time` can be driven by a slider, narration, or an export loop;
setting an earlier value rewinds deterministically.

```js
import { TimelineProvider, useTimelineSample } from "@molgpu/viewer";

// Inside a TimelineProvider descendant:
const radius = useTimelineSample(cameraRadius);
// OrbitCamera receives radius; Spacefill's colour field receives the same t.
```

For camera keyframes that focus a selection, use a reusable `@molgpu/select`
query and an explicit current `StructureResource`:

```js
import { element } from "@molgpu/select";
import { createCameraCurve, useCameraCurve } from "@molgpu/viewer";

const camera = createCameraCurve([
  { time: 0, target: [0, 0, 0], radius: 25, bearing: 0, pitch: 0 },
  { time: 2, focus: element(8), bearing: 0.8, pitch: 0.2 },
]);

// Inside TimelineProvider: pass the pose to OrbitCamera.
const pose = useCameraCurve(camera, currentStructureResource);
```

The focus query resolves against the resource's current data when sampled.
Framing includes assembly instances and displayed atom radii; `atomRadiusScale`
matches a representation's radius scale. An empty query falls back to framing
the full structure by default. `focusSelection` also accepts `empty: 'null'` for
callers that want a no-op result.

## Place in the dependency graph

`timeline` is a lower, pure package. It depends on no other `@molgpu/*` package;
`@molgpu/viewer` depends on it (the provider, `useTimelineSample`, and camera
curves).

It must not import:

- `molstar` (only `@molgpu/io` does, at runtime);
- `@use-gpu/live`, `@use-gpu/workbench`, or `@use-gpu/shader` (only
  `@molgpu/viewer` does) — so no components, clocks, or rendering here;
- `@use-gpu/core` outside `src/internal/`. The adapter in
  `src/internal/upstream-interpolation.ts` is the only file that imports it, and
  the public types never mention `@use-gpu/*`.
