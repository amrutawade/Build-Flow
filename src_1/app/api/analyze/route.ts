import { NextResponse } from "next/server";

import {
  graphFromPdf,
} from "@/lib/vision/fromPdf";

import {
  graphFromImage,
} from "@/lib/vision/fromImage";

import {
  writeIfc4,
} from "@/lib/ifc/writeIfc4";

export const runtime = "nodejs";

export async function POST(
  req: Request,
) {
  try {
    const form =
      await req.formData();

    const file =
      form.get("file");

    if (
      !(file instanceof File)
    ) {
      return NextResponse.json(
        {
          error:
            "No file uploaded.",
        },
        {
          status: 400,
        },
      );
    }

    const buffer =
      Buffer.from(
        await file.arrayBuffer(),
      );

    const storeyHeightRaw =
      form.get(
        "storeyHeight",
      );

    const allPages = form.get("allPages") === "true";

    const storeyHeight =
      Number(
        storeyHeightRaw ??
          3,
      );

    if (
      !Number.isFinite(
        storeyHeight,
      ) ||
      storeyHeight <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "storeyHeight must be a positive number.",
        },
        {
          status: 400,
        },
      );
    }

    const fileName =
      file.name.toLowerCase();

    let graph;

    if (
      fileName.endsWith(
        ".pdf",
      )
    ) {
      graph =
        await graphFromPdf(
          buffer,
          {
            storeyHeight,

            /*
             * 2200 preserves small door/window
             * symbols better than 1600.
             */
            rasterWorkMax:
              2200,

            /*
             * Automatically use vector when
             * useful native geometry exists.
             */
            preferVector:
              true,
            allPages,
          },
        );
    } else {
      graph =
        await graphFromImage(
          buffer,
          {
            storeyHeight,
          },
        );
    }

    const ifc =
      writeIfc4(graph);

    return NextResponse.json({
      graph,
      ifc,
    });
  } catch (error) {
    console.error(
      "Conversion failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Conversion failed.",
      },
      {
        status: 500,
      },
    );
  }
}