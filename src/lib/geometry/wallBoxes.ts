import type { BuildingGraph, Opening, Wall } from "../models";
import { wallFrame } from "./frame";

export interface WallBox {
  /** Along-wall start (m). */
  x0: number;
  x1: number;
  /** Height start/end (m). */
  y0: number;
  y1: number;
}

/** Solid wall pieces after cutting door/window voids. */
export function wallBoxes(wall: Wall, openings: Opening[]): WallBox[] {
  const { length } = wallFrame(wall);
  const hosted = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      x0: Math.max(0, o.offset),
      x1: Math.min(length, o.offset + o.width),
      y0: o.sill,
      y1: Math.min(wall.height, o.sill + o.height),
    }))
    .filter((o) => o.x1 - o.x0 > 0.05 && o.y1 - o.y0 > 0.05)
    .sort((a, b) => a.x0 - b.x0);

  const boxes: WallBox[] = [];
  let cursor = 0;
  for (const hole of hosted) {
    if (hole.x0 - cursor > 0.02) {
      boxes.push({ x0: cursor, x1: hole.x0, y0: 0, y1: wall.height });
    }
    if (hole.y0 > 0.02) {
      boxes.push({ x0: hole.x0, x1: hole.x1, y0: 0, y1: hole.y0 });
    }
    if (wall.height - hole.y1 > 0.02) {
      boxes.push({ x0: hole.x0, x1: hole.x1, y0: hole.y1, y1: wall.height });
    }
    cursor = Math.max(cursor, hole.x1);
  }
  if (length - cursor > 0.02) {
    boxes.push({ x0: cursor, x1: length, y0: 0, y1: wall.height });
  }
  if (boxes.length === 0) {
    boxes.push({ x0: 0, x1: length, y0: 0, y1: wall.height });
  }
  return boxes;
}

/** 2D wall centerline pieces with door/window gaps removed — matches the plan drawing. */
export function wallPlanRuns(
  wall: Wall,
  openings: Opening[],
): { x0: number; x1: number }[] {
  const { length } = wallFrame(wall);
  const holes = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => ({
      x0: Math.max(0, o.offset),
      x1: Math.min(length, o.offset + o.width),
    }))
    .filter((h) => h.x1 - h.x0 > 0.05)
    .sort((a, b) => a.x0 - b.x0);

  const runs: { x0: number; x1: number }[] = [];
  let cursor = 0;
  for (const hole of holes) {
    if (hole.x0 - cursor > 0.02) runs.push({ x0: cursor, x1: hole.x0 });
    cursor = Math.max(cursor, hole.x1);
  }
  if (length - cursor > 0.02) runs.push({ x0: cursor, x1: length });
  if (runs.length === 0 && holes.length === 0) {
    runs.push({ x0: 0, x1: length });
  }
  return runs;
}

export function openingsFor(graph: BuildingGraph, wall: Wall): Opening[] {
  return graph.openings.filter((o) => o.wallId === wall.id);
}
