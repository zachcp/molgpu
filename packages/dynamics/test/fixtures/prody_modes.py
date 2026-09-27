"""Regenerate prody-modes.json, the ANM/GNM oracle for elastic-network.test.ts.

The CA coordinates in the fixture are the first-model, protein, altloc ''/A CA
atoms of packages/io/test/fixtures/{1crn,1tqn}.bcif, rounded to 3 decimals. This
script recomputes the modes from those stored coordinates:

    uv run --no-project --with prody --with numpy \
        python prody_modes.py prody-modes.json prody-modes.json
"""
import json
import sys

import numpy as np
import prody

prody.confProDy(verbosity="none")
source = json.load(open(sys.argv[1]))
out = {"prody": prody.__version__, "numpy": np.__version__, "structures": {}}
for pid, previous in source["structures"].items():
    ca = previous["ca"]
    xyz = np.array(ca, dtype=float).reshape(-1, 3)
    entry = {"ca": ca}
    for kind, cutoff in (("anm", 15.0), ("gnm", 7.3)):
        model = prody.ANM(pid) if kind == "anm" else prody.GNM(pid)
        if kind == "anm":
            model.buildHessian(xyz, cutoff=cutoff, gamma=1.0)
        else:
            model.buildKirchhoff(xyz, cutoff=cutoff, gamma=1.0)
        model.calcModes(n_modes=5, zeros=False, turbo=True)
        entry[kind] = {
            "cutoff": cutoff,
            "eigenvalues": model.getEigvals().tolist(),
            "vectors": [[round(float(x), 6) for x in v]
                        for v in model.getEigvecs().T],
        }
    out["structures"][pid] = entry
json.dump(out, open(sys.argv[2], "w"))
