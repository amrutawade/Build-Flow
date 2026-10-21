import type { Wall } from "../models";

export function wallFrame(wall: Pick<Wall, "start" | "end">): {
  dx: number;
  dy: number;
  length: number;
  ux: number;
  uy: number;
} {
  const dx = wall.end[0] - wall.start[0];
  const dy = wall.end[1] - wall.start[1];
  const length = Math.hypot(dx, dy) || 1e-6;
  return { dx, dy, length, ux: dx / length, uy: dy / length };
}
