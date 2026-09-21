import type { Opening, Vec2, Wall } from "../models";
import { wallFrame } from "./frame";

export function wallNormal(wall: Wall): Vec2 {
  const { ux, uy } = wallFrame(wall);
  return [-uy, ux];
}

export function doorHingePoint(
  opening: Opening,
  wall: Wall,
): Vec2 {
  const { ux, uy } = wallFrame(wall);

  const t =
    opening.hinge === "end"
      ? opening.offset + opening.width
      : opening.offset;

  return [
    wall.start[0] + ux * t,
    wall.start[1] + uy * t,
  ];
}

export function doorStrikePoint(
  opening: Opening,
  wall: Wall,
): Vec2 {
  const { ux, uy } = wallFrame(wall);

  const t =
    opening.hinge === "end"
      ? opening.offset
      : opening.offset + opening.width;

  return [
    wall.start[0] + ux * t,
    wall.start[1] + uy * t,
  ];
}

/**
 * End point of the opened door leaf.
 * The leaf rotates 90° around the hinge.
 */
export function doorLeafEnd(
  opening: Opening,
  wall: Wall,
): Vec2 {
  const hinge = doorHingePoint(opening, wall);
  const [nx, ny] = wallNormal(wall);

  const swing = opening.swing === -1 ? -1 : 1;

  return [
    hinge[0] + nx * swing * opening.width,
    hinge[1] + ny * swing * opening.width,
  ];
}