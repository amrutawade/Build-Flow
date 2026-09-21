import type { BuildingGraph } from "../models";
import { polygonArea } from "../geometry/area";
import { enrichGraph } from "../bim/catalog";
import { saneStoreyHeight } from "./storey";

/** Uniform scale about origin. Used when the user confirms a real-world length. */
function scaleStorey(storey: import("../models").StoreyGraph, factor: number): import("../models").StoreyGraph {
  const walls = storey.walls.map(w => ({ ...w, start: [w.start[0]*factor,w.start[1]*factor] as [number,number], end: [w.end[0]*factor,w.end[1]*factor] as [number,number], thickness:w.thickness*factor, length:(w.length??0)*factor }));
  const openings = storey.openings.map(o => ({...o, offset:o.offset*factor,width:o.width*factor,sill:o.sill*factor}));
  const spaces = storey.spaces.map(sp => ({...sp, polygon:sp.polygon.map(([x,y])=>[x*factor,y*factor] as [number,number]), area:(sp.area??polygonArea(sp.polygon))*factor*factor}));
  return {...storey, metersPerPixel:storey.metersPerPixel?storey.metersPerPixel*factor:undefined, walls, openings, doors:storey.doors?.map(o=>({...o,offset:o.offset*factor,width:o.width*factor,sill:o.sill*factor})), windows:storey.windows?.map(o=>({...o,offset:o.offset*factor,width:o.width*factor,sill:o.sill*factor})), spaces};
}

export function rescaleGraph(graph: BuildingGraph, factor: number): BuildingGraph {
  if (!Number.isFinite(factor) || factor <= 0) return graph;
  const walls = graph.walls.map((w) => ({
    ...w,
    start: [w.start[0] * factor, w.start[1] * factor] as [number, number],
    end: [w.end[0] * factor, w.end[1] * factor] as [number, number],
    thickness: w.thickness * factor,
    length: (w.length ?? 0) * factor,
  }));
  const openings = graph.openings.map((o) => ({
    ...o,
    offset: o.offset * factor,
    width: o.width * factor,
    sill: o.sill * factor,
  }));
  const spaces = graph.spaces.map((s) => ({
    ...s,
    polygon: s.polygon.map(([x, y]) => [x * factor, y * factor] as [number, number]),
    area: (s.area ?? polygonArea(s.polygon)) * factor * factor,
  }));
  const next: BuildingGraph = {
    ...graph,
    metersPerPixel: graph.metersPerPixel
      ? graph.metersPerPixel * factor
      : undefined,
    imageOffsetX: (graph.imageOffsetX ?? 0) * factor,
    imageOffsetY: (graph.imageOffsetY ?? 0) * factor,
    walls,
    openings,
    spaces,
    storeys: graph.storeys?.map(s => scaleStorey(s, factor)),
  };
  return enrichGraph(next);
}

export function setStoreyHeight(graph: BuildingGraph, height: number): BuildingGraph {
  const h = saneStoreyHeight(height > 0.5 ? height : graph.storeyHeight);
  return {
    ...graph,
    storeyHeight: h,
    walls: graph.walls.map((w) => ({ ...w, height: h })),
    storeys: graph.storeys?.map((s) => ({
      ...s,
      storeyHeight: h,
      walls: s.walls.map((w) => ({ ...w, height: h })),
    })),
  };
}

export function excludeWall(graph: BuildingGraph, wallId: string): BuildingGraph {
  return enrichGraph({
    ...graph,
    walls: graph.walls.filter((w) => w.id !== wallId),
    openings: graph.openings.filter((o) => o.wallId !== wallId),
    warnings: [
      ...graph.warnings,
      `Removed wall ${wallId}. Re-check room loops if this was structural.`,
    ],
  });
}
