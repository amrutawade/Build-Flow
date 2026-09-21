import type { Vec2 } from "../models";

export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1];
    a -= poly[j][0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}
