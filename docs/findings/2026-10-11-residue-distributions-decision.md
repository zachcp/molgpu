# Backbone-linked residue scores and distributions

Date: 2026-10-11. Tracking: `molgpu-sept-r50`; related `jr2` and `034`.
Repository baseline: `f202603a04109cb8b48e3ef8205d76da3324a2e3` with local
retirement-harness/report work already present. This is a planning decision and
executable application sketch, not a new package API or inference
implementation.

## Decision and first uses

Choose a linked residue-by-category heatmap, a selected-residue numeric detail
panel, and scalar-colored backbone context. Start with imported probabilities;
keep substitution scores as a separately labeled source with a signed legend.
Keep all categories available in the panel, but highlight only one residue on
the backbone. This recommendation is provisional pending an owner-selected real
protein/output dataset; the spike does not decide the owner's scientific use.

The three uses are: inspect alternatives at one backbone site; compare a model's
native-residue preference with a substitution-score baseline without equating
units; and inspect which residues belong to an overlapping structural window.
The last use shares membership with `jr2`, which continues to own
distance-matrix storage and the exact intended meaning of “EC32”. Inference
stays under `034`.

| Form                     | Sketch                                                           | Orientation and overlap                                                                                                                                                                                               | Inspection, legend and selection                                                                                                                                                                                                                  | Decision                                                            |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Anchored fans/stacks     | One selected backbone anchor → 21 labeled bars                   | A camera-facing fan needs stable screen scaling; a local tangent frame can flip. Dense all-residue fans obscure geometry and each other.                                                                              | Fixed category order and accessible numeric panel; select one site or a small window. Bar heights need separate score/probability axes and explicit negative-score handling. Category colors identify classes, not likelihood.                    | Defer; compare later if spatial relationships matter to the owner.  |
| Linked heatmap/logo      | Backbone ↔ residue rows × category columns → exact detail        | Screen-space panel remains readable while orbiting; chain breaks and gaps get visible separators. Heatmap avoids overlapping glyphs; a logo is optional for normalized probabilities, with explicit height semantics. | Keyboard cell activation, numeric values, native-category marker, missing-row mask, chain/window filters and bidirectional picking. Sequential probability legend versus diverging signed-score legend; category order never inferred from color. | Chosen first slice; strongest comparison and accessible inspection. |
| Scalar backbone + detail | Backbone colored by one summary → full distribution on selection | Minimal occlusion; no vector glyph topology. Snapshot anchors follow the existing coordinate policy.                                                                                                                  | Entropy (bits), native probability, or selected substitution score are distinct summaries. Color-only views need exact values and missing markers in the detail panel.                                                                            | Include as context, not a replacement for full categories.          |

The sketch implements the second form with the third as context. Production
bidirectional molecular picking and real model import remain follow-ups; no
camera-facing fan geometry is introduced in this spike.

## Scientific meanings and source inventory

