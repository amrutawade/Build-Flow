import { NextResponse } from "next/server";
import { sampleTwoBhk } from "@/lib/samples/twoBhk";
import { samplePng, sampleSvg, PLAN_MARGIN } from "@/lib/samples/renderPlan";
import { solveGraph } from "@/lib/pipeline";
import { enrichGraph } from "@/lib/bim/catalog";
export const dynamic = "force-static";
export const revalidate = false;

export async function GET() {
  const graph = enrichGraph(sampleTwoBhk());
  const meta = sampleSvg(graph);
  graph.metersPerPixel = meta.metersPerPixel;
  graph.imageWidth = meta.width;
  graph.imageHeight = meta.height;
  graph.imageOffsetX = PLAN_MARGIN * meta.metersPerPixel;
  graph.imageOffsetY = PLAN_MARGIN * meta.metersPerPixel;
  const solved = solveGraph(graph);
  const png = await samplePng(graph);
  return NextResponse.json({
    graph: solved.graph,
    ifc: solved.ifc,
    report: solved.report,
    png: `data:image/png;base64,${png.toString("base64")}`,
    phase: "solved",
  });
}
