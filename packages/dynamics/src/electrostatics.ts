// Coulomb potential and field from point charges: parameter normalisation, an
// f64 CPU reference with closed-form fields, and xyzq packing. The WGSL that
// matches it is in electrostatics-wgsl.ts. See
// docs/findings/2026-09-27-efield-plan.md.

/** How the medium screens a charge. */
export type DielectricModel = "vacuum" | "distance" | "debye";
/** Output unit of potentials; fields are this unit per Ångström. */
export type PotentialUnit = "kT/e" | "kcal/mol/e";

export interface ElectrostaticsOptions {
  /** Defaults to `"distance"` (ε = 4r, as ChimeraX's coulombic default). */
  readonly model?: DielectricModel;
  /**
   * Relative permittivity: ε for `vacuum` (default 1) and `debye` (default
   * 78.54), or D in ε = D·r for `distance` (default 4).
   */
  readonly epsilon?: number;
  /** Ionic strength in mol/L for `debye`; defaults to 0.15. */
  readonly ionicStrength?: number;
  /** Kelvin; sets kT and the Debye length. Defaults to 298.15. */
  readonly temperature?: number;
  /** Distances below this (Å) are clamped to it; defaults to 1. */
  readonly minDistance?: number;
  /** Defaults to `"kT/e"`. */
  readonly unit?: PotentialUnit;
  /**
   * Optional cutoff in Å. Omitted (the default) sums every pair exactly.
   * With a cutoff, each pair term is multiplied by a switching function that
   * is 1 up to `cutoff − switchWidth`, 0 from `cutoff`, and smooth (C¹) in
   * between, so isosurfaces show no truncation step.
   */
  readonly cutoff?: number;
  /** Width in Å of the switching region below `cutoff`; defaults to 2. */
  readonly switchWidth?: number;
}

/** Normalised parameters shared by the CPU reference and the WGSL uniform. */
export interface Electrostatics {
  readonly model: DielectricModel;
  readonly epsilon: number;
  readonly ionicStrength: number;
  readonly temperature: number;
  readonly minDistance: number;
  readonly unit: PotentialUnit;
  /** Inverse Debye length in 1/Å (0 unless `debye`). */
  readonly kappa: number;
  /** kT in kcal/mol at `temperature`. */
  readonly kT: number;
  /** C / (ε or D) / (kT or 1): potential = scale · Σ q g(r). */
  readonly scale: number;
  /** Cutoff in Å, or 0 for the exact sum. */
  readonly cutoff: number;
  /** Where switching starts, in Å (`cutoff − switchWidth`); 0 without cutoff. */
  readonly switchOn: number;
}

// CODATA 2018 exact SI values.
const ELEMENTARY_CHARGE = 1.602176634e-19; // C
const AVOGADRO = 6.02214076e23; // 1/mol
const BOLTZMANN = 1.380649e-23; // J/K
const VACUUM_PERMITTIVITY = 8.8541878128e-12; // F/m
const JOULES_PER_KCAL = 4184;

/** e²N_A/(4πε₀) in kcal·Å/(mol·e²): 332.0637… */
export const COULOMB_CONSTANT: number = ELEMENTARY_CHARGE ** 2 * AVOGADRO /
  (4 * Math.PI * VACUUM_PERMITTIVITY) * 1e10 / JOULES_PER_KCAL;
/** Gas constant in kcal/(mol·K): 0.0019872… */
export const GAS_CONSTANT_KCAL: number = BOLTZMANN * AVOGADRO /
  JOULES_PER_KCAL;

const MODEL_EPSILON: Record<DielectricModel, number> = {
  vacuum: 1,
  distance: 4,
  debye: 78.54,
};

const positive = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`electrostatics: ${name} must be positive and finite`);
  }
  return value;
};

/** Inverse Debye length (1/Å) for an ionic strength (mol/L) in a medium. */
export function debyeKappa(
  ionicStrength: number,
  epsilon: number,
  temperature: number,
): number {
  if (ionicStrength === 0) return 0;
  // κ² = 2 N_A e² I / (ε₀ ε k_B T), with I in mol/m³.
  const k2 = 2 * AVOGADRO * ELEMENTARY_CHARGE ** 2 * ionicStrength * 1e3 /
    (VACUUM_PERMITTIVITY * epsilon * BOLTZMANN * temperature);
  return Math.sqrt(k2) * 1e-10;
}

