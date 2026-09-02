import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sampleTwoBhk } from "../src/lib/samples/twoBhk";
import { samplePng } from "../src/lib/samples/renderPlan";
import { exportGraphToIfc } from "../src/lib/pipeline";

async function main() {
  const out = path.resolve("output");
  await mkdir(out, { recursive: true });
  const graph = sampleTwoBhk();
  const ifc = exportGraphToIfc(graph);
  const png = await samplePng(graph);
  await writeFile(path.join(out, "sample-2bhk.ifc"), ifc);
  await writeFile(path.join(out, "sample-2bhk.png"), png);
  await writeFile(
    path.join(out, "sample-2bhk.json"),
    JSON.stringify(graph, null, 2),
  );
  console.log(`Wrote IFC (${ifc.length} bytes) to output/sample-2bhk.ifc`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
