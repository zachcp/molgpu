# Changelog

All notable changes to `@molgpu/timeline` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release guide](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

- Upgrade the exact GitLab use.gpu Math dependency pin to `0.21.0-rc.7`.

- Select the pure Math ESM entry in Deno and use its package alias for molecular
  interpolation imports.

- Use exact use.gpu `0.21.0-rc.3` packages from the scoped GitLab registry.
- Keep pure easing behind the private adapter, now importing `@use-gpu/math`.

- Clarify published documentation, correct public-entry examples and add JSR
  module summaries. Documentation changes only.

- Curve rejection messages name duplicate @molgpu/timeline copies and explain
  dependency alignment for deduplication.

- New experimental `frameCurve` and `frameTime` with the `FramePlayback` type:
  linear seconds-to-frames playback for `<Trajectory>`, and beat times at
  frames.
- Source is TypeScript (`src/*.ts`); the hand-written `index.d.ts` is gone. The
  public API is unchanged.

First public release (0.1.0). APIs marked _experimental_ in the README may still
change in 0.x minor releases.

- Pure, scrubbable time values: named beats and keyframe curves sampled at an
  explicit time in seconds.
