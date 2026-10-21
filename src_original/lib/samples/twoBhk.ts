import type { BuildingGraph, Opening, Space, Vec2, Wall } from "../models";

const H = 3.0;
const EXT = 0.23;
const INT = 0.115;

function W(
  id: string,
  start: Vec2,
  end: Vec2,
  thickness: number,
): Wall {
  return {
    id,
    start,
    end,
    thickness,
    height: H,
    kind: thickness >= 0.2 ? "external" : "internal",
    confidence: 1,
  };
}

function D(id: string, wallId: string, offset: number, width = 0.9): Opening {
  return {
    id,
    type: "door",
    wallId,
    offset,
    width,
    height: 2.1,
    sill: 0,
    confidence: 1,
  };
}

function Win(id: string, wallId: string, offset: number, width = 1.2): Opening {
  return {
    id,
    type: "window",
    wallId,
    offset,
    width,
    height: 1.2,
    sill: 0.9,
    confidence: 1,
  };
}

function S(id: string, name: string, polygon: Vec2[]): Space {
  return { id, name, polygon, confidence: 1 };
}

/**
 * Typical Indian 2 BHK, ~78 m² carpet, orthogonal, meters, origin SW corner.
 *
 *  8.4 ┌──────────┬──────────┬────────┐
 *      │ balcony  │  bed-1   │  bath  │
 *  6.6 ├──────────┤          ├────────┤
 *      │          ├──────────┤ kitchen│
 *      │  living  │  bed-2   ├────────┤
 *  3.0 │          │          │ toilet │
 *  0.0 └──────────┴──────────┴────────┘
 *     0.0        4.8        8.4      11.4
 */
export function sampleTwoBhk(): BuildingGraph {
  const walls: Wall[] = [
    W("W-S", [0, 0], [11.4, 0], EXT),
    W("W-E", [11.4, 0], [11.4, 8.4], EXT),
    W("W-N", [11.4, 8.4], [0, 8.4], EXT),
    W("W-W", [0, 8.4], [0, 0], EXT),
    W("W-v1", [4.8, 0], [4.8, 8.4], INT),
    W("W-v2", [8.4, 0], [8.4, 8.4], INT),
    W("W-h1", [4.8, 4.2], [8.4, 4.2], INT),
    W("W-h2", [8.4, 3.0], [11.4, 3.0], INT),
    W("W-h3", [8.4, 6.0], [11.4, 6.0], INT),
    W("W-h4", [0, 6.6], [4.8, 6.6], INT),
  ];

  const openings: Opening[] = [
    D("D-entry", "W-S", 1.6, 1.0),
    D("D-bed2", "W-v1", 1.2),
    D("D-bed1", "W-v1", 5.0),
    D("D-kitchen", "W-v2", 3.4),
    D("D-toilet", "W-v2", 0.8),
    D("D-bath", "W-h3", 1.0),
    D("D-balcony", "W-h4", 1.6),
    Win("WIN-living", "W-W", 2.0, 1.5),
    Win("WIN-bed2", "W-S", 6.0),
    Win("WIN-bed1", "W-N", 6.0),
    Win("WIN-bath", "W-E", 6.6, 0.9),
    Win("WIN-kitchen", "W-E", 4.0, 1.0),
    Win("WIN-balcony", "W-N", 1.2, 1.8),
  ];

  const spaces: Space[] = [
    S("SP-living", "Living / Dining", [
      [0, 0],
      [4.8, 0],
      [4.8, 6.6],
      [0, 6.6],
    ]),
    S("SP-balcony", "Balcony", [
      [0, 6.6],
      [4.8, 6.6],
      [4.8, 8.4],
      [0, 8.4],
    ]),
    S("SP-bed2", "Bedroom 2", [
      [4.8, 0],
      [8.4, 0],
      [8.4, 4.2],
      [4.8, 4.2],
    ]),
    S("SP-bed1", "Bedroom 1", [
      [4.8, 4.2],
      [8.4, 4.2],
      [8.4, 8.4],
      [4.8, 8.4],
    ]),
    S("SP-toilet", "Toilet", [
      [8.4, 0],
      [11.4, 0],
      [11.4, 3.0],
      [8.4, 3.0],
    ]),
    S("SP-kitchen", "Kitchen", [
      [8.4, 3.0],
      [11.4, 3.0],
      [11.4, 6.0],
      [8.4, 6.0],
    ]),
    S("SP-bath", "Bath", [
      [8.4, 6.0],
      [11.4, 6.0],
      [11.4, 8.4],
      [8.4, 8.4],
    ]),
  ];

  return {
    name: "Sample 2 BHK",
    storeyName: "Ground Floor",
    storeyHeight: H,
    warnings: [],
    walls,
    openings,
    spaces,
  };
}