/** Validate options and derive κ, kT and the output scale. */
export function electrostatics(
  options: ElectrostaticsOptions = {},
): Electrostatics {
  const model = options.model ?? "distance";
  if (!(model in MODEL_EPSILON)) {
    throw new TypeError(
      "electrostatics: model must be vacuum, distance or debye",
    );
  }
  const unit = options.unit ?? "kT/e";
  if (unit !== "kT/e" && unit !== "kcal/mol/e") {
    throw new TypeError("electrostatics: unit must be kT/e or kcal/mol/e");
  }
  const epsilon = positive(
    options.epsilon ?? MODEL_EPSILON[model],
    "epsilon",
  );
  const temperature = positive(options.temperature ?? 298.15, "temperature");
  const minDistance = positive(options.minDistance ?? 1, "minDistance");
  const ionicStrength = options.ionicStrength ?? 0.15;
  if (!Number.isFinite(ionicStrength) || ionicStrength < 0) {
    throw new RangeError(
      "electrostatics: ionicStrength must be finite and non-negative",
    );
  }
  const kT = GAS_CONSTANT_KCAL * temperature;
  const kappa = model === "debye"
    ? debyeKappa(ionicStrength, epsilon, temperature)
    : 0;
  const scale = COULOMB_CONSTANT / epsilon / (unit === "kT/e" ? kT : 1);
  let cutoff = 0, switchOn = 0;
  if (options.cutoff !== undefined) {
    cutoff = positive(options.cutoff, "cutoff");
    const width = positive(options.switchWidth ?? 2, "switchWidth");
    switchOn = cutoff - width;
    if (switchOn < minDistance) {
      throw new RangeError(
        "electrostatics: cutoff − switchWidth must be at least minDistance",
      );
    }
  } else if (options.switchWidth !== undefined) {
    throw new TypeError("electrostatics: switchWidth needs a cutoff");
  }
  return Object.freeze({
    model,
    epsilon,
    ionicStrength,
    temperature,
    minDistance,
    unit,
    kappa,
    kT,
    scale,
    cutoff,
    switchOn,
  });
}

/**
 * The cutoff switching function S(r) and dS/dr (CHARMM form, C¹ at both
 * ends): 1 below `switchOn`, 0 from `cutoff`. Without a cutoff, S = 1.
 */
export function coulombSwitch(
  p: Pick<Electrostatics, "cutoff" | "switchOn">,
  r: number,
): [number, number] {
  if (!p.cutoff || r <= p.switchOn) return [1, 0];
  if (r >= p.cutoff) return [0, 0];
  const c2 = p.cutoff * p.cutoff, on2 = p.switchOn * p.switchOn, u = r * r;
  const d3 = (c2 - on2) ** 3;
  return [
    (c2 - u) ** 2 * (c2 + 2 * u - 3 * on2) / d3,
    12 * r * (c2 - u) * (on2 - u) / d3,
  ];
}

/**
 * Pack `(x, y, z, q)` for the given topology rows (default: every row with a
 * nonzero charge) into one Float32Array, the layout the WGSL sums read.
 */
export function packCharges(
  positions: ArrayLike<number>,
  charges: ArrayLike<number>,
  rows?: ArrayLike<number> | null,
): Float32Array {
  const count = charges.length;
  if (positions.length !== count * 3) {
    throw new TypeError(
      "packCharges: positions must hold three values per charge",
    );
  }
  const chosen: number[] = [];
  if (rows) {
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k];
      if (!Number.isInteger(row) || row < 0 || row >= count) {
        throw new RangeError(`packCharges: row ${row} is out of range`);
      }
      if (charges[row] !== 0) chosen.push(row);
    }
  } else {
    for (let row = 0; row < count; row++) {
      if (charges[row] !== 0) chosen.push(row);
    }
  }
  const out = new Float32Array(chosen.length * 4);
  chosen.forEach((row, k) => {
    out[k * 4] = positions[row * 3];
    out[k * 4 + 1] = positions[row * 3 + 1];
    out[k * 4 + 2] = positions[row * 3 + 2];
    out[k * 4 + 3] = charges[row];
  });
  return out;
}

