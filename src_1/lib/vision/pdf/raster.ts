import sharp from "sharp";

import type { BuildingGraph, ConvertOptions } from "@/lib/models";
import { graphFromImage } from "@/lib/vision/fromImage";
import { pdfPageToPng } from "@/lib/pdftopng";

import { ocrPdfImage } from "./ocr";
import { openingsFromRasterText } from "./rasterOpenings";
import { any } from "zod/v4";
import { PdfTextItem } from "./text";

/**
 * Rendered PDF page as a raster image.
 */
export type RenderedPdfPage = {
  png: Buffer;
  width: number;
  height: number;
};

/**
 * Render a PDF page to PNG.
 *
 * The actual DPI is passed through to pdftoppm.
 */
export async function renderPdfPageToPng(
  input: Buffer,
  pageNumber = 1,
  dpi = 400,
): Promise<RenderedPdfPage> {
  const png = await pdfPageToPng(input, pageNumber, dpi);

  const meta = await sharp(png).metadata();

  return {
    png,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

/**
 * Convert a raster/scanned PDF page into a BuildingGraph.
 *
 * Pipeline:
 *
 * PDF
 *   ↓
 * high-resolution PNG
 *   ↓
 * image geometry detection
 *   ↓
 * OCR text detection
 *   ↓
 * semantic door/window detection
 *   ↓
 * merge with geometry openings
 */
export async function graphFromPdfRaster(
  input: Buffer,
  options: ConvertOptions,
  pageNumber = 1,
): Promise<BuildingGraph> {
  /*
   * IMPORTANT:
   * rendered must be created before we use rendered.width,
   * rendered.height or rendered.png.
   */
  const rendered = await renderPdfPageToPng(
    input,
    pageNumber,
    400,
  );

  if (!rendered.png || rendered.width <= 0 || rendered.height <= 0) {
    throw new Error("Failed to render PDF page to raster image.");
  }

  /*
   * Slight image enhancement before geometry detection.
   */
  const enhanced = await sharp(rendered.png)
    .removeAlpha()
    .linear(1.15, -8)
    .png()
    .toBuffer();

  /*
   * Existing image → BIM pipeline.
   *
   * This detects walls, geometric openings, spaces, etc.
   */
  const graph = await graphFromImage(enhanced, {
    ...options,

    /*
     * PDF raster images can benefit from a larger working resolution
     * than normal uploaded images.
     *
     * If rasterWorkMax does not exist in your ConvertOptions yet,
     * remove this property for now.
     */
    rasterWorkMax: options.rasterWorkMax ?? 2200,
  });

  /*
   * OCR must be executed here, after the raster image exists.
   *
   * ocrItems contains text such as:
   *   D1
   *   D2
   *   DR-01
   *   W1
   *   W2
   *   WINDOW
   *   DOOR
   */
  let ocrItems: PdfTextItem[] = [];

  try {
    ocrItems = await ocrPdfImage(enhanced);
  } catch (error) {
    console.warn(
      "PDF OCR failed; continuing with geometric openings only.",
      error,
    );
  }

  /*
   * Convert OCR text into semantic door/window candidates.
   *
   * The function should use the OCR pixel coordinates and the
   * BuildingGraph walls to determine which wall the text belongs to.
   *
   * IMPORTANT:
   * Text alone should NOT create a door/window unless it can be
   * associated with a nearby wall.
   */
  const ocrOpenings =
    ocrItems.length > 0
      ? await openingsFromRasterText(
          graph,
          ocrItems,
          rendered.width,
          rendered.height,
        )
      : [];

  /*
   * Merge OCR-derived openings with openings already detected
   * geometrically by graphFromImage().
   *
   * Do not replace the existing openings because geometry detection
   * may find openings where OCR does not.
   */
  if (ocrOpenings.length > 0) {
    graph.openings = [
      ...graph.openings,
      ...ocrOpenings,
    ];
  }

  /*
   * Mark everything originating from PDF raster processing.
   */
  graph.walls = graph.walls.map((wall) => ({
    ...wall,
    source: wall.source ?? "pdf-raster",
    evidence: wall.evidence ?? "raster-line",
  }));

  graph.openings = graph.openings.map((opening) => ({
    ...opening,
    source: opening.source ?? "pdf-raster",
    evidence: opening.evidence ?? "raster-geometry",
  }));

  return graph;
}

