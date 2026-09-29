# Coordinate Snapshot Chemistry Contract

Date: 2026-09-28. Bead: `molgpu-sept-crj.6`.

## Decision

GPU coordinate snapshots keep the root structure's topology and bind to its
selection bond graph. The graph contains the source structure's explicit bonds
and links, or Mol*-compatible computed chemistry when no bonds are declared.
Provider coordinates change positions and position revisions, but cannot add or
remove chemical edges. Bond-length predicates still measure the snapshot's
current positions. This follows the coordinate-provider contract: transforms
move rows without changing molecular identity or topology.

`@molgpu/select` owns this graph and its `preserveBondGraph` association.
`@molgpu/viewer` applies it when publishing each coordinate snapshot. The
association is per snapshot object and validated against dataset identity and
topology. A separately created `withPositions` value remains free to infer
connectivity from its own positions unless the caller explicitly preserves the
source graph.

## Consumer policy

| Consumer             | Graph used                     | Reason                                                                                      |
| -------------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| Connected selections | Source chemical graph          | Mol*-compatible query semantics remain stable under coordinate providers.                   |
| Bonds drawing        | `table.bondTopology(root)`     | A display view with its own distance policy, always based on root topology and coordinates. |
| Charge assignment    | Declared typed bonds and links | Bond order and aromaticity must be known; a visual distance edge is insufficient evidence.  |
| Unwrap               | Declared covalent bond flags   | A periodic spanning forest must not infer metallic or uncertain connections.                |

The display and selection inference policies differ today: on 1EJG they give 868
and 860 edges respectively. The distinction is intentional in this change and is
covered by a regression. Converging them would require a separate scientific
decision with Mol* oracle checks for model, altloc, metal, link and template
rules. The viewer must not smuggle the display result into declared topology to
make the two counts appear equal.
