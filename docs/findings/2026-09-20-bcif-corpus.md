# Mol* reference corpus for BCIF lowering

The IO test suite uses Mol* 5.11.0 as a development-only BinaryCIF oracle. Each
fixture is a pinned public RCSB `*.bcif` byte stream; its SHA-256 is kept in
`packages/io/test/corpus.mjs`, so an accidental fixture replacement fails before
comparing data. The source row order is the contract: `atom_site` row `i`
becomes table atom `i`.

| Fixture | Intended edge case             |   Atoms | Models |
| ------- | ------------------------------ | ------: | -----: |
| 1CRN    | small peptide                  |     327 |      1 |
| 1TQN    | chains, ligand, sequence break |   3,999 |      1 |
| 1BNA    | nucleic acid                   |     566 |      1 |
| 1EJG    | alternate locations            |     843 |      1 |
| 2K39    | multi-model NMR ensemble       | 142,796 |    116 |
| 1A4Y    | large multi-chain assembly     |   8,939 |      1 |
| 4C7R    | membrane-protein assembly      |  12,208 |      1 |

`npm run test:corpus` checks the raw Mol* `atom_site` category against the
lowered table for every row: atom id, atom name, alternate-location label and
all three coordinates. String identity comparisons are exact. Coordinates use an
absolute tolerance of `1e-5 Å`, because the table deliberately owns packed
`Float32Array` coordinates.

The portable selection-kernel comparison builds an independent primary-altloc
oracle from Mol* source rows. It groups by model, label chain, label sequence,
author sequence, insertion code and component; this preserves non-polymer rows
whose label sequence is omitted. It then chooses the greatest summed occupancy
(lexical label tie-break) in the source's first model. `activeAtoms` must match
those source row indices exactly. `model: all, altloc: all` must retain every
source row.

On 2026-09-20 the complete corpus passed in 0.61 s on the local Node runner. The
harness is CPU-only. Browser image and WebGPU checks remain complementary
regressions in `deno task test:site` and `deno task test:gpu`.
