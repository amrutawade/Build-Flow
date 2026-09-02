import type { Opening, Vec2, Wall } from "../models";
import { wallFrame } from "./frame";

export function wallNormal(wall: Wall): Vec2 {
  const { ux, uy } = wallFrame(wall);
  return [-uy, ux];
}

/** Open-leaf endpoint in plan, 90° from the hinged jamb toward `opening.swing`. */
export function doorLeafEnd(opening: Opening, wall: Wall): Vec2 {
  const { ux, uy } = wallFrame(wall);
  const [nx, ny] = wallNormal(wall);
  const hingeStart = opening.hinge !== "end";
  const t = hingeStart ? opening.offset : opening.offset + opening.width;
  const sign = opening.swing ?? 1;
  return [
    wall.start[0] + ux * t + nx * sign * opening.width,
    wall.start[1] + uy * t + ny * sign * opening.width,
  ];
}

export function doorHingePoint(opening: Opening, wall: Wall): Vec2 {
  const { ux, uy } = wallFrame(wall);
  const t = opening.hinge === "end" ? opening.offset + opening.width : opening.offset;
  return [wall.start[0] + ux * t, wall.start[1] + uy * t];
}

export function doorStrikePoint(opening: Opening, wall: Wall): Vec2 {
  const { ux, uy } = wallFrame(wall);
  const t = opening.hinge === "end" ? opening.offset : opening.offset + opening.width;
  return [wall.start[0] + ux * t, wall.start[1] + uy * t];
}
