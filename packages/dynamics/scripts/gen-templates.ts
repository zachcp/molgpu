// Regenerate with: deno run -A packages/dynamics/scripts/gen-templates.ts
// Inputs are verbatim PDB2PQR files at commit 9babf94e6f9f1792b4efadb9e997955cee720d61.
const root = new URL("./upstream/", import.meta.url);
const read = (name: string) => Deno.readTextFile(new URL(name, root));
const [dat, names, aa, na, license] = await Promise.all([
  read("AMBER.DAT"),
  read("AMBER.names"),
  read("AA.xml"),
  read("NA.xml"),
  read("COPYING"),
]);
const tag = (text: string, name: string) =>
  new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1].trim() ?? "";
const blocks = (text: string, name: string) =>
  [...text.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))]
    .map((m) => m[1]);
type TopAtom = { name: string; aliases: string[]; bonds: string[] };
const topology = new Map<string, TopAtom[]>();
for (const xml of [aa, na]) {
  for (const residue of blocks(xml, "residue")) {
    topology.set(
      tag(residue, "name"),
      blocks(residue, "atom").map((atom) => ({
        name: tag(atom, "name"),
        aliases: blocks(atom, "altname").map((x) => x.trim()),
        bonds: blocks(atom, "bond").map((x) => x.trim()),
      })),
    );
  }
}
const patches = blocks(names, "residue").map((residue) => ({
  pattern: new RegExp(`^${tag(residue, "name")}$`),
  names: new Map(
    blocks(residue, "atom").map((atom) => [
      tag(atom, "name"),
      tag(atom, "useatomname"),
    ]),
  ),
}));
const raw = new Map<string, Map<string, number>>();
for (const line of dat.split(/\r?\n/)) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [residue, atom, charge] = line.split(/\s+/);
  const table = raw.get(residue) ?? new Map<string, number>();
  table.set(atom, Number(charge));
  raw.set(residue, table);
}
for (
  const base of [
    "ALA",
    "ARG",
    "ASN",
    "ASP",
    "CYS",
    "GLN",
    "GLU",
    "GLY",
    "HID",
    "HIE",
    "HIP",
    "ILE",
    "LEU",
    "LYS",
    "MET",
    "PHE",
    "PRO",
    "SER",
    "THR",
    "TRP",
    "TYR",
    "VAL",
  ]
) {
  for (const variant of [base, `N${base}`, `C${base}`]) {
    if (!raw.has(variant)) throw new Error(`missing AMBER template ${variant}`);
  }
}
for (const base of ["DA", "DC", "DG", "DT", "RA", "RC", "RG", "RU"]) {
  for (const variant of [base, `${base}3`, `${base}5`, `${base}N`]) {
    if (!raw.has(variant)) throw new Error(`missing AMBER template ${variant}`);
  }
}
const heavy = (name: string) => !/^\d*H/.test(name);
const baseName = (name: string) => {
  if (name === "WAT") return name;
  if (/^[NC][A-Z]{3}$/.test(name)) return name.slice(1);
  if (/^[DR][A-Z][35N]$/.test(name)) return name.slice(0, 2);
  return name;
};
const topologyName = (name: string) =>
  ({ DA: "RA", DC: "RC", DG: "RG" } as Record<string, string>)[name] ?? name;
type Entry = { charge: number; parent?: string };
const output: Record<
  string,
  { atoms: Record<string, Entry>; aliases: Record<string, string> }
> = {};
for (const [residue, charges] of raw) {
  const base = baseName(residue);
  const topo = topology.get(topologyName(base)) ?? topology.get(
    ({
      HID: "HIS",
      HIE: "HIS",
      HIP: "HIS",
      CYX: "CYS",
      CYM: "CYS",
      ASH: "ASP",
      GLH: "GLU",
      LYN: "LYS",
    } as Record<string, string>)[base],
  ) ?? [];
  const remap = (name: string) => {
    for (const patch of patches) {
      if (patch.pattern.test(residue) && patch.names.has(name)) {
        return patch.names.get(name)!;
      }
    }
    return name;
  };
  const aliases: Record<string, string> = {};
  const atoms: Record<string, Entry> = {};
  for (const [name, charge] of charges) atoms[name] = { charge };
  for (const atom of topo) {
    const name = remap(atom.name);
    if (!charges.has(name)) continue;
    for (const alias of [atom.name, ...atom.aliases]) {
      if (alias !== name) aliases[alias] = name;
    }
    if (!heavy(atom.name)) {
      const parent = atom.bonds.find(heavy);
      if (parent && charges.has(remap(parent))) {
        atoms[name].parent = remap(parent);
      }
    }
  }
  for (const name of Object.keys(atoms)) {
    if (!heavy(name) && !atoms[name].parent) {
      const parent = name === "H3T"
        ? "O3'"
        : name === "H5T"
        ? "O5'"
        : name === "H2'2"
        ? "C2'"
        : /^H[123]$/.test(name)
        ? "N"
        : undefined;
      if (parent && atoms[parent]) atoms[name].parent = parent;
    }
  }
  if (residue === "WAT") {
    delete atoms.HW;
    atoms.H1 = { charge: charges.get("HW")!, parent: "OW" };
    atoms.H2 = { charge: charges.get("HW")!, parent: "OW" };
    aliases.O = "OW";
  }
  if (base.startsWith("D") || base.startsWith("R")) {
    aliases.OP1 = "O1P";
    aliases.OP2 = "O2P";
    aliases["HO5'"] = "H5T";
    aliases["HO3'"] = "H3T";
  }
  output[residue] = { atoms, aliases };
}
const header =
  `/* Generated from PDB2PQR commit 9babf94e6f9f1792b4efadb9e997955cee720d61.
 * AMBER.DAT, AMBER.names, AA.xml, NA.xml. Cornell et al. (1995),
 * Wang, Cieplak & Kollman (2000), Dolinsky et al. (2004).
 * The following PDB2PQR license is reproduced verbatim:
${license.trimEnd().split("\n").map((line) => ` * ${line}`).join("\n")}
 */\n`;
const target = new URL("../src/templates.generated.ts", import.meta.url);
await Deno.writeTextFile(
  target,
  header +
    `export const templates: Readonly<Record<string, { atoms: Record<string, { charge: number; parent?: string }>; aliases: Record<string, string> }>> = ${
      JSON.stringify(output, null, 2)
    };\n`,
);
const formatted = await new Deno.Command(Deno.execPath(), {
  args: ["fmt", target.pathname],
}).output();
if (!formatted.success) {
  throw new Error("could not format generated template data");
}
