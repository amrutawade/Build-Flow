import type { BuildingGraph, Opening, Wall } from "../models";
import { wallFrame } from "./frame";

export interface WallBox {
  /** Along-wall start/end (m). */
  x0: number;
  x1: number;

  /** Height start/end (m). */
  y0: number;
  y1: number;
}

interface NormalizedOpening {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const EPS = 0.02;

/**
 * Convert openings into valid wall-local rectangles.
 *
 * Important:
 * - clamps openings to the wall
 * - removes invalid openings
 * - merges overlapping X ranges when their vertical ranges overlap
 */
function normalizeWallOpenings(
  wall: Wall,
  openings: Opening[],
): NormalizedOpening[] {
  const { length } = wallFrame(wall);

  const result: NormalizedOpening[] = [];

  for (const opening of openings) {
    if (opening.wallId !== wall.id) continue;

    const x0 = Math.max(0, opening.offset);
    const x1 = Math.min(length, opening.offset + opening.width);

    const y0 = Math.max(0, opening.sill);
    const y1 = Math.min(
      wall.height,
      opening.sill + opening.height,
    );

    if (x1 - x0 <= 0.05) continue;
    if (y1 - y0 <= 0.05) continue;

    result.push({
      x0,
      x1,
      y0,
      y1,
    });
  }

  result.sort((a, b) => {
    if (Math.abs(a.x0 - b.x0) > EPS) {
      return a.x0 - b.x0;
    }

    return a.y0 - b.y0;
  });

  // Merge overlapping openings.
  const merged: NormalizedOpening[] = [];

  for (const current of result) {
    const previous = merged[merged.length - 1];

    if (!previous) {
      merged.push({ ...current });
      continue;
    }

    const xOverlap =
      current.x0 <= previous.x1 + EPS;

    const yOverlap =
      current.y0 <= previous.y1 + EPS &&
      current.y1 >= previous.y0 - EPS;

    if (xOverlap && yOverlap) {
      previous.x0 = Math.min(previous.x0, current.x0);
      previous.x1 = Math.max(previous.x1, current.x1);
      previous.y0 = Math.min(previous.y0, current.y0);
      previous.y1 = Math.max(previous.y1, current.y1);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function wallPlanRuns(
  wall: Wall,
  openings: Opening[],
): { x0: number; x1: number }[] {
  const { length } = wallFrame(wall);

  const holes = normalizeWallOpenings(wall, openings)
    .sort((a, b) => a.x0 - b.x0);

  if (holes.length === 0) {
    return [
      {
        x0: 0,
        x1: length,
      },
    ];
  }

  const runs: { x0: number; x1: number }[] = [];

  let cursor = 0;

  for (const hole of holes) {
    if (hole.x0 > cursor + EPS) {
      runs.push({
        x0: cursor,
        x1: hole.x0,
      });
    }

    cursor = Math.max(cursor, hole.x1);
  }

  if (length > cursor + EPS) {
    runs.push({
      x0: cursor,
      x1: length,
    });
  }

  return runs;
}

/**
 * Returns solid wall rectangles after removing opening voids.
 *
 * The wall is treated as a 2D rectangle:
 *
 *        y1 ─────────────────────
 *           │      TOP           │
 *        y0 ───────┐    ┌────────
 *                  │VOID│
 *           │      │    │        │
 *        0  ───────┴────┴────────
 *           0                    length
 */
export function wallBoxes(
  wall: Wall,
  openings: Opening[],
): WallBox[] {
  const { length } = wallFrame(wall);

  const holes = normalizeWallOpenings(wall, openings);

  if (holes.length === 0) {
    return [
      {
        x0: 0,
        x1: length,
        y0: 0,
        y1: wall.height,
      },
    ];
  }

  const boxes: WallBox[] = [];

  /*
   * Instead of trying to maintain a single cursor,
   * build vertical slabs between every X boundary.
   */
  const xs = new Set<number>();

  xs.add(0);
  xs.add(length);

  for (const hole of holes) {
    xs.add(hole.x0);
    xs.add(hole.x1);
  }

  const boundaries = [...xs].sort((a, b) => a - b);

  for (let i = 0; i < boundaries.length - 1; i++) {
    const x0 = boundaries[i];
    const x1 = boundaries[i + 1];

    if (x1 - x0 <= EPS) continue;

    // Find openings crossing this X interval.
    const covering = holes.filter(
      (hole) =>
        hole.x0 <= x0 + EPS &&
        hole.x1 >= x1 - EPS,
    );

    if (covering.length === 0) {
      boxes.push({
        x0,
        x1,
        y0: 0,
        y1: wall.height,
      });

      continue;
    }

    /*
     * There may be multiple openings covering this X interval.
     * Build Y boundaries and fill only the solid portions.
     */
    const ys = new Set<number>();

    ys.add(0);
    ys.add(wall.height);

    for (const hole of covering) {
      ys.add(hole.y0);
      ys.add(hole.y1);
    }

    const yBoundaries = [...ys].sort((a, b) => a - b);

    for (let j = 0; j < yBoundaries.length - 1; j++) {
      const y0 = yBoundaries[j];
      const y1 = yBoundaries[j + 1];

      if (y1 - y0 <= EPS) continue;

      const insideOpening = covering.some(
        (hole) =>
          hole.x0 <= x0 + EPS &&
          hole.x1 >= x1 - EPS &&
          hole.y0 <= y0 + EPS &&
          hole.y1 >= y1 - EPS,
      );

      if (!insideOpening) {
        boxes.push({
          x0,
          x1,
          y0,
          y1,
        });
      }
    }
  }

  return boxes;
}