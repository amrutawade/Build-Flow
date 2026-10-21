import type {
    BuildingGraph,
    ConvertOptions,
  } from "@/lib/models";
  
  import {
    extractVectorPage,
    buildGraphFromVectorPage,
    type PdfVectorPage,
  } from "./pdf/vector";
  
  import {
    graphFromPdfRaster,
  } from "./pdf/raster";

  import {
    extractPdfTextItems,
  } from "./pdf/text";
  
  import {
    openingsFromPdfText,
  } from "./pdf/openings";

  import {
    wallFrame,
  } from "@/lib/geometry/frame";
  
  export type PdfConvertOptions =
    ConvertOptions & {
      pageNumber?: number;
      forceRaster?: boolean;
      preferVector?: boolean;
      allPages?: boolean;
      storeyNames?: string[];
    };
  
  async function loadPdf(
    input: Buffer,
  ) {
    const pdfjs =
      await import(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
  
    const task =
      pdfjs.getDocument({
        data: new Uint8Array(
          input,
        ),
        useWorkerFetch: false,
      });
  
    return {
      pdfjs,
      pdf: await task.promise,
    };
  }
  
  export async function inspectPdfPage(
    input: Buffer,
    pageNumber = 1,
  ): Promise<{
    page: PdfVectorPage;
    pageCount: number;
    textItems: ReturnType<
      typeof extractPdfTextItems
    >;
  }> {
    const {
      pdfjs,
      pdf,
    } =
      await loadPdf(input);
  
    if (
      pageNumber < 1 ||
      pageNumber > pdf.numPages
    ) {
      throw new Error(
        `PDF page ${pageNumber} is outside 1..${pdf.numPages}`,
      );
    }
  
    const page =
      await pdf.getPage(
        pageNumber,
      );
  
    const text =
      await page.getTextContent();

      const textItems =
  extractPdfTextItems(
    text,
  );
  
    const vector =
      await extractVectorPage({
        page,
        OPS:
          pdfjs.OPS as Record<
            string,
            number
          >,
        textCount:
          text.items.length,
        imageCount: 0,
      });
  
    const ops =
      await page.getOperatorList();
  
    const imageFns =
      new Set(
        [
          pdfjs.OPS
            .paintImageMaskXObject,
  
          pdfjs.OPS
            .paintImageMaskXObjectRepeat,
  
          pdfjs.OPS
            .paintSolidColorImageMask,
  
          pdfjs.OPS
            .paintImageXObject,
  
          pdfjs.OPS
            .paintInlineImageXObject,
        ].filter(
          (
            value,
          ): value is number =>
            typeof value ===
            "number",
        ),
      );
  
    vector.imageCount =
      ops.fnArray.filter(
        (fn) =>
          imageFns.has(fn),
      ).length;

    vector.textItems = textItems;
  
    return {
      page: vector,
      pageCount:pdf.numPages,
      textItems,
    };
  }
  
  function hasUsefulVectorGeometry(
    page: PdfVectorPage,
  ): boolean {
    const minLongLength =
      Math.max(
        5,
        Math.min(
          page.width,
          page.height,
        ) * 0.012,
      );
  
    const longLines =
      page.lines.filter(
        (line) =>
          Math.hypot(
            line.b[0] -
              line.a[0],
            line.b[1] -
              line.a[1],
          ) >=
          minLongLength,
      );
  
    const axisAligned =
      page.lines.filter(
        (line) => {
          const dx =
            Math.abs(
              line.b[0] -
                line.a[0],
            );
  
          const dy =
            Math.abs(
              line.b[1] -
                line.a[1],
            );
  
          const length =
            Math.hypot(
              dx,
              dy,
            );
  
          if (
            length <= 0
          ) {
            return false;
          }
  
          return (
            Math.max(
              dx,
              dy,
            ) /
              length >=
            0.97
          );
        },
      );
  
    /*
     * Vector rectangles can represent:
     *
     * - wall bands
     * - windows
     * - doors
     * - room boundaries
     *
     * Therefore rectangles are useful evidence.
     */
    return (
      longLines.length >= 4 ||
      axisAligned.length >= 12 ||
      page.rects.length >= 4
    );
  }
  
  function vectorGraphIsUsable(
    graph: BuildingGraph,
  ): boolean {
    const walls =
      graph.walls?.length ?? 0;
  
    if (
      walls < 4
    ) {
      return false;
    }
  
    /*
     * Avoid accepting a vector PDF merely because
     * it contains many unrelated rectangles.
     */
    const averageConfidence =
      walls > 0
        ? graph.walls.reduce(
            (
              sum,
              wall,
            ) =>
              sum +
              wall.confidence,
            0,
          ) / walls
        : 0;
  
    return (
      averageConfidence >=
        0.35
    );
  }
  
  /**
   * Main PDF → BuildingGraph entry point.
   *
   * Native CAD/vector PDFs use the vector pipeline.
   *
   * Scanned/image PDFs use the high-resolution raster pipeline.
   */
  async function graphFromPdfPage(
    input: Buffer,
    options: PdfConvertOptions,
  ): Promise<BuildingGraph> {
    const pageNumber =
      options.pageNumber ??
      1;
  
    /*
     * ----------------------------------------------------------
     * Explicit raster mode
     * ----------------------------------------------------------
     */
    if (
      options.forceRaster
    ) {
      const graph =
        await graphFromPdfRaster(
          input,
          {
            ...options,
  
            /*
             * Higher working resolution for PDFs.
             */
            rasterWorkMax:
              options.rasterWorkMax ??
              2200,
          },
          pageNumber,
        );
  
      graph.warnings = [
        ...(graph.warnings ??
          []),
  
        `PDF page ${pageNumber}: forced raster pipeline.`,
      ];
  
      return graph;
    }
  
    /*
     * ----------------------------------------------------------
     * Inspect PDF
     * ----------------------------------------------------------
     */
    const {
      page,
      pageCount,
      textItems
    } =
      await inspectPdfPage(
        input,
        pageNumber,
      );
  
    const vectorInfo =
      `PDF page ${pageNumber}/${pageCount}: ` +
      `${page.lines.length} vector lines, ` +
      `${page.rects.length} rectangles, ` +
      `${page.paths.length} paths, ` +
      `${page.textCount} text items, ` +
      `${page.imageCount} images.`;
  
    /*
     * ----------------------------------------------------------
     * Native/vector PDF
     * ----------------------------------------------------------
     */
    if (
      options.preferVector !==
        false &&
      hasUsefulVectorGeometry(
        page,
      )
    ) {
      const vectorGraph =
        buildGraphFromVectorPage(
          page,
          {
            ...options,
  
            /*
             * IMPORTANT:
             *
             * Vector PDF coordinates are PDF units,
             * NOT image pixels.
             */
            metersPerPdfUnit:
              options.metersPerPdfUnit,
          },
        );

        /*
 * PDF text provides semantic evidence for openings.
 *
 * Example:
 *
 * D1       → door
 * DR-02    → door
 * DOOR     → door
 *
 * W1       → window
 * WIN-02   → window
 * WINDOW   → window
 *
 * The text is only accepted when it is spatially
 * close to a reconstructed wall.
 */
if (
    textItems.length > 0 &&
    vectorGraph.walls.length > 0
  ) {
    const semanticOpenings =
      openingsFromPdfText(
        vectorGraph,
        textItems,
        options.metersPerPdfUnit ??
          1,
      );
  
    /*
     * Existing geometric openings remain.
     * Semantic openings are added only when they
     * are not duplicates.
     */
    const combined = [
      ...vectorGraph.openings,
      ...semanticOpenings,
    ];
  
    vectorGraph.openings =
      dedupeOpeningsByPosition(
        combined,
        vectorGraph.walls,
      );
  
    vectorGraph.doors =
      vectorGraph.openings.filter(
        (opening) =>
          opening.type ===
          "door",
      );
  
    vectorGraph.windows =
      vectorGraph.openings.filter(
        (opening) =>
          opening.type ===
          "window",
      );
  
    vectorGraph.warnings.push(
      `PDF semantic text analysis found ${textItems.length} text items and ${semanticOpenings.length} door/window candidates.`,
    );
  }
  
      vectorGraph.warnings = [
        ...(vectorGraph.warnings ??
          []),
  
        vectorInfo,
  
        `Vector candidate produced ${vectorGraph.walls.length} walls and ${vectorGraph.openings.length} openings.`,
      ];
  
      if (
        vectorGraphIsUsable(
          vectorGraph,
        )
      ) {
        vectorGraph.warnings.push(
          "Native vector PDF geometry was used directly; no PDF-to-image conversion was required.",
        );
  
        return vectorGraph;
      }
    }
  
    /*
     * ----------------------------------------------------------
     * Scanned/image PDF
     * ----------------------------------------------------------
     */
    const graph =
      await graphFromPdfRaster(
        input,
        {
          ...options,
  
          /*
           * Preserve small symbols during raster analysis.
           */
          rasterWorkMax:
            options.rasterWorkMax ??
            2200,
        },
        pageNumber,
      );
  
    graph.warnings = [
      ...(graph.warnings ??
        []),
  
      vectorInfo,
  
      `PDF contains insufficient native vector geometry; high-resolution raster floor-plan analysis was used.`,
    ];
  
    return graph;
  }

  /**
   * Process one or every PDF page. When allPages is enabled, each usable
   * floor-plan page becomes an IFC building storey. Cover/title pages with
   * no meaningful walls are skipped.
   */
  export async function graphFromPdf(
    input: Buffer,
    options: PdfConvertOptions,
  ): Promise<BuildingGraph> {
    if (!options.allPages) {
      return graphFromPdfPage(input, options);
    }

    const first = await inspectPdfPage(input, options.pageNumber ?? 1);
    const pageCount = first.pageCount;
    const storeys: import("@/lib/models").StoreyGraph[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const pageGraph = await graphFromPdfPage(input, {
        ...options,
        pageNumber,
        allPages: false,
      });

      // Ignore title/index pages which contain no meaningful floor geometry.
      if (pageGraph.walls.length < 3) continue;

      const name = options.storeyNames?.[pageNumber - 1] ??
        (pageNumber === 1 ? "Ground Floor" : `Storey ${storeys.length + 1}`);

      const elevation = storeys.reduce((z, x) => z + x.storeyHeight, 0);
      storeys.push({
        storeyName: name,
        elevation,
        storeyHeight: pageGraph.storeyHeight,
        metersPerPixel: pageGraph.metersPerPixel,
        metersPerPdfUnit: pageGraph.metersPerPdfUnit,
        imageWidth: pageGraph.imageWidth,
        imageHeight: pageGraph.imageHeight,
        imageOffsetX: pageGraph.imageOffsetX,
        imageOffsetY: pageGraph.imageOffsetY,
        warnings: [...pageGraph.warnings, `PDF page ${pageNumber} mapped to ${name}.`],
        walls: pageGraph.walls.map(w => ({ ...w, id: `S${storeys.length + 1}-${w.id}` })),
        openings: pageGraph.openings.map(o => ({ ...o, id: `S${storeys.length + 1}-${o.id}`, wallId: `S${storeys.length + 1}-${o.wallId}` })),
        spaces: pageGraph.spaces.map(sp => ({ ...sp, id: `S${storeys.length + 1}-${sp.id}` })),
      });

      const current = storeys[storeys.length - 1];
      current.doors = current.openings.filter(o => o.type === "door");
      current.windows = current.openings.filter(o => o.type === "window");
    }

    if (storeys.length === 0) {
      throw new Error("No usable floor-plan pages were found in the PDF.");
    }

    const firstStorey = storeys[0];
    return {
      name: "Converted Multi-Storey PDF",
      storeyName: firstStorey.storeyName,
      storeyHeight: firstStorey.storeyHeight,
      metersPerPixel: firstStorey.metersPerPixel,
      metersPerPdfUnit: firstStorey.metersPerPdfUnit,
      imageWidth: firstStorey.imageWidth,
      imageHeight: firstStorey.imageHeight,
      imageOffsetX: firstStorey.imageOffsetX,
      imageOffsetY: firstStorey.imageOffsetY,
      warnings: [
        `Processed ${pageCount} PDF pages; ${storeys.length} usable storeys were reconstructed.`,
        ...storeys.flatMap(s => s.warnings.filter(Boolean)),
      ],
      walls: firstStorey.walls,
      openings: firstStorey.openings,
      doors: firstStorey.doors,
      windows: firstStorey.windows,
      spaces: firstStorey.spaces,
      storeys,
    };
  }

  function dedupeOpeningsByPosition(
    openings: import("@/lib/models").Opening[],
    walls: import("@/lib/models").Wall[],
  ): import("@/lib/models").Opening[] {
    const result: import("@/lib/models").Opening[] =
      [];
  
    for (const opening of openings) {
      const wall =
        walls.find(
          (candidate) =>
            candidate.id ===
            opening.wallId,
        );
  
      if (!wall) {
        continue;
      }
  
      const frame =
      wallFrame(wall);
  
      const center =
        opening.offset +
        opening.width / 2;
  
      const point: [number, number] = [
        wall.start[0] +
          frame.ux * center,
  
        wall.start[1] +
          frame.uy * center,
      ];
  
      const duplicate =
        result.some(
          (existing) => {
            const existingWall =
              walls.find(
                (candidate) =>
                  candidate.id ===
                  existing.wallId,
              );
  
            if (!existingWall) {
              return false;
            }
  
            const existingFrame =
            wallFrame(
              existingWall,
            );
  
            const existingCenter =
              existing.offset +
              existing.width /
                2;
  
            const existingPoint: [
              number,
              number,
            ] = [
              existingWall.start[0] +
                existingFrame.ux *
                  existingCenter,
  
              existingWall.start[1] +
                existingFrame.uy *
                  existingCenter,
            ];
  
            return (
              Math.hypot(
                point[0] -
                  existingPoint[0],
                point[1] -
                  existingPoint[1],
              ) < 0.45
            );
          },
        );
  
      if (!duplicate) {
        result.push(
          opening,
        );
      }
    }
  
    return result;
  }