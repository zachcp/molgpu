// The build-up: everything composed into the figure these parts add up to.
//
// A cartoon tube for the fold, ball-and-stick for a selected site, and the
// disulfide cysteines called out in spacefill. Every piece is a verified
// primitive; none of them plumbs data.
//
//   ?site=CYS         residues shown as sticks (resn)
//   ?shell=5          also stick anything within N Angstrom of the site
//   ?tube=1.0         tube width
import { use } from '@use-gpu/live';
import { Structure, computeBounds } from '../lib/structure.mjs';
import { Tube } from '../lib/tube.mjs';
import { Spacefill } from '../lib/spacefill.mjs';
import { BallAndStick } from '../lib/ballstick.mjs';
import { crambinTable } from '../lib/table.mjs';
import { resn, sidechain, within, intersect, union } from '../lib/select.mjs';

export const title = 'Composed scene';

const table = crambinTable();
const bounds = computeBounds(table);
export const camera = { radius: bounds.extent * 1.9, target: bounds.center };

export function body() {
  const q = new URLSearchParams(location.search);
  const siteName = q.get('site') ?? 'CYS';
  const shell = parseFloat(q.get('shell') ?? '0');
  const tubeWidth = parseFloat(q.get('tube') ?? '1.4');

  // Selections compose as values — this is CONCEPT 2 doing real work.
  const site = resn(table, [siteName]);
  const sticks = shell > 0
    ? intersect(union(site, within(table, shell, site)), sidechain(table))
    : intersect(site, sidechain(table));

  document.getElementById('title').textContent =
    `Composed scene — ${table.residues.count} residues, ` +
    `${siteName} site (${site.indices.length} atoms), ` +
    `${sticks.indices.length} stick atoms`;

  // ?only=sticks isolates the bond rendering (6 CYS CB-SG bonds at shell=0)
  const only = q.get('only');
  if (only === 'sticks') {
    return use(Structure, { table, children: use(BallAndStick, { select: sticks, ball: 0.20, stick: 0.22 }) });
  }

  return use(Structure, { table, children: [
    // the fold
    use(Tube, { width: tubeWidth, sides: 10, taper: 0.5 }),
    // the site, as sticks
    use(BallAndStick, { select: sticks, ball: 0.20, stick: 0.22 }),
    // and the site's own atoms called out a little larger
    use(Spacefill, { select: site, scale: 0.34 }),
  ] });
}