BLOSUM62 is a substitution log-odds score matrix, not a probability table. Its
published integer scale is half-bit units. The conventional matrix ordering also
includes B, Z, X and a stop category; a 20-category slice must declare what was
removed. The inspected
[Biopython BLOSUM62 file](https://raw.githubusercontent.com/biopython/biopython/master/Bio/Align/substitution_matrices/data/BLOSUM62)
identifies its scale and clustering threshold. Its repository's
[license](https://raw.githubusercontent.com/biopython/biopython/master/LICENSE.rst)
is the Biopython License Agreement unless a file explicitly offers another
license; do not assume blanket BSD coverage. No matrix data was vendored here.
The
[NCBI explanation](https://www.ncbi.nlm.nih.gov/BLAST/tutorial/Altschul-1.html)
relates scores to target/background frequencies; rounded scores alone do not
supply a calibrated site-specific mutation probability.

If a heuristic display is requested, define `w(j|i) = b(j) * 2^(s(i,j)/2)` and
normalize over the declared allowed alphabet. Record `b`, scale, omitted
categories and conditioning assumptions; label the result “derived relative
preferences”. Uniform `b` is an explicit heuristic. Do not label it evolutionary
rates, mutation likelihoods or model probabilities. No such conversion is
implemented in the sketch.

ProteinMPNN was inspected at
[`8907e6671bfbfc92303b5f79c4b5e6ce47cdef57`](https://github.com/dauparas/ProteinMPNN/tree/8907e6671bfbfc92303b5f79c4b5e6ce47cdef57)
(MIT; weights were not loaded). The
[run script](https://github.com/dauparas/ProteinMPNN/blob/8907e6671bfbfc92303b5f79c4b5e6ce47cdef57/protein_mpnn_run.py)
uses `ACDEFGHIKLMNPQRSTVWYX` (21 categories). Conditional and unconditional
exports store `log_p` with shape samples × residues × 21 and separate masks.
Conditional mode can include other sequence residues or request backbone-only
conditioning; unconditional mode conditions on backbone. Saved sampling output
includes `probs`, model `log_probs`, sampled `S`, mask and chain order. Preserve
these distinctions and axes; do not average samples silently or discard X.

The
[model implementation](https://github.com/dauparas/ProteinMPNN/blob/8907e6671bfbfc92303b5f79c4b5e6ce47cdef57/protein_mpnn_utils.py)
returns natural-log softmax values. Sampling applies temperature, amino-acid and
per-residue biases, omit/masking constraints and optional PSSM adjustments; its
sample probabilities need not equal exponentiated model log-probabilities.
Capture checkpoint hash/name, CA/full-backbone/soluble variant, producer commit,
backbone noise, seed/order, sequence context, temperature, constraints, sample
count and aggregation method. Fixed/design masks describe eligibility, not
missing coordinate rows. Uncomputed conditional rows can contain placeholders;
never normalize those as valid distributions. Logits require declared softmax
and temperature; log-probabilities require their declared base; probabilities
must already satisfy their stated normalization.

Reseek was inspected at
[`9cb33e135ecd1bc9686756b8a54f94a11df9b113`](https://github.com/rcedgar/reseek/tree/9cb33e135ecd1bc9686756b8a54f94a11df9b113),
whose README describes version 3 and links the July 16, 2026 preprint. The
linked PDF could not be fetched through the web tool; code-level findings below
do not pretend to verify paper-only details. The repository is GPL-3.0; no code,
centroids or trained score tables were copied into this MIT project.

The current
[`sec_kmeans.cpp`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/sec_kmeans.cpp)
defines `sec32`: 32 centroids over six distance features, with offset pairs
(-3,+1), (-3,0), (0,+2), (+1,+3), (+2,0), (-3,+3) around a center. Thus its
support spans seven residues, but its descriptor is not the entire 7×7 distance
matrix. The
[`sec_kmeans.h`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/sec_kmeans.h)
selects a nearest centroid using squared Euclidean distance in descriptor space.
A cluster ID is a category assignment, not a probability distribution.

[`flat_dist_types.h`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/flat_dist_types.h)
encodes distance as quantized squared-distance `sid`: the executable conversion
is approximately `round(d²*100/16)`, with inverse `sqrt(16*sid)/10` Å. A
misleading adjacent comment uses `/8`; preserve the executable definition and
record the source version rather than assuming generic Å values. Current
[`alpha.cpp`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/alpha.cpp)
orders the first 32 symbols as `ABCDEFGHIJLKMNOPQRSTUVWXYZabcdef`: K/L are
swapped relative to lexical order. Numeric IDs must retain their producer
alphabet.

The embedded
[`alpha_collect.cpp`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/alpha_collect.cpp)
contains `sec32.logodds`;
[`read_alphadir.cpp`](https://github.com/rcedgar/reseek/blob/9cb33e135ecd1bc9686756b8a54f94a11df9b113/src/read_alphadir.cpp)
allows default or external alphabet/score collections. A 32×32 structural-state
score table, 32 centroid descriptors and a chain's assignments are three
separate products. No literal EC32 identifier was found in the inspected
repository. Whether the owner means this `sec32` or an older/different artifact
remains unresolved, explicitly linked to `jr2`. Exact intended matrix
release/hash and score scaling must be supplied before choosing a
structural-state fixture. Mapping these categories to amino-acid probabilities
is unsupported and deferred.

## Proposed renderer-free imported-value contract

Keep this as an application-owned contract until real consumers justify a public
entry. IO decodes transport; table owns identity/validation if promoted; fields
consume derived scalar/color/label values; viewer owns adaptation. Do not add a
package merely to hold this record.

| Field         | Required meaning and validation                                                                                                                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source/layout | Source ID and monotonic revision, structure dataset identity/topology revision, immutable layout fingerprint, coordinate reference/provenance when prediction depends on a backbone. Withdrawal on incompatible replacement; coordinate movement alone does not recompute inference.                                                                                                                          |
| Residue keys  | Explicit model, both chain namespaces, label sequence, author sequence as string, insertion code, and component. `residueKey` is the current canonical layout key. Unknown identifiers stay explicit; reject ambiguous joins, duplicate keys and implicit row-order assumptions.                                                                                                                              |
| Categories    | Ordered unique IDs plus labels, alphabet namespace/version, unknown/stop categories and any removed mass. Structural states keep a separate alphabet and legend.                                                                                                                                                                                                                                              |
| Shape/values  | Read-only row-major N×K Float32/Float64 values with declared precision. Separate sample axis or a named aggregation; optional category-eligibility mask. Cardinalities must match, with explicit row/value masks.                                                                                                                                                                                             |
| Semantics     | Discriminant: substitution score (units, scale/base and matrix hash), logits (conditioning/transform), log-probabilities (base), probabilities (conditioning/normalization), structural score, or cluster assignment. Distances belong to the separate `jr2` product, in declared units. Never infer meaning from shape.                                                                                      |
| Validation    | Present probabilities finite, nonnegative and sum to one within documented precision tolerance (sketch: 1e-5); log-probabilities may use -∞ only for declared zero probabilities, reject NaN/+∞, and validate exp sums. No automatic repair. Missing rows are masks, not zero probabilities; design/fixed masks remain separate. Validate nonempty categories, unique identities and domain/layout alignment. |
| Provenance    | Producer/version/checkpoint hashes, source URI/license, native sequence/conditioning, masks, parameters, timestamps, source revision and aggregation. Synthetic fixtures declare calibration absent.                                                                                                                                                                                                          |

Window membership is a separate record: stable window ID, model/chain, seven
ordered residue keys, center key, coordinate source/revision, valid/missing mask
and descriptor namespace/version. Windows overlap; never force them into one
residue row. Do not cross model/chain changes, missing guide atoms or sequence
breaks. For absent label sequence, require explicit connectivity/order instead
of guessing from author numbering. Imported-value missingness is independent of
coordinate-window validity. Storage, distances and structural assignment remain
with `jr2`; this sketch demonstrates membership only.

## Coordinates and invalidation budget

The sketch uses a static snapshot with fixed row order. A future linked marker
uses the nearest published coordinate snapshot, normally 4 Hz, and must withdraw
on owner/layout replacement. Native atoms remain live; Tube/Cartoon and
annotation anchors follow published snapshots. Imported distributions remain
attached to the reference backbone; playing a trajectory does not make them
predictions for each frame. Recomputed predictions need a new source/revision
and provenance.

| Change                                                                  | Expected work                                                                                                                                         |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category/source/summary choice, legend, display scale, selected residue | CPU detail/derived field work; at most annotation or selection-index uploads. Zero molecular geometry rebuilds and zero coordinate uploads.           |
| Chain/window panel filtering                                            | Panel membership only in this sketch. A later representation selection may gather/rebuild selected geometry; make that distinct from panel filtering. |
| New values with the same layout                                         | Revalidate values, derive summaries, upload changed annotations; geometry/positions unchanged.                                                        |
| New coordinates                                                         | Existing nearest live/snapshot policy; do not mutate imported values or silently infer again.                                                         |
| New structure/layout                                                    | Withdraw incompatible distributions and selection, perform explicit remapping/validation; rebuild only the required molecular resources.              |
| Optional fan glyph topology changes                                     | New glyph geometry may be necessary; does not justify rebuilding molecular backbone geometry.                                                         |

Existing `annotation`/`joinAnnotation`, `colormap` and selections are sufficient
for summaries and highlighting. They do not supply a vector-distribution Field;
keep the full N×K array in the application panel. `joinAnnotation` bakes a join
at construction, so rebuild it only when input values or row layout changes.

## Executable acceptance and follow-ups

`test/spikes/residue-distributions/` contains an original MIT-licensed synthetic
13-residue Cα backbone, authored precomputed probability fixture, insertion code
A:3A, missing imported row, two chains, and a sequence gap. It is a display
fixture, not an experimentally determined protein or ProteinMPNN output. The
three seven-residue windows overlap within the first contiguous chain segment;
none crosses the gap or chain boundary. Public molecular entries compose under a
caller-owned canvas/device/camera/pass. The only private import is existing test
instrumentation, used to check the invalidation budget.

```sh
deno test -A test/spikes/residue-distributions/fixture.test.ts
deno check test/spikes/residue-distributions/page.tsx
deno test -A test/spikes/residue-distributions/run.mjs
```

Run the shared-harness Vite development server with
`deno run -A test/spikes/residue-distributions/serve.mjs` and open
`/test/spikes/residue-distributions/index.html` for interactive inspection. The
fixture validates shape, identity, category uniqueness and normalization; CPU
acceptance tests invalid probabilities, row sums and layout replacement. Browser
acceptance checks exact values/identity, missing rows, cell-to-backbone
highlighting, keyboard activation, chain/window filters, zero geometry/position
work and error-free unmount. Molecular-to-panel picking is a planned extension,
not claimed as implemented.

Final checks: CPU test passed (1 test), page and public component typechecks
passed, browser acceptance passed (1 test, 5s) on Chrome `154.0.8037.98`/macOS
arm64 and exact use.gpu rc.2. The browser reports 13 rows, 3 windows, zero style
geometry-build delta and zero position-upload-byte delta. Initial test readiness
incorrectly counted buffer labels at allocation before labels were assigned;
existing instrumentation fixed that probe. A subsequent otherwise-passing run
caught the missing favicon's 404; a local data favicon fixed it. Neither failure
justified a production change or weakened assertion. Logs:
`/private/tmp/molgpu-r50-browser.log`,
`/private/tmp/molgpu-r50-browser-final.log`, and
`/private/tmp/molgpu-r50-browser-accepted.log`. Visually inspected screenshot:
`/private/tmp/molgpu-r50-sketch.png`. Scoped formatting/lint passed. No
production API changes, inference execution, release, deployment or full
GPU-gate claim.

Bounded follow-ups:

- `molgpu-sept-asj`: import real probability outputs with explicit residue
  identity, semantics, masks and producer/checkpoint provenance, after selecting
  a dataset.
- `molgpu-sept-mts`: build the linked application inspector, including
  bidirectional picking and real-output acceptance; depends on `asj`.
- Existing `molgpu-sept-jr2`: intended EC32 clarification and window/distance
  storage; these source findings are shared evidence, not a duplicate spike.
- Existing `molgpu-sept-034`: inference placement/feasibility; deferred from the
  visualization API and independent of the panel's import-only first slice.
