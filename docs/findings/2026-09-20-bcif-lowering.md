# BinaryCIF lowering and bundle measurement

`@molgpu/io` lowers a BinaryCIF `atom_site` category into the owned
`@molgpu/table` structure domains. The initial scope preserves coordinates,
atom identity, alternate-location labels, element and radius, occupancy and
B-factor, plus model/chain/residue identity and one identity instance per
chain. It intentionally emits no bonds: the shared table topology provider
continues to supply explicit or inferred bonds at representation time.

The regression fixture is the public RCSB `1tqn.bcif` entry (3,999 atoms). It
also covers the important non-polymer case: water and ligand rows can omit
`label_seq_id`, so lowering includes author residue numbering when it assigns
residue rows.

`npm run build:io:measure` produces a browser entry whose parser is loaded by
dynamic import. On 2026-09-20 with Vite 8.3.0 and Mol* 5.11.0, the entry was
0.19 kB (0.17 kB gzip) and the deferred parser chunk was 193.99 kB (46.60 kB
gzip). That cost is therefore absent until an application explicitly loads a
BCIF structure. The measurement build output is ignored.
