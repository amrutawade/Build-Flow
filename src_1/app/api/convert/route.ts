import { NextResponse } from "next/server";
import { convertImageToIfc } from "@/lib/pipeline";
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const { graph, ifc, report } = await convertImageToIfc(buffer, {
    storeyHeight: saneStoreyHeight(storeyHeight),
    metersPerPixel:
      metersPerPixel !== undefined && Number.isFinite(metersPerPixel)
        ? metersPerPixel
        : undefined,
  });

  return NextResponse.json({ graph, ifc, report });
}