function checkAtoms(atoms: ArrayLike<number>): number {
  if (atoms.length % 4 !== 0) {
    throw new TypeError("electrostatics: atoms must be packed xyzq");
  }
  return atoms.length / 4;
}
function checkPoints(points: ArrayLike<number>): number {
  if (points.length % 3 !== 0) {
    throw new TypeError("electrostatics: points must be packed xyz");
  }
  return points.length / 3;
}

/**
 * Potential and −dφ/dr per unit charge at clamped distance r, for the model.
 * Returns [g, h] with φ = scale·q·g and E = scale·q·h·r̂ (h = 0 inside the
 * clamp, where g is constant).
 */
function kernel(p: Electrostatics, r: number): [number, number] {
  const [s, ds] = coulombSwitch(p, r);
  if (s === 0) return [0, 0];
  const [g, h] = unswitched(p, r);
  // φ ∝ g·S, so E ∝ −d(g·S)/dr = h·S − g·S′.
  return [g * s, h * s - g * ds];
}

function unswitched(p: Electrostatics, r: number): [number, number] {
  const re = Math.max(r, p.minDistance);
  const inside = r < p.minDistance;
  switch (p.model) {
    case "vacuum":
      return [1 / re, inside ? 0 : 1 / (re * re)];
    case "distance":
      return [1 / (re * re), inside ? 0 : 2 / (re * re * re)];
    case "debye": {
      const e = Math.exp(-p.kappa * re);
      return [e / re, inside ? 0 : e * (1 + p.kappa * re) / (re * re)];
    }
  }
}

/** f64 potential at each packed-xyz point from packed-xyzq atoms. */
export function coulombPotential(
  points: ArrayLike<number>,
  atoms: ArrayLike<number>,
  options: ElectrostaticsOptions | Electrostatics = {},
): Float64Array {
  const p = "scale" in options ? options : electrostatics(options);
  const n = checkPoints(points), m = checkAtoms(atoms);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    let sum = 0;
    for (let j = 0; j < m; j++) {
      const dx = x - atoms[j * 4],
        dy = y - atoms[j * 4 + 1],
        dz = z - atoms[j * 4 + 2];
      sum += atoms[j * 4 + 3] * kernel(p, Math.hypot(dx, dy, dz))[0];
    }
    out[i] = p.scale * sum;
  }
  return out;
}

/** f64 field E = −∇φ (closed form) at each point, packed xyz, unit per Å. */
export function coulombField(
  points: ArrayLike<number>,
  atoms: ArrayLike<number>,
  options: ElectrostaticsOptions | Electrostatics = {},
): Float64Array {
  const p = "scale" in options ? options : electrostatics(options);
  const n = checkPoints(points), m = checkAtoms(atoms);
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    let ex = 0, ey = 0, ez = 0;
    for (let j = 0; j < m; j++) {
      const dx = x - atoms[j * 4],
        dy = y - atoms[j * 4 + 1],
        dz = z - atoms[j * 4 + 2];
      const r = Math.hypot(dx, dy, dz);
      if (r === 0) continue;
      const s = atoms[j * 4 + 3] * kernel(p, r)[1] / r;
      ex += s * dx;
      ey += s * dy;
      ez += s * dz;
    }
    out[i * 3] = p.scale * ex;
    out[i * 3 + 1] = p.scale * ey;
    out[i * 3 + 2] = p.scale * ez;
  }
  return out;
}

/** An index-to-world grid: `dims` samples along three column axes. */
export interface CoulombGrid {
  readonly dims: readonly [number, number, number];
  /** Column-major 4×4 index-to-world affine. */
  readonly transform: ArrayLike<number>;
}

/** World position of every grid sample, x-fastest, packed xyz (f64). */
export function gridPoints(grid: CoulombGrid): Float64Array {
  const [nx, ny, nz] = grid.dims;
  const t = grid.transform;
  const out = new Float64Array(nx * ny * nz * 3);
  let o = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        out[o++] = t[0] * i + t[4] * j + t[8] * k + t[12];
        out[o++] = t[1] * i + t[5] * j + t[9] * k + t[13];
        out[o++] = t[2] * i + t[6] * j + t[10] * k + t[14];
      }
    }
  }
  return out;
}

/** f64 potential on every grid sample, x-fastest. */
export function coulombGrid(
  grid: CoulombGrid,
  atoms: ArrayLike<number>,
  options: ElectrostaticsOptions | Electrostatics = {},
): Float64Array {
  return coulombPotential(gridPoints(grid), atoms, options);
}
