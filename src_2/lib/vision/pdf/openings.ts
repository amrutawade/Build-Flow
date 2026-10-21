import type {
    BuildingGraph,
    Opening,
    Vec2,
    Wall,
  } from "@/lib/models";
  
  import {
    wallFrame,
  } from "@/lib/geometry/frame";
  
  import {
    classifyPdfText,
  } from "./textClassifier";
  
  import type {
    PdfTextItem,
    PdfSemanticText,
  } from "./text";
  
  function distancePointToSegment(
    point: Vec2,
    a: Vec2,
    b: Vec2,
  ): {
    distance: number;
    along: number;
  } {
    const dx =
      b[0] - a[0];
  
    const dy =
      b[1] - a[1];
  
    const lengthSquared =
      dx * dx +
      dy * dy;
  
    if (
      lengthSquared <=
      1e-12
    ) {
      return {
        distance:
          Math.hypot(
            point[0] - a[0],
            point[1] - a[1],
          ),
        along: 0,
      };
    }
  
    let t =
      ((point[0] - a[0]) * dx +
        (point[1] - a[1]) * dy) /
      lengthSquared;
  
    t =
      Math.max(
        0,
        Math.min(1, t),
      );
  
    const closest: Vec2 = [
      a[0] + dx * t,
      a[1] + dy * t,
    ];
  
    return {
      distance:
        Math.hypot(
          point[0] -
            closest[0],
          point[1] -
            closest[1],
        ),
  
      along:
        Math.sqrt(
          lengthSquared,
        ) * t,
    };
  }
  
  function classifyTextItems(
    items: PdfTextItem[],
  ): PdfSemanticText[] {
    return items.map(
      (item) => {
        const classification =
          classifyPdfText(
            item.text,
          );
  
        return {
          ...item,
          type:
            classification.type,
          confidence:
            classification.confidence,
        };
      },
    );
  }
  
  function nearestWall(
    point: Vec2,
    walls: Wall[],
    maxDistance: number,
  ): {
    wall: Wall;
    distance: number;
    along: number;
  } | null {
    let best:
      | {
          wall: Wall;
          distance: number;
          along: number;
        }
      | null = null;
  
    for (const wall of walls) {
      const result =
        distancePointToSegment(
          point,
          wall.start,
          wall.end,
        );
  
      if (
        result.distance >
        maxDistance
      ) {
        continue;
      }
  
      if (
        !best ||
        result.distance <
          best.distance
      ) {
        best = {
          wall,
          distance:
            result.distance,
          along:
            result.along,
        };
      }
    }
  
    return best;
  }
  
  function defaultOpeningWidth(
    type: "door" | "window" | unknown,
  ): number {
    return type === "door"
      ? 0.9
      : 1.2;
  }
  
  function defaultOpeningHeight(
    type: "door" | "window" | unknown,
  ): number {
    return type === "door"
      ? 2.1
      : 1.2;
  }
  
  function defaultSill(
    type: "door" | "window" | unknown,
  ): number {
    return type === "door"
      ? 0
      : 0.9;
  }
  
  /**
   * Convert semantic PDF text labels into Opening objects.
   *
   * IMPORTANT:
   * Text is evidence, not geometry.
   *
   * A "D1" in a door schedule should not automatically
   * become a door. It must be spatially close to a wall.
   */
  export function openingsFromPdfText(
    graph: BuildingGraph,
    items: PdfTextItem[],
    metersPerPdfUnit: number,
  ): Opening[] {
    if (
      !items.length ||
      !graph.walls.length
    ) {
      return [];
    }
  
    const semantic =
      classifyTextItems(
        items,
      ).filter(
        (item) =>
          item.type !==
          "unknown",
      );
  
    const openings: Opening[] = [];
  
    let index = 0;
  
    /*
     * PDF text coordinates are PDF units.
     *
     * BuildingGraph coordinates are meters.
     */
    for (const item of semantic) {
      const point: Vec2 = [
        item.position[0] *
          metersPerPdfUnit,
  
        /*
         * Vector graph Y is flipped when converted
         * from PDF coordinates.
         *
         * graphFromVectorPage uses:
         *
         * (maxY - pdfY) * scale
         *
         * so the text position needs the same transform.
         *
         * We recover maxY from the wall envelope.
         */
        item.position[1] *
          metersPerPdfUnit,
      ];
  
      const wallEnvelope =
        graph.walls.flatMap(
          (wall) => [
            wall.start[1],
            wall.end[1],
          ],
        );
  
      const maxGraphY =
        Math.max(
          ...wallEnvelope,
          0,
        );
  
      point[1] =
        maxGraphY -
        point[1];
  
      /*
       * Text labels are normally close to the host wall.
       *
       * 0.75m is intentionally generous.
       */
      const host =
        nearestWall(
          point,
          graph.walls,
          0.75,
        );
  
      if (!host) {
        continue;
      }
  
      const wallLength =
        wallFrame(
          host.wall,
        ).length;
  
      const width =
        Math.min(
          defaultOpeningWidth(
            item.type,
          ),
          wallLength,
        );
  
      let offset =
        host.along -
        width / 2;
  
      offset =
        Math.max(
          0,
          Math.min(
            offset,
            Math.max(
              0,
              wallLength -
                width,
            ),
          ),
        );
  
      /*
       * Distance-based confidence.
       */
      const distanceScore =
        Math.max(
          0,
          1 -
            host.distance /
              0.75,
        );
  
      const confidence =
        Math.min(
          0.98,
          item.confidence *
            0.75 +
            distanceScore *
              0.25,
        );
  
      openings.push({
        id:
          `PDF-TEXT-${index++}`,
  
        type:
          item.type,
  
        ifcClass:
          item.type ===
          "door"
            ? "IfcDoor"
            : "IfcWindow",
  
        wallId:
          host.wall.id,
  
        offset,
  
        width,
  
        height:
          defaultOpeningHeight(
            item.type,
          ),
  
        sill:
          defaultSill(
            item.type,
          ),
  
        confidence,
  
        source:
          "pdf-vector",
  
        evidence:
          "vector-geometry",
      });
    }
  
    return dedupeSemanticOpenings(
      openings,
      graph.walls,
    );
  }
  
  function dedupeSemanticOpenings(
    openings: Opening[],
    walls: Wall[],
  ): Opening[] {
    const result: Opening[] = [];
  
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
  
      const point: Vec2 = [
        wall.start[0] +
          frame.ux *
            center,
  
        wall.start[1] +
          frame.uy *
            center,
      ];
  
      const duplicate =
        result.some(
          (existing) => {
            const otherWall =
              walls.find(
                (candidate) =>
                  candidate.id ===
                  existing.wallId,
              );
  
            if (!otherWall) {
              return false;
            }
  
            const otherFrame =
              wallFrame(
                otherWall,
              );
  
            const otherCenter =
              existing.offset +
              existing.width /
                2;
  
            const otherPoint: Vec2 = [
              otherWall.start[0] +
                otherFrame.ux *
                  otherCenter,
  
              otherWall.start[1] +
                otherFrame.uy *
                  otherCenter,
            ];
  
            return (
              Math.hypot(
                point[0] -
                  otherPoint[0],
                point[1] -
                  otherPoint[1],
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