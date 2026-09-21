import type {
  BuildingGraph,
  ConvertOptions,
} from "./models";

import { writeIfc4 } from "./ifc/writeIfc4";
import { repairTopology } from "./geometry/topology";
import { spacesFromWalls } from "./geometry/faces";

import {
  graphFromCalibrated,
} from "./vision/fromImage";

import { calibrateImage } from "./vision/calibrate";

import {
  graphFromPdf,
  type PdfConvertOptions,
} from "./vision/fromPdf";

import { sampleTwoBhk } from "./samples/twoBhk";

import { enrichGraph } from "./bim/catalog";

import {
  validateGraph,
  type ValidationReport,
} from "./validate/report";

import { saneStoreyHeight } from "./geometry/storey";


/**
 * Existing PNG/JPG/WebP pipeline.
 */
export async function analyzeImage(
  image: Buffer,
  options: ConvertOptions,
): Promise<{
  graph: BuildingGraph;
  report: ValidationReport;
  preview: Buffer;
}> {
  const cal = await calibrateImage(image);

  const graph = enrichGraph(
    await graphFromCalibrated(cal, {
      ...options,
      storeyHeight: saneStoreyHeight(
        options.storeyHeight,
      ),
    }),
  );

  return {
    graph,
    report: validateGraph(graph),
    preview: cal.png,
  };
}


/**
 * PDF pipeline.
 *
 * PDF is handled by fromPdf.ts:
 *
 * PDF
 *  ├── vector extraction
 *  └── raster fallback
 *
 * Both produce BuildingGraph.
 */
export async function analyzePdf(
  pdf: Buffer,
  options: PdfConvertOptions,
): Promise<{
  graph: BuildingGraph;
  report: ValidationReport;
  preview?: Buffer;
}> {
  const graph = enrichGraph(
    await graphFromPdf(pdf, {
      ...options,
      storeyHeight: saneStoreyHeight(
        options.storeyHeight,
      ),
    }),
  );

  return {
    graph,
    report: validateGraph(graph),
  };
}


/**
 * Generic plan analysis.
 *
 * This is the function your API route should call.
 */
export async function analyzePlan(
  input: Buffer,
  options: ConvertOptions & {
    fileType?: "image" | "pdf";
    pageNumber?: number;
    forceRaster?: boolean;
  },
): Promise<{
  graph: BuildingGraph;
  report: ValidationReport;
  preview?: Buffer;
}> {
  if (options.fileType === "pdf") {
    return analyzePdf(input, {
      ...options,
      pageNumber: options.pageNumber ?? 1,
      forceRaster: options.forceRaster ?? false,
    });
  }

  return analyzeImage(input, options);
}


/**
 * Solve an already-created BuildingGraph and generate IFC.
 */
export function solveGraph(
  graph: BuildingGraph,
): {
  graph: BuildingGraph;
  ifc: string;
  report: ValidationReport;
} {
  const repaired = repairTopology(graph);
  const regeneratedSpaces = spacesFromWalls(repaired.walls);
  const solved = enrichGraph({
    ...repaired,
    spaces: regeneratedSpaces.length >= 1 ? regeneratedSpaces : repaired.spaces,
  });

  const report = validateGraph(solved);

  const ifc = writeIfc4(solved);

  return {
    graph: solved,
    ifc,
    report,
  };
}


/**
 * Image → IFC.
 */
export async function convertImageToIfc(
  image: Buffer,
  options: ConvertOptions,
): Promise<{
  graph: BuildingGraph;
  ifc: string;
  report: ValidationReport;
}> {
  const { graph } = await analyzeImage(
    image,
    options,
  );

  return solveGraph(graph);
}


/**
 * PDF → IFC.
 */
export async function convertPdfToIfc(
  pdf: Buffer,
  options: PdfConvertOptions,
): Promise<{
  graph: BuildingGraph;
  ifc: string;
  report: ValidationReport;
}> {
  const { graph } = await analyzePdf(
    pdf,
    options,
  );

  return solveGraph(graph);
}


/**
 * Generic PDF/Image → IFC.
 */
export async function convertPlanToIfc(
  input: Buffer,
  options: ConvertOptions & {
    fileType?: "image" | "pdf";
    pageNumber?: number;
    forceRaster?: boolean;
  },
): Promise<{
  graph: BuildingGraph;
  ifc: string;
  report: ValidationReport;
}> {
  const { graph } = await analyzePlan(
    input,
    options,
  );

  return solveGraph(graph);
}


/**
 * Export an existing graph directly to IFC.
 */
export function exportGraphToIfc(
  graph: BuildingGraph,
): string {
  return writeIfc4(
    enrichGraph(graph),
  );
}


/**
 * Sample BIM graph.
 */
export function sampleGraph(): BuildingGraph {
  return enrichGraph(sampleTwoBhk());
}