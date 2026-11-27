// Export ProteinMPNN backbone inputs from io fixtures as JSON, so the PyTorch
// reference runs on exactly the arrays @molgpu/nn sees (no parser differences).
//   deno run -A packages/nn/scripts/export_backbones.ts out.json 1crn 1ema 1a4y
import { structureFromBcif } from "@molgpu/io";
import { proteinMpnnInput } from "../src/index.ts";

const [out, ...names] = Deno.args;
const result: Record<string, unknown> = {};
for (const name of names) {
  const bytes = await Deno.readFile(
    new URL(`../../io/test/fixtures/${name}.bcif`, import.meta.url),
  );
  const input = proteinMpnnInput(await structureFromBcif(bytes));
  result[name] = {
    backbone: [...input.backbone],
    residueIndex: [...input.residueIndex],
    chain: [...input.chain],
    sequence: [...input.sequence],
  };
  console.log(`${name}: ${input.sequence.length} residues`);
}
await Deno.writeTextFile(out, JSON.stringify(result));
