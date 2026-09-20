# @molgpu/geo

Pure molecular geometry kernels. This package must not import Mol* or use.gpu
at runtime.

## Marching-cubes provenance

`src/marching-cubes-tables.mjs` is a mechanical copy of the lookup tables from
Mol* 5.11.0, `mol-geo/util/marching-cubes/tables.js`, under its MIT license.
The forthcoming typed-array builder and interpolation loop are a port of Mol*
5.11.0 `algorithm.js` / `builder.js`; preserve this attribution and validate
against the pinned Mol* oracle before exposing it.
