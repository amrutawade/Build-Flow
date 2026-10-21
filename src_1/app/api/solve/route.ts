import { NextResponse } from "next/server";
import { z } from "zod";
import { solveGraph } from "@/lib/pipeline";
import type { BuildingGraph } from "@/lib/models";

const vec2 = z.tuple([z.number(), z.number()]);

const GraphSchema = z.object({
  name: z.string(),
  storeyName: z.string(),
  storeyHeight: z.number(),
  metersPerPixel: z.number().optional(),
  imageWidth: z.number().optional(),
  imageHeight: z.number().optional(),
  imageOffsetX: z.number().optional(),
  imageOffsetY: z.number().optional(),
  warnings: z.array(z.string()),
  walls: z.array(z.any()),
  openings: z.array(z.any()),
  doors: z.array(z.any()).optional(),
  windows: z.array(z.any()).optional(),
  spaces: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      polygon: z.array(vec2),
      area: z.number().optional(),
      ifcClass: z.literal("IfcSpace").optional(),
      confidence: z.number(),
    }),
  ),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = GraphSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const solved = solveGraph(parsed.data as BuildingGraph);
  return NextResponse.json({
    graph: solved.graph,
    ifc: solved.ifc,
    report: solved.report,
    phase: "solved",
  });
}
