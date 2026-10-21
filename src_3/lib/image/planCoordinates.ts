import type { Vec2 } from "../models";

export type PlanMapping = {
  originX: number;
  originY: number;

  scaleX: number;
  scaleY: number;
};

export function worldToImage(
  p: Vec2,
  map: PlanMapping,
): Vec2 {
  return [
    p[0] * map.scaleX + map.originX,
    p[1] * map.scaleY + map.originY,
  ];
}

export function imageToWorld(
  p: Vec2,
  map: PlanMapping,
): Vec2 {
  return [
    (p[0] - map.originX) / map.scaleX,
    (p[1] - map.originY) / map.scaleY,
  ];
}