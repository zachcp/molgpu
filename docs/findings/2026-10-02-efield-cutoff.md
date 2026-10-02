# EField smooth cutoff

Date: 2026-10-02. Baseline: `20042dd`. Bead: `molgpu-sept-egp.15`. Evidence:
`packages/viewer/test/run-efield.mjs` cases 1b (parity and error) and 13
(throughput; Apple GPU, Chrome, best of three, warm).

## Contract

- `cutoff` and `switchWidth` (Å) are optional on `ElectrostaticsOptions` and on
  `<EField>`. Without `cutoff` (the default), the sum stays exact and nothing
  changes.
- With a cutoff, each pair term `q·g(r)` is multiplied by the CHARMM switching
  function `S(r) = (rc² − r²)² (rc² + 2r² − 3ron²) / (rc² − ron²)³` between
  `ron = cutoff − switchWidth` (default width 2 Å) and `rc = cutoff`. `S` is 1
  below `ron` and 0 from `rc`, and it is continuous in value and first
  derivative at both ends, so isosurfaces show no truncation step. Fields use
  `E ∝ h·S − g·S′`, the exact gradient of the switched potential.
- `ron` must be at least `minDistance`.

## Implementation

- `<EField>` orders the summed rows along a Morton curve over 2 Å cells of the
  structure's own positions. That is a locality hint only.
- `tileBounds` reduces each 64-atom tile's bounding box from the live packed
  positions every pass.
- `sumGridCutoff` gives each workgroup a 16×4×4 brick of samples. It checks 64
  tile boxes at a time against the brick, compacts the tiles within the cutoff
  into workgroup memory, and sums only those, with the switch applied per pair.
- Motion can only cost speed, never correctness: tile boxes always come from
  live coordinates.
- I did not use the shared GPU cell-list sort the bead suggested. A static,
  CPU-ordered row list plus live per-tile bounds needs no GPU sort, no scan and
  no bounds readback.

## Accuracy

The GPU matches the switched f64 reference within 3.1e-7 of peak (300-atom
random cloud, 33³ grid). The error of the cutoff against the exact sum, as a
fraction of peak:

| Model             | Cutoff / switch width | Error vs exact sum |
| ----------------- | --------------------- | -----------------: |
| vacuum (1/r)      | 6 Å / 2 Å             |               38 % |
| vacuum (1/r)      | 10 Å / 2 Å            |               40 % |
| distance (ε = 4r) | 8 Å / 3 Å             |              7.2 % |
| Debye, I = 0.1 M  | 8 Å / 2 Å             |               23 % |

Truncating long-range electrostatics changes the potential substantially, mostly
in its smooth far-field part. That is why the exact sum stays the default. A
cutoff suits qualitative surfaces of large systems and the distance-dependent
model, whose 1/r² kernel decays fastest.

## Throughput

128³ samples × 50 000 atoms, distance model:

| Mode        |     Time |
| ----------- | -------: |
| exact       | 1 251 ms |
| cutoff 12 Å |   416 ms |

That is 3.0× the exact path and 13× the pre-egp.10 baseline (5 434 ms).
