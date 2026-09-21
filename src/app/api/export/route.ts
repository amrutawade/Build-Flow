import { NextResponse } from "next/server";
import { z } from "zod";
import { exportGraphToIfc } from "@/lib/pipeline";
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
  walls: z.array(
    z.object({
      id: z.string(),
      start: vec2,
      end: vec2,
      thickness: z.number(),
      height: z.number(),
      kind: z.enum(["external", "internal"]),
      length: z.number().optional(),
      ifcClass: z.literal("IfcWall").optional(),
      confidence: z.number(),
      note: z.string().optional(),
    }),
  ),
  doors: z.array(z.any()).optional(),
  windows: z.array(z.any()).optional(),
  openings: z.array(z.any()),
  spaces: z.array(z.any()),
  storeys: z.array(z.any()).optional(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = GraphSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const graph = parsed.data as BuildingGraph;
  const ifc = exportGraphToIfc(graph);
  return new NextResponse(ifc, {
    headers: {
      "Content-Type": "application/x-step",
      "Content-Disposition": `attachment; filename="${graph.name.replace(/\s+/g, "-")}.ifc"`,
    },
  });
}
