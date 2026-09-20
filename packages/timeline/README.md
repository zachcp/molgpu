# @molgpu/timeline

Pure, scrubbable time values. Time is measured in **seconds** everywhere. No
clock runs inside this package; callers supply `t` when sampling.

```js
import { createTimeline, createCurve, sample } from '@molgpu/timeline';

const story = createTimeline([
  { name: 'overview', time: 0 },
  { name: 'site', time: 2 },
]);
const opacity = createCurve([
  { time: story.time('overview'), value: 0, ease: 'cosine' },
  { time: story.time('site'), value: 1 },
]);

sample(opacity, 1); // 0.5; sampling 2, then 1 gives the same result
```

`createCurve` accepts number or fixed-width vector values. Its segment ease is
`linear`, `cosine`, `hold`, or `bezier`; `automatic: true` derives smooth knots
through a private adapter over pinned use.gpu pure math. Out-of-range samples clamp by
default, or wrap with `extrapolate: 'loop'`.

In a use.gpu scene, `@molgpu/viewer` supplies a controlled `TimelineProvider`.
Its `time` prop is the global second value; no clock runs in the viewer either.
Fields with a `curve:t` binding read this value automatically, and
`useTimelineSample(curve)` samples a camera or other component prop at the same
time. Updating `time` can be driven by a slider, narration, or an export loop;
setting an earlier value rewinds deterministically.

```js
import { TimelineProvider, useTimelineSample } from '@molgpu/viewer';

// Inside a TimelineProvider descendant:
const radius = useTimelineSample(cameraRadius);
// OrbitCamera receives radius; Spacefill's colour field receives the same t.
```

For camera keyframes that focus a selection, use a reusable `@molgpu/select`
query and an explicit current `StructureResource`:

```js
import { element } from '@molgpu/select';
import { createCameraCurve, useCameraCurve } from '@molgpu/viewer';

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
the full structure by default. `focusSelection` also accepts `empty: 'null'`
for callers that want a no-op result.
