import type { BuildingGraph, ConvertOptions } from "./models";
import { writeIfc4 } from "./ifc/writeIfc4";
import { repairTopology } from "./geometry/topology";
import { graphFromCalibrated } from "./vision/fromImage";
import { calibrateImage } from "./vision/calibrate";
import { sampleTwoBhk } from "./samples/twoBhk";
import { enrichGraph } from "./bim/catalog";
import { validateGraph, type ValidationReport } from "./validate/report";
import { saneStoreyHeight } from "./geometry/storey";

export async function analyzeImage(
  image: Buffer,
  options: ConvertOptions,
): Promise<{ graph: BuildingGraph; report: ValidationReport; preview: Buffer }> {
  const cal = await calibrateImage(image);
  const graph = enrichGraph(
    await graphFromCalibrated(cal, {
      ...options,
      storeyHeight: saneStoreyHeight(options.storeyHeight),
    }),
  );
  return { graph, report: validateGraph(graph), preview: cal.png };
}

export function solveGraph(graph: BuildingGraph): {
  graph: BuildingGraph;
  ifc: string;
  report: ValidationReport;
} {
  const solved = enrichGraph(repairTopology(graph));
  const report = validateGraph(solved);
  const ifc = writeIfc4(solved);
  return { graph: solved, ifc, report };
}

export async function convertImageToIfc(
  image: Buffer,
  options: ConvertOptions,
): Promise<{ graph: BuildingGraph; ifc: string; report: ValidationReport }> {
  const { graph } = await analyzeImage(image, options);
  return solveGraph(graph);
}

export function exportGraphToIfc(graph: BuildingGraph): string {
  return writeIfc4(enrichGraph(graph));
}

export function sampleGraph(): BuildingGraph {
  return enrichGraph(sampleTwoBhk());
}
