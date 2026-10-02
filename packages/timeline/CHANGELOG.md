# Changelog

All notable changes to `@molgpu/timeline` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); see
[release guide](https://github.com/zachcp/molgpu/blob/main/docs/RELEASING.md)
for the procedure.

## [Unreleased]

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
