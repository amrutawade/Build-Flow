import type {
    BuildingGraph,
    Opening,
  } from "@/lib/models";
  
  import {
    wallFrame,
  } from "@/lib/geometry/frame";
  
  import {
    classifyPdfText,
  } from "./textClassifier";
  
  import type {
    PdfTextItem,
  } from "./text";
  
  export function openingsFromRasterText(
    graph: BuildingGraph,
    items: PdfTextItem[],
    imageWidth: number,
    imageHeight: number,
  ): Opening[] {
    if (
      !graph.walls.length ||
      !items.length
    ) {
      return [];
    }
  
    const mpp =
      graph.metersPerPixel;
  
    if (
      !mpp ||
      !Number.isFinite(mpp) ||
      mpp <= 0
    ) {
      return [];
    }
  
    const results: Opening[] = [];
  
    let index = 0;
  
    for (const item of items) {
      const classification =
        classifyPdfText(
          item.text,
        );
  
      if (
        classification.type ===
        "unknown"
      ) {
        continue;
      }
  
      /*
       * OCR coordinates:
       *
       * x → left to right
       * y → top to bottom
       *
       * graph coordinates:
       *
       * x → left to right
       * y → bottom to top
       */
      const px =
        item.position[0] +
        item.width / 2;
  
      const py =
        item.position[1] +
        item.height / 2;
  
      const point: [
        number,
        number,
      ] = [
        px * mpp,
  
        (imageHeight - py) *
          mpp,
      ];
  
      let best:
        | {
            wall: BuildingGraph["walls"][number];
            distance: number;
            along: number;
          }
        | undefined;
  
      for (const wall of graph.walls) {
        const frame =
          wallFrame(wall);
  
        const dx =
          point[0] -
          wall.start[0];
  
        const dy =
          point[1] -
          wall.start[1];
  
        const along =
          dx * frame.ux +
          dy * frame.uy;
  
        const clamped =
          Math.max(
            0,
            Math.min(
              along,
              frame.length,
            ),
          );
  
        const closestX =
          wall.start[0] +
          frame.ux *
            clamped;
  
        const closestY =
          wall.start[1] +
          frame.uy *
            clamped;
  
        const distance =
          Math.hypot(
            point[0] -
              closestX,
            point[1] -
              closestY,
          );
  
        /*
         * OCR labels may sit somewhat away from
         * the actual wall.
         */
        if (
          distance > 0.8
        ) {
          continue;
        }
  
        if (
          !best ||
          distance <
            best.distance
        ) {
          best = {
            wall,
            distance,
            along: clamped,
          };
        }
      }
  
      if (!best) {
        continue;
      }
  
      const type =
        classification.type;
  
      const width =
        Math.min(
          type === "door"
            ? 0.9
            : 1.2,
  
          wallFrame(
            best.wall,
          ).length,
        );
  
      const offset =
        Math.max(
          0,
          Math.min(
            best.along -
              width / 2,
  
            Math.max(
              0,
              wallFrame(
                best.wall,
              ).length -
                width,
            ),
          ),
        );
  
      const distanceConfidence =
        Math.max(
          0,
          1 -
            best.distance /
              0.8,
        );
  
      const confidence =
        Math.min(
          0.94,
          classification.confidence *
            0.70 +
            distanceConfidence *
              0.30,
        );
  
      results.push({
        id:
          `OCR-${index++}`,
  
        type,
  
        ifcClass:
          type === "door"
            ? "IfcDoor"
            : "IfcWindow",
  
        wallId:
          best.wall.id,
  
        offset,
  
        width,
  
        height:
          type === "door"
            ? 2.1
            : 1.2,
  
        sill:
          type === "door"
            ? 0
            : 0.9,
  
        confidence,
  
        source:
          "pdf-raster",
  
        evidence:
          "raster-geometry",
      });
    }
  
    return results;
  }