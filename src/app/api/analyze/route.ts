import { NextResponse } from "next/server";
import { analyzeImage } from "@/lib/pipeline";
import { saneStoreyHeight } from "@/lib/geometry/storey";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  const storeyHeight = Number(form.get("storeyHeight") ?? 3);
  const metersPerPixelRaw = form.get("metersPerPixel");
  const metersPerPixel =
    typeof metersPerPixelRaw === "string" && metersPerPixelRaw.length > 0
      ? Number(metersPerPixelRaw)
      : undefined;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || name.endsWith(".dxf")) {
    return NextResponse.json(
      {
        error:
          "PDF/DXF are on the roadmap. Export a PNG/JPG of the plan for this build — geometry still comes from pixels, not an LLM.",
      },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { graph, report, preview } = await analyzeImage(buffer, {
    storeyHeight: saneStoreyHeight(storeyHeight),
    metersPerPixel:
      metersPerPixel !== undefined && Number.isFinite(metersPerPixel)
        ? metersPerPixel
        : undefined,
  });

  return NextResponse.json({
    graph,
    report,
    phase: "confirm",
    png: `data:image/png;base64,${preview.toString("base64")}`,
  });
}
