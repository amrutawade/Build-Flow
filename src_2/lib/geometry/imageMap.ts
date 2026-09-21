import type { BuildingGraph, Vec2 } from "../models";

/** Pixel (0,0) is top-left of the drawing. World origin is image bottom-left, minus offsets. */
export function pixelToWorld(
  graph: Pick<
    BuildingGraph,
    "metersPerPixel" | "imageHeight" | "imageOffsetX" | "imageOffsetY"
  >,
  px: number,
  py: number,
): Vec2 {
  const mpp = graph.metersPerPixel ?? 0.025;
  const h = graph.imageHeight ?? 0;
  const ox = graph.imageOffsetX ?? 0;
  const oy = graph.imageOffsetY ?? 0;
  return [px * mpp - ox, (h - py) * mpp - oy];
}

export function worldToPixel(
  graph: Pick<
    BuildingGraph,
    "metersPerPixel" | "imageHeight" | "imageOffsetX" | "imageOffsetY"
  >,
  x: number,
  y: number,
): Vec2 {
  const mpp = graph.metersPerPixel ?? 0.025;
  const h = graph.imageHeight ?? 0;
  const ox = graph.imageOffsetX ?? 0;
  const oy = graph.imageOffsetY ?? 0;
  return [(x + ox) / mpp, h - (y + oy) / mpp];
}

/** Three.js position of the plan texture (plane lies in XZ, Y up). */
export function overlayCenter(graph: BuildingGraph): {
  x: number;
  y: number;
  z: number;
  wM: number;
  hM: number;
} {
  const mpp = graph.metersPerPixel ?? 0.025;
  const wM = (graph.imageWidth ?? 1) * mpp;
  const hM = (graph.imageHeight ?? 1) * mpp;
  const [cx, cy] = pixelToWorld(
    graph,
    (graph.imageWidth ?? 1) / 2,
    (graph.imageHeight ?? 1) / 2,
  );
  return { x: cx, y: 0.012, z: -cy, wM, hM };
}

export function snapToleranceMeters(graph: BuildingGraph): number {
  const mpp = graph.metersPerPixel;
  if (!mpp) return 0.08;
  return Math.min(0.2, Math.max(0.04, mpp * 8));
}

/** Four plan-image corners in Three.js (Y up, Z = −plan Y). UVs assume texture.flipY = true. */
export function planImageMeshData(graph: BuildingGraph): {
  positions: Float32Array;
  uvs: Float32Array;
  index: Uint16Array;
} {
  const w = graph.imageWidth ?? 1;
  const h = graph.imageHeight ?? 1;
  const tl = pixelToWorld(graph, 0, 0);
  const tr = pixelToWorld(graph, w, 0);
  const br = pixelToWorld(graph, w, h);
  const bl = pixelToWorld(graph, 0, h);
  const y = 0.006;
  const v = (p: Vec2) => [p[0], y, -p[1]] as const;
  return {
    positions: new Float32Array([...v(tl), ...v(tr), ...v(br), ...v(bl)]),
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    index: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}
