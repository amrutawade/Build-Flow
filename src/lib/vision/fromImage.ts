import sharp from "sharp";
import type { BuildingGraph, ConvertOptions, Opening, Vec2, Wall } from "../models";
import { repairTopology, joinOpeningJambs, padHostsToCorners } from "../geometry/topology";
import { polygonArea } from "../geometry/area";
import { spacesFromWalls } from "../geometry/faces";
import { saneStoreyHeight } from "../geometry/storey";
import { pixelToWorld, worldToPixel } from "../geometry/imageMap";
import { wallFrame } from "../geometry/frame";
import { calibrateImage, type CalibratedImage } from "./calibrate";

const WORK_MAX = 1600;

/**
 * Orthogonal floor-plan reader:
 * darkest strokes → walls, lighter stroke + arc → door,
 * hollow rectangle in a dark wall → window.
 */
export async function graphFromImage(
  input: Buffer,
  options: ConvertOptions,
): Promise<BuildingGraph> {
  return graphFromCalibrated(await calibrateImage(input), options);
}

export async function graphFromCalibrated(
  cal: CalibratedImage,
  options: ConvertOptions,
): Promise<BuildingGraph> {
  const origW = cal.width;
  const origH = cal.height;
  const scale = Math.min(1, WORK_MAX / Math.max(origW, origH));
  const workW = Math.max(1, Math.round(origW * scale));
  const workH = Math.max(1, Math.round(origH * scale));

  const { data, info } = await sharp(cal.png)
    .resize(workW, workH, { fit: "fill" })
    .grayscale()
    .median(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const gray = data;
  const sx = origW / w;
  const sy = origH / h;

  const thresh = darkThreshold(gray);
  const candidates = [false, true].map((invert) => {
    const mask = makeMask(gray, w, h, thresh, invert);
    dropSmallBlobs(mask, w, h, Math.max(16, Math.round((w * h) / 25000)));
    return { invert, mask, score: scoreMask(mask, w, h) };
  });
  candidates.sort((a, b) => b.score - a.score);
  const invert = candidates[0].invert;
  const ink = candidates[0].mask;
  const { wall: wallInk, light: lightInk } = splitInkLayers(gray, ink, invert);
  const opened = new Uint8Array(wallInk);
  openMask(opened, w, h);
  const lined = keepLinePixels(
    wallInk,
    w,
    h,
    Math.max(6, Math.round(Math.min(w, h) * 0.008)),
  );
  const mask = unionMask(opened, lined);

  const bbox = bounds(mask, w, h);
  const bboxOrigW = Math.max(1, (bbox.x1 - bbox.x0) * sx);
  const bboxOrigH = Math.max(1, (bbox.y1 - bbox.y0) * sy);
  const metersPerPixel =
    options.metersPerPixel ?? 12 / Math.max(bboxOrigW, bboxOrigH);
  const wallHeight = saneStoreyHeight(options.wallHeight ?? options.storeyHeight);

  const toM = (x: number, y: number): Vec2 =>
    pixelToWorld(
      {
        metersPerPixel,
        imageHeight: origH,
        imageOffsetX: 0,
        imageOffsetY: 0,
      },
      x * sx,
      y * sy,
    );

  const { walls, openings } = wallsFromMask(
    mask,
    w,
    h,
    bbox,
    toM,
    metersPerPixel,
    wallHeight,
    sx,
    sy,
  );

  const warnings: string[] = [];
  if (walls.length < 4) {
    warnings.push(
      "Could not read a clear orthogonal wall grid from this drawing. Use a high-contrast plan with walls as dark lines, not a photo of a faded print.",
    );
  }
  if (!options.metersPerPixel) {
    warnings.push(
      "Scale is estimated (longest ink span ≈ 12 m). Confirm with a known wall length before writing IFC.",
    );
  }

  let graph: BuildingGraph = {
    name: "Converted plan",
    storeyName: "Ground Floor",
    storeyHeight: wallHeight,
    metersPerPixel,
    imageWidth: origW,
    imageHeight: origH,
    imageOffsetX: 0,
    imageOffsetY: 0,
    warnings,
    walls,
    openings,
    spaces: [],
  };
  graph = repairTopology(graph);
  const hull = envelopeOf(
    graph.walls.filter((wall) => wallFrame(wall).length >= 1),
  );
  graph.walls = graph.walls.map((wall) => ({
    ...wall,
    kind: isEnvelopeWall(wall, hull, 0.85) ? "external" : "internal",
  }));
  const scanned = scanOpeningsAlongWalls(wallInk, lightInk, w, h, graph, sx, sy);
  graph.openings = sanitizeOpenings(
    mergeOpenings(
      scanned,
      graph.openings,
      graph.walls,
    ),
    graph.walls,
  );
  graph.openings = annotateDoorSwings(lightInk, w, h, graph, sx, sy);
  const padded = padHostsToCorners(
    joinOpeningJambs(graph.walls, graph.openings),
    graph.openings,
  );
  graph.walls = padded.walls;
  graph.openings = padded.openings;
  const fromWalls = spacesFromWalls(graph.walls);
  graph.spaces =
    fromWalls.length >= 2
      ? fromWalls
      : roomsByFlood(mask, w, h, origH, sx, sy, metersPerPixel);
  graph.walls = graph.walls.map((wall) => ({ ...wall, height: wallHeight }));
  graph.doors = graph.openings.filter((o) => o.type === "door");
  graph.windows = graph.openings.filter((o) => o.type === "window");
  return graph;
}

type Frag = {
  horiz: boolean;
  pos: number;
  a: number;
  b: number;
  thickness: number;
  score: number;
};

function wallsFromMask(
  mask: Uint8Array,
  w: number,
  h: number,
  bbox: { x0: number; y0: number; x1: number; y1: number },
  toM: (x: number, y: number) => Vec2,
  metersPerPixel: number,
  wallHeight: number,
  sx: number,
  sy: number,
): { walls: Wall[]; openings: Opening[] } {
  const frags: Frag[] = [];

  const ingest = (
    peak: Peak,
    runs: { kind: "wall" | "gap"; a: number; b: number }[],
    horiz: boolean,
    alongScale: number,
    thickScale: number,
  ) => {
    const thickness = clamp(peak.thick * thickScale * metersPerPixel, 0.1, 0.23);
    for (const run of runs) {
      if (run.kind !== "wall") continue;
      const len = (run.b - run.a) * alongScale * metersPerPixel;
      if (len < 0.35) continue;
      frags.push({
        horiz,
        pos: peak.pos,
        a: run.a,
        b: run.b,
        thickness,
        score: peak.score,
      });
    }
  };

  for (const band of projectionBands(bbox, "h")) {
    for (const peak of densityPeaks(mask, w, h, "h", band)) {
      const runs = stripRuns(
        mask,
        w,
        h,
        peak.pos,
        Math.min(8, Math.max(2, peak.half)),
        "h",
        band,
      );
      ingest(peak, runs, true, sx, sy);
    }
  }
  for (const band of projectionBands(bbox, "v")) {
    for (const peak of densityPeaks(mask, w, h, "v", band)) {
      const runs = stripRuns(
        mask,
        w,
        h,
        peak.pos,
        Math.min(8, Math.max(2, peak.half)),
        "v",
        band,
      );
      ingest(peak, runs, false, sy, sx);
    }
  }

  const stitched = stitchFrags(frags, sx, sy, metersPerPixel);
  const walls: Wall[] = [];
  const openings: Opening[] = [];
  let wi = 0;
  let oi = 0;
  for (const g of stitched) {
    const alongScale = g.horiz ? sx : sy;
    const start = g.horiz ? toM(g.a, g.pos) : toM(g.pos, g.a);
    const end = g.horiz ? toM(g.b, g.pos) : toM(g.pos, g.b);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < 0.4) continue;
    const id = `W-${wi++}`;
    walls.push({
      id,
      start,
      end,
      thickness: g.thickness,
      height: wallHeight,
      kind: g.thickness >= 0.18 ? "external" : "internal",
      confidence: g.score,
    });
    for (const hole of g.holes) {
      const width = (hole.b - hole.a) * alongScale * metersPerPixel;
      const offset = (hole.a - g.a) * alongScale * metersPerPixel;
      openings.push({
        id: `O-${oi++}`,
        type: width >= 1.05 ? "window" : "door",
        wallId: id,
        offset: Math.max(0, offset),
        width,
        height: width >= 1.05 ? 1.2 : 2.1,
        sill: width >= 1.05 ? 0.9 : 0,
        confidence: 0.7,
      });
    }
  }

  const kept = pruneSketchNoise(nmsParallelWalls(dedupeWalls(walls)));
  const remapped = openings
    .map((opening) => {
      if (kept.some((wall) => wall.id === opening.wallId)) return opening;
      const orig = walls.find((wall) => wall.id === opening.wallId);
      if (!orig) return null;
      const origH =
        Math.abs(orig.end[0] - orig.start[0]) >=
        Math.abs(orig.end[1] - orig.start[1]);
      let best: Wall | null = null;
      let bestD = 0.45;
      for (const wall of kept) {
        const horiz =
          Math.abs(wall.end[0] - wall.start[0]) >=
          Math.abs(wall.end[1] - wall.start[1]);
        if (horiz !== origH) continue;
        const d = origH
          ? Math.abs(
              (wall.start[1] + wall.end[1]) / 2 - (orig.start[1] + orig.end[1]) / 2,
            )
          : Math.abs(
              (wall.start[0] + wall.end[0]) / 2 - (orig.start[0] + orig.end[0]) / 2,
            );
        if (d < bestD) {
          bestD = d;
          best = wall;
        }
      }
      return best ? { ...opening, wallId: best.id } : null;
    })
    .filter((o): o is Opening => o !== null);
  const box = envelopeOf(kept);
  const hosted = remapped.map((o) => {
      const host = kept.find((wall) => wall.id === o.wallId)!;
      const ext = isEnvelopeWall(host, box);
      const isWindow = ext && o.width >= 0.9;
      const isDoor = !isWindow && o.width >= 0.55 && o.width <= 1.2;
      if (!isWindow && !isDoor) return null;
      return {
        ...o,
        id: `${isWindow ? "WIN" : "D"}-${o.id}`,
        type: (isWindow ? "window" : "door") as Opening["type"],
        height: isWindow ? 1.2 : 2.1,
        sill: isWindow ? 0.9 : 0,
      };
    })
    .filter((o): o is Opening => o !== null);

  return { walls: kept, openings: hosted };
}

function projectionBands(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  axis: "h" | "v",
): { x0: number; y0: number; x1: number; y1: number }[] {
  const t0 = axis === "h" ? bbox.x0 : bbox.y0;
  const t1 = axis === "h" ? bbox.x1 : bbox.y1;
  const span = Math.max(1, t1 - t0 + 1);
  const width = Math.max(48, Math.round(span * 0.4));
  const step = Math.max(24, Math.round(width * 0.45));
  const bands = [{ ...bbox }];
  for (let a = t0; a <= t1; a += step) {
    const b = Math.min(t1, a + width - 1);
    bands.push(
      axis === "h" ? { ...bbox, x0: a, x1: b } : { ...bbox, y0: a, y1: b },
    );
    if (b >= t1) break;
  }
  return bands;
}

function stitchFrags(
  frags: Frag[],
  sx: number,
  sy: number,
  metersPerPixel: number,
): (Frag & { holes: { a: number; b: number }[] })[] {
  const groups: Frag[][] = [];
  for (const frag of [...frags].sort((a, b) => a.pos - b.pos || a.a - b.a)) {
    const posTol = Math.max(
      3,
      Math.round(0.1 / ((frag.horiz ? sy : sx) * metersPerPixel)),
    );
    const hit = groups.find(
      (g) =>
        g[0].horiz === frag.horiz &&
        Math.abs(g[0].pos - frag.pos) <= posTol,
    );
    if (hit) hit.push(frag);
    else groups.push([frag]);
  }

  const out: (Frag & { holes: { a: number; b: number }[] })[] = [];
  for (const group of groups) {
    const horiz = group[0].horiz;
    const alongScale = horiz ? sx : sy;
    const pos = Math.round(
      group.reduce((s, f) => s + f.pos, 0) / group.length,
    );
    const thickness = group.reduce((s, f) => s + f.thickness, 0) / group.length;
    const score = Math.max(...group.map((f) => f.score));
    const spans = group
      .map((f) => ({ a: f.a, b: f.b }))
      .sort((a, b) => a.a - b.a);
    const merged: { a: number; b: number }[] = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      const gapPx = last ? span.a - last.b : 0;
      const gapM = gapPx * alongScale * metersPerPixel;
      if (last && (gapPx <= 4 || (gapM >= 0 && gapM < 0.18))) {
        last.b = Math.max(last.b, span.b);
      } else {
        merged.push({ ...span });
      }
    }
    const stitched: { a: number; b: number; holes: { a: number; b: number }[] }[] =
      [];
    let cur = {
      a: merged[0].a,
      b: merged[0].b,
      holes: [] as { a: number; b: number }[],
    };
    for (let i = 1; i < merged.length; i++) {
      const prev = merged[i - 1];
      const next = merged[i];
      const gap = (next.a - prev.b) * alongScale * metersPerPixel;
      const leftLen = (prev.b - prev.a) * alongScale * metersPerPixel;
      const rightLen = (next.b - next.a) * alongScale * metersPerPixel;
      const doorLike = gap >= 0.55 && gap <= 1.2;
      const windowLike = gap > 1.2 && gap <= 2.4;
      if ((doorLike || windowLike) && leftLen >= 0.35 && rightLen >= 0.35) {
        cur.holes.push({ a: prev.b, b: next.a });
        cur.b = next.b;
      } else {
        stitched.push(cur);
        cur = { a: next.a, b: next.b, holes: [] };
      }
    }
    stitched.push(cur);
    for (const s of stitched) {
      out.push({
        horiz,
        pos,
        a: s.a,
        b: s.b,
        thickness,
        score,
        holes: s.holes,
      });
    }
  }
  return out;
}

function pruneSketchNoise(walls: Wall[]): Wall[] {
  const long = walls.filter((w) => wallFrame(w).length >= 0.95);
  if (long.length < 4) return walls;
  const box = envelopeOf(long);
  const padX = Math.max(0.35, (box.maxX - box.minX) * 0.06);
  const padY = Math.max(0.35, (box.maxY - box.minY) * 0.06);
  const nearLong = (p: Vec2) =>
    long.some((o) => distToSeg(p, o.start, o.end) < 0.28);
  return walls.filter((w) => {
    const len = wallFrame(w).length;
    if (len >= 0.95) return true;
    if (len >= 0.7 && (nearLong(w.start) || nearLong(w.end))) return true;
    const x = (w.start[0] + w.end[0]) / 2;
    const y = (w.start[1] + w.end[1]) / 2;
    return (
      x > box.minX + padX &&
      x < box.maxX - padX &&
      y > box.minY + padY &&
      y < box.maxY - padY
    );
  });
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function envelopeOf(walls: Wall[]) {
  const xs = walls.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = walls.flatMap((w) => [w.start[1], w.end[1]]);
  return {
    minX: Math.min(...xs, 0),
    maxX: Math.max(...xs, 1),
    minY: Math.min(...ys, 0),
    maxY: Math.max(...ys, 1),
  };
}

function isEnvelopeWall(
  wall: Wall,
  box: ReturnType<typeof envelopeOf>,
  pad = 0.55,
): boolean {
  const x = (wall.start[0] + wall.end[0]) / 2;
  const y = (wall.start[1] + wall.end[1]) / 2;
  const horiz = Math.abs(wall.end[0] - wall.start[0]) >= Math.abs(wall.end[1] - wall.start[1]);
  if (horiz) return Math.abs(y - box.minY) < pad || Math.abs(y - box.maxY) < pad;
  return Math.abs(x - box.minX) < pad || Math.abs(x - box.maxX) < pad;
}

/**
 * CAD symbols:
 * - darkest ink → wall
 * - hollow rectangle in that wall → window
 * - lighter stroke joined to an arc in a wall cut → door
 */
function scanOpeningsAlongWalls(
  wallInk: Uint8Array,
  lightInk: Uint8Array,
  w: number,
  h: number,
  graph: BuildingGraph,
  sx: number,
  sy: number,
): Opening[] {
  const mpp = graph.metersPerPixel ?? 0.025;
  const openings: Opening[] = [];
  let n = 0;

  const hit = (src: Uint8Array, x: number, y: number) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= w || iy >= h) return 0;
    return src[iy * w + ix];
  };

  type Col = "solid" | "cavity" | "mullion" | "empty";

  for (const wall of graph.walls) {
    const { length } = wallFrame(wall);
    if (length < 0.7) continue;
    const [p0x, p0y] = worldToPixel(graph, wall.start[0], wall.start[1]);
    const [p1x, p1y] = worldToPixel(graph, wall.end[0], wall.end[1]);
    const x0 = p0x / sx;
    const y0 = p0y / sy;
    const x1 = p1x / sx;
    const y1 = p1y / sy;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const pixLen = Math.hypot(dx, dy) || 1;
    const nx = -dy / pixLen;
    const ny = dx / pixLen;
    const maxR = Math.max(
      8,
      Math.round((Math.max(wall.thickness, 0.12) * 2.4) / (mpp * ((sx + sy) / 2))),
    );
    const steps = Math.max(24, Math.round(pixLen));
    const faceBand = Math.max(2, Math.round(maxR * 0.32));
    const coreBand = Math.max(1, Math.round(maxR * 0.28));
    const cols: Col[] = new Array(steps + 1);

    const profile = (src: Uint8Array, cx: number, cy: number) => {
      let dark = 0;
      let facePos = 0;
      let faceNeg = 0;
      let core = 0;
      for (let r = -maxR; r <= maxR; r++) {
        if (!hit(src, cx + nx * r, cy + ny * r)) continue;
        dark++;
        if (r >= maxR - faceBand) facePos++;
        else if (r <= -maxR + faceBand) faceNeg++;
        else if (Math.abs(r) <= coreBand) core++;
      }
      return { dark, facePos, faceNeg, core };
    };

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const p = profile(wallInk, cx, cy);
      if (p.dark <= 1) cols[i] = "empty";
      else if (p.facePos >= 1 && p.faceNeg >= 1 && p.core <= 1) cols[i] = "cavity";
      else if (p.facePos >= 1 && p.faceNeg >= 1 && p.core >= 2 && p.dark < maxR * 0.9)
        cols[i] = "mullion";
      else cols[i] = "solid";
    }

    const cavityFrac = cols.filter((c) => c === "cavity").length / cols.length;
    const doubleLineWall = cavityFrac > 0.55;

    const runs: { kind: Col; a: number; b: number }[] = [];
    let i = 0;
    while (i <= steps) {
      const kind = cols[i];
      const a = i;
      while (i <= steps && cols[i] === kind) i++;
      runs.push({ kind, a, b: i - 1 });
    }

    const emit = (
      type: "window" | "door",
      a: number,
      b: number,
      extra: Partial<Opening> = {},
    ) => {
      const offset = (a / steps) * length;
      const width = ((b - a) / steps) * length;
      if (offset < 0.03 || offset + width > length - 0.03) {
        if (type === "door") return;
        if (width > length * 0.85) return;
      }
      if (type === "window" && (width < 0.35 || width > 3.8)) return;
      if (type === "door" && (width < 0.5 || width > 1.3)) return;
      openings.push({
        id: `${type === "window" ? "WIN" : "D"}-s${n++}`,
        type,
        wallId: wall.id,
        offset: Math.max(0, offset),
        width,
        height: type === "window" ? 1.2 : 2.1,
        sill: type === "window" ? 0.9 : 0,
        confidence: type === "window" ? 0.83 : 0.72,
        ...extra,
      });
    };

    for (let r = 0; r < runs.length; r++) {
      const run = runs[r];
      const width = ((run.b - run.a) / steps) * length;
      if (run.kind === "empty") {
        const radius = Math.max(8, Math.round(width / (mpp * ((sx + sy) / 2))));
        const vote = doorSwingVote(
          lightInk,
          w,
          h,
          x0 + (dx * run.a) / steps,
          y0 + (dy * run.a) / steps,
          x0 + (dx * run.b) / steps,
          y0 + (dy * run.b) / steps,
          dy / pixLen,
          -dx / pixLen,
          radius,
        );
        let boxVotes = 0;
        for (let k = run.a; k <= run.b; k++) {
          const t = k / steps;
          const p = profile(lightInk, x0 + dx * t, y0 + dy * t);
          if (p.facePos >= 1 && p.faceNeg >= 1 && p.core <= 1) boxVotes++;
        }
        const hollowBox = boxVotes >= Math.max(3, (run.b - run.a + 1) * 0.28);
        if (hollowBox) emit("window", run.a, run.b);
        else if (vote.score >= 0.05) {
          emit("door", run.a, run.b, {
            hinge: vote.hinge,
            swing: vote.swing,
            confidence: Math.min(0.94, 0.62 + vote.score),
          });
        }
        continue;
      }
      if (run.kind !== "cavity") continue;
      if (doubleLineWall && width > 3.8) continue;
      const thinMullion = (run: { kind: Col; a: number; b: number } | undefined) =>
        run?.kind === "mullion" && ((run.b - run.a) / steps) * length < 0.28;
      let last = r;
      let panes = 1;
      while (
        panes < 3 &&
        thinMullion(runs[last + 1]) &&
        runs[last + 2]?.kind === "cavity"
      ) {
        const paneW = ((runs[last + 2].b - runs[last + 2].a) / steps) * length;
        if (paneW < 0.22 || paneW > 1.9) break;
        last += 2;
        panes++;
      }
      if (panes >= 2) {
        const pairW = ((runs[last].b - run.a) / steps) * length;
        if (pairW >= 0.5 && pairW <= 3.8) {
          emit("window", run.a, runs[last].b);
          r = last;
          continue;
        }
      }
      const prev = runs[r - 1];
      const next = runs[r + 1];
      const boxed =
        (prev?.kind === "solid" || prev?.kind === "mullion") &&
        (next?.kind === "solid" || next?.kind === "mullion");
      if (boxed || (!doubleLineWall && width <= 2.4)) {
        emit("window", run.a, run.b);
      }
    }
  }

  return mergeWindowPanes(
    mergeOpenings(
      openings,
      hollowRectWindows(unionMask(wallInk, lightInk), w, h, graph, sx, sy),
      graph.walls,
    ),
    graph.walls,
  );
}

/** Closed empty boxes whose short side is wall-thickness, not rooms. */
function hollowRectWindows(
  ink: Uint8Array,
  w: number,
  h: number,
  graph: BuildingGraph,
  sx: number,
  sy: number,
): Opening[] {
  const mpp = graph.metersPerPixel ?? 0.025;
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  const flood = (sx0: number, sy0: number, tag: number) => {
    if (ink[sy0 * w + sx0] || seen[sy0 * w + sx0]) return null;
    let qs = 0;
    let qe = 0;
    qx[qe] = sx0;
    qy[qe] = sy0;
    qe++;
    seen[sy0 * w + sx0] = tag;
    let n = 0;
    let x0 = sx0;
    let y0 = sy0;
    let x1 = sx0;
    let y1 = sy0;
    while (qs < qe) {
      const x = qx[qs];
      const y = qy[qs];
      qs++;
      n++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (ink[j] || seen[j]) continue;
        seen[j] = tag;
        qx[qe] = nx;
        qy[qe] = ny;
        qe++;
      }
    }
    return { n, x0, y0, x1, y1 };
  };

  for (let x = 0; x < w; x++) {
    if (!ink[x]) flood(x, 0, 2);
    if (!ink[(h - 1) * w + x]) flood(x, h - 1, 2);
  }
  for (let y = 0; y < h; y++) {
    if (!ink[y * w]) flood(0, y, 2);
    if (!ink[y * w + w - 1]) flood(w - 1, y, 2);
  }

  const openings: Opening[] = [];
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (ink[y * w + x] || seen[y * w + x]) continue;
      const hole = flood(x, y, 1);
      if (!hole || hole.n < 12) continue;
      const bw = (hole.x1 - hole.x0 + 1) * sx * mpp;
      const bh = (hole.y1 - hole.y0 + 1) * sy * mpp;
      const short = Math.min(bw, bh);
      const long = Math.max(bw, bh);
      if (short < 0.05 || short > 0.42) continue;
      if (long < 0.22 || long > 2.5) continue;
      const boxArea = (hole.x1 - hole.x0 + 1) * (hole.y1 - hole.y0 + 1);
      if (hole.n / boxArea < 0.45) continue;
      const mx = ((hole.x0 + hole.x1) / 2) * sx;
      const my = ((hole.y0 + hole.y1) / 2) * sy;
      const world = pixelToWorld(graph, mx, my);
      let best: Wall | null = null;
      let bestD = 0.22;
      let bestT = 0;
      for (const wall of graph.walls) {
        const { length, ux, uy } = wallFrame(wall);
        if (length < 0.8) continue;
        const vx = world[0] - wall.start[0];
        const vy = world[1] - wall.start[1];
        const t = vx * ux + vy * uy;
        if (t < 0.08 || t > length - 0.08) continue;
        const d = Math.abs(vx * -uy + vy * ux);
        if (d < bestD) {
          bestD = d;
          best = wall;
          bestT = t;
        }
      }
      if (!best) continue;
      const horizHole = bw >= bh;
      const horizWall =
        Math.abs(best.end[0] - best.start[0]) >=
        Math.abs(best.end[1] - best.start[1]);
      if (horizHole !== horizWall) continue;
      const width = long;
      const offset = Math.max(0.04, bestT - width / 2);
      openings.push({
        id: `WIN-h${n++}`,
        type: "window",
        wallId: best.id,
        offset,
        width,
        height: 1.2,
        sill: 0.9,
        confidence: 0.8,
      });
    }
  }
  return openings;
}

/** 2 or 3 hollow panes on the same wall become one IfcWindow. */
function mergeWindowPanes(openings: Opening[], walls: Wall[]): Opening[] {
  const doors = openings.filter((o) => o.type === "door");
  const windows = openings.filter((o) => o.type === "window");
  const groups = new Map<string, Opening[]>();
  for (const w of windows) {
    const list = groups.get(w.wallId) ?? [];
    list.push(w);
    groups.set(w.wallId, list);
  }
  const merged: Opening[] = [];
  for (const [, list] of groups) {
    list.sort((a, b) => a.offset - b.offset);
    let i = 0;
    while (i < list.length) {
      let j = i;
      let end = list[i].offset + list[i].width;
      while (j + 1 < list.length && j - i + 1 < 3) {
        const next = list[j + 1];
        const gap = next.offset - end;
        if (gap < -0.12 || gap > 0.32) break;
        j++;
        end = Math.max(end, next.offset + next.width);
      }
      const first = list[i];
      merged.push({
        ...first,
        offset: first.offset,
        width: Math.max(first.width, end - first.offset),
        height: 1.2,
        sill: 0.9,
        type: "window",
      });
      i = j + 1;
    }
  }
  return [...doors, ...merged];
}

function mergeOpenings(
  preferred: Opening[],
  extra: Opening[],
  walls: Wall[],
): Opening[] {
  const kept: Opening[] = [...preferred];
  const mid = (o: Opening): Vec2 | null => {
    const host = walls.find((w) => w.id === o.wallId);
    if (!host) return null;
    const { ux, uy } = wallFrame(host);
    return [
      host.start[0] + ux * (o.offset + o.width / 2),
      host.start[1] + uy * (o.offset + o.width / 2),
    ];
  };
  for (const o of extra) {
    const a = mid(o);
    if (!a) continue;
    const hit = kept.find((p) => {
      const b = mid(p);
      return b !== null && Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.55;
    });
    if (hit) {
      if (o.type === "window" && hit.type !== "window") {
        hit.type = "window";
        hit.height = 1.2;
        hit.sill = 0.9;
        if (!hit.id.startsWith("WIN")) hit.id = `WIN-${hit.id}`;
      }
      continue;
    }
    kept.push(o);
  }
  return kept;
}

function sanitizeOpenings(openings: Opening[], walls: Wall[]): Opening[] {
  return openings
    .map((opening) => {
      const host = walls.find((w) => w.id === opening.wallId);
      if (!host) return null;
      const len = wallFrame(host).length;
      const isWindow = opening.type === "window";
      const width = isWindow
        ? clamp(opening.width, 0.4, Math.min(3.8, Math.max(0.5, len - 0.12)))
        : clamp(opening.width, 0.7, Math.min(1.1, Math.max(0.7, len - 0.15)));
      if (width > len - 0.12) return null;
      const offset = Math.max(
        0.04,
        Math.min(opening.offset, len - width - 0.04),
      );
      return {
        ...opening,
        width,
        offset,
        height: isWindow ? 1.2 : 2.1,
        sill: isWindow ? 0.9 : 0,
      };
    })
    .filter((o): o is Opening => o !== null);
}

function annotateDoorSwings(
  lightInk: Uint8Array,
  w: number,
  h: number,
  graph: BuildingGraph,
  sx: number,
  sy: number,
): Opening[] {
  return graph.openings.map((opening) => {
    if (opening.type !== "door") return opening;
    const wall = graph.walls.find((w0) => w0.id === opening.wallId);
    if (!wall) return opening;
    const { length } = wallFrame(wall);
    const [p0x, p0y] = worldToPixel(graph, wall.start[0], wall.start[1]);
    const [p1x, p1y] = worldToPixel(graph, wall.end[0], wall.end[1]);
    const x0 = p0x / sx;
    const y0 = p0y / sy;
    const pdx = p1x / sx - x0;
    const pdy = p1y / sy - y0;
    const plen = Math.hypot(pdx, pdy) || 1;
    const t0 = opening.offset / length;
    const t1 = (opening.offset + opening.width) / length;
    const vote = doorSwingVote(
      lightInk,
      w,
      h,
      x0 + pdx * t0,
      y0 + pdy * t0,
      x0 + pdx * t1,
      y0 + pdy * t1,
      pdy / plen,
      -pdx / plen,
      Math.max(8, Math.round((opening.width / length) * plen)),
    );
    return { ...opening, hinge: vote.hinge, swing: vote.swing };
  });
}

/** Count light ink in the four door-swing quarters; pick hinge + side of the arc. */
function doorSwingVote(
  mask: Uint8Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  nx: number,
  ny: number,
  radius: number,
): { hinge: "start" | "end"; swing: 1 | -1; score: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const samples: { hinge: "start" | "end"; swing: 1 | -1; n: number }[] = [
    { hinge: "start", swing: 1, n: sectorInk(mask, w, h, ax, ay, ux, uy, nx, ny, radius) },
    { hinge: "start", swing: -1, n: sectorInk(mask, w, h, ax, ay, ux, uy, -nx, -ny, radius) },
    { hinge: "end", swing: 1, n: sectorInk(mask, w, h, bx, by, -ux, -uy, nx, ny, radius) },
    { hinge: "end", swing: -1, n: sectorInk(mask, w, h, bx, by, -ux, -uy, -nx, -ny, radius) },
  ];
  samples.sort((a, b) => b.n - a.n);
  const best = samples[0];
  const area = Math.max(1, radius * radius * 0.4);
  return { hinge: best.hinge, swing: best.swing, score: best.n / area };
}

function sectorInk(
  mask: Uint8Array,
  w: number,
  h: number,
  hx: number,
  hy: number,
  alongX: number,
  alongY: number,
  sideX: number,
  sideY: number,
  radius: number,
): number {
  let n = 0;
  for (let i = 1; i <= 10; i++) {
    const r = (radius * i) / 10;
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * (Math.PI / 2);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const ix = Math.round(hx + (alongX * c + sideX * s) * r);
      const iy = Math.round(hy + (alongY * c + sideY * s) * r);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      n += mask[iy * w + ix];
    }
  }
  return n;
}

function sideInk(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  nx: number,
  ny: number,
  radius: number,
  wallRadius: number,
): number {
  let n = 0;
  const ox = cx + nx * (wallRadius + radius * 0.45);
  const oy = cy + ny * (wallRadius + radius * 0.45);
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y > radius * radius) continue;
      const ix = Math.round(ox + x);
      const iy = Math.round(oy + y);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      n += mask[iy * w + ix];
    }
  }
  return n;
}

function keepLinePixels(
  mask: Uint8Array,
  w: number,
  h: number,
  minRun: number,
): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!mask[y * w + x]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < w && mask[y * w + x]) x++;
      if (x - x0 >= minRun) {
        for (let i = x0; i < x; i++) out[y * w + i] = 1;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!mask[y * w + x]) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < h && mask[y * w + x]) y++;
      if (y - y0 >= minRun) {
        for (let i = y0; i < y; i++) out[i * w + x] = 1;
      }
    }
  }
  return out;
}

function dedupeWalls(walls: Wall[]): Wall[] {
  const kept: Wall[] = [];
  for (const wall of walls) {
    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const dup = kept.some((other) => {
      const olen = Math.hypot(other.end[0] - other.start[0], other.end[1] - other.start[1]);
      const sameDir =
        Math.abs(
          (wall.end[0] - wall.start[0]) / len - (other.end[0] - other.start[0]) / olen,
        ) < 0.2 &&
        Math.abs(
          (wall.end[1] - wall.start[1]) / len - (other.end[1] - other.start[1]) / olen,
        ) < 0.2;
      if (!sameDir) return false;
      const mid: Vec2 = [
        (wall.start[0] + wall.end[0]) / 2,
        (wall.start[1] + wall.end[1]) / 2,
      ];
      const omid: Vec2 = [
        (other.start[0] + other.end[0]) / 2,
        (other.start[1] + other.end[1]) / 2,
      ];
      return Math.hypot(mid[0] - omid[0], mid[1] - omid[1]) < 0.25 && Math.abs(len - olen) < 0.6;
    });
    if (!dup) kept.push(wall);
  }
  return kept;
}

function makeMask(
  gray: Uint8Array,
  w: number,
  h: number,
  thresh: number,
  invert: boolean,
): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) {
    const dark = gray[i] <= thresh;
    mask[i] = (invert ? !dark : dark) ? 1 : 0;
  }
  return mask;
}

/** Darkest ink → walls; remaining ink (gray strokes, arcs) → doors/window ticks. */
function splitInkLayers(
  gray: Uint8Array,
  ink: Uint8Array,
  invert: boolean,
): { wall: Uint8Array; light: Uint8Array } {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const g = invert ? 255 - gray[i] : gray[i];
    hist[g]++;
    total++;
  }
  if (total < 80) return { wall: ink, light: ink };
  const cut = otsuHist(hist, total);
  const wall = new Uint8Array(ink.length);
  const light = new Uint8Array(ink.length);
  let walls = 0;
  for (let i = 0; i < ink.length; i++) {
    if (!ink[i]) continue;
    const g = invert ? 255 - gray[i] : gray[i];
    if (g <= cut) {
      wall[i] = 1;
      walls++;
    } else light[i] = 1;
  }
  const frac = walls / total;
  if (frac < 0.18 || frac > 0.94) return { wall: ink, light: ink };
  return { wall, light };
}

function scoreMask(mask: Uint8Array, w: number, h: number): number {
  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];
  const frac = ink / mask.length;
  if (frac < 0.004 || frac > 0.42) return 0;
  const bbox = bounds(mask, w, h);
  const peaks =
    densityPeaks(mask, w, h, "h", bbox).length +
    densityPeaks(mask, w, h, "v", bbox).length;
  return peaks * (1 - Math.abs(frac - 0.08));
}

function darkThreshold(gray: Uint8Array): number {
  const o = otsu(gray);
  return Math.max(40, Math.min(o, 100));
}

function closeMask(mask: Uint8Array, w: number, h: number) {
  const dil = dilate4(mask, w, h);
  const ero = erode4(dil, w, h);
  mask.set(ero);
}

function openMask(mask: Uint8Array, w: number, h: number) {
  const ero = erode4(mask, w, h);
  const dil = dilate4(ero, w, h);
  mask.set(dil);
}

function unionMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] | b[i];
  return out;
}

function dilate4(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (mask[y * w + x]) continue;
      if (
        mask[y * w + x - 1] ||
        mask[y * w + x + 1] ||
        mask[(y - 1) * w + x] ||
        mask[(y + 1) * w + x]
      ) {
        out[y * w + x] = 1;
      }
    }
  }
  return out;
}

function erode4(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (
        mask[i - 1] &&
        mask[i + 1] &&
        mask[(y - 1) * w + x] &&
        mask[(y + 1) * w + x]
      ) {
        out[i] = 1;
      }
    }
  }
  return out;
}

function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  return otsuHist(hist, gray.length);
}

function otsuHist(hist: Float64Array, total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let thresh = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) {
      maxVar = v;
      thresh = t;
    }
  }
  return thresh;
}

function clamp(n: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, n));
}

function bounds(mask: Uint8Array, w: number, h: number) {
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 <= x0) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
  return { x0, y0, x1, y1 };
}

function dropSmallBlobs(
  mask: Uint8Array,
  w: number,
  h: number,
  minSize: number,
) {
  const seen = new Uint8Array(w * h);
  const qx = new Int32Array(w * h);
  const qy = new Int32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i0 = y * w + x;
      if (!mask[i0] || seen[i0]) continue;
      let n = 0;
      let qs = 0;
      let qe = 0;
      qx[qe] = x;
      qy[qe] = y;
      qe++;
      seen[i0] = 1;
      const cells: number[] = [];
      while (qs < qe) {
        const cx = qx[qs];
        const cy = qy[qs];
        qs++;
        const i = cy * w + cx;
        cells.push(i);
        n++;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!mask[j] || seen[j]) continue;
          seen[j] = 1;
          qx[qe] = nx;
          qy[qe] = ny;
          qe++;
        }
      }
      if (n < minSize) {
        for (const i of cells) mask[i] = 0;
      }
    }
  }
}

interface Peak {
  pos: number;
  half: number;
  thick: number;
  score: number;
}

function densityPeaks(
  mask: Uint8Array,
  w: number,
  h: number,
  axis: "h" | "v",
  bbox: { x0: number; y0: number; x1: number; y1: number },
): Peak[] {
  const n = axis === "h" ? h : w;
  const span =
    axis === "h" ? Math.max(1, bbox.x1 - bbox.x0 + 1) : Math.max(1, bbox.y1 - bbox.y0 + 1);
  const dens = new Float64Array(n);
  if (axis === "h") {
    for (let y = bbox.y0; y <= bbox.y1; y++) {
      let c = 0;
      for (let x = bbox.x0; x <= bbox.x1; x++) c += mask[y * w + x];
      dens[y] = c / span;
    }
  } else {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      let c = 0;
      for (let y = bbox.y0; y <= bbox.y1; y++) c += mask[y * w + x];
      dens[x] = c / span;
    }
  }
  const sm = smooth(dens, 2);
  let maxD = 0;
  for (let i = 0; i < n; i++) maxD = Math.max(maxD, sm[i]);
  const minH = Math.max(0.05, Math.min(0.12, maxD * 0.16));
  const maxThick = Math.max(24, Math.round(Math.min(w, h) * 0.075));
  const win = Math.max(3, Math.round(Math.min(w, h) * 0.005));
  const found: Peak[] = [];
  const i0 = axis === "h" ? bbox.y0 + 1 : bbox.x0 + 1;
  const i1 = axis === "h" ? bbox.y1 - 1 : bbox.x1 - 1;
  for (let i = i0; i <= i1; i++) {
    if (sm[i] < minH) continue;
    let ridge = true;
    for (let k = 1; k <= win; k++) {
      const a = i - k;
      const b = i + k;
      if (a >= 0 && sm[i] < sm[a]) {
        ridge = false;
        break;
      }
      if (b < n && sm[i] < sm[b]) {
        ridge = false;
        break;
      }
    }
    if (!ridge) continue;
    let lo = i;
    let hi = i;
    const floor = sm[i] * 0.45;
    while (lo > 0 && i - lo < maxThick && sm[lo] > floor) lo--;
    while (hi < n - 1 && hi - i < maxThick && sm[hi] > floor) hi++;
    const thick = Math.min(maxThick, Math.max(3, hi - lo));
    found.push({
      pos: Math.round((lo + hi) / 2),
      half: Math.max(2, Math.round(thick / 2)),
      thick,
      score: Math.min(1, sm[i] / Math.max(maxD, 1e-6)),
    });
  }
  let i = i0;
  while (i <= i1) {
    if (sm[i] < minH) {
      i++;
      continue;
    }
    const lo = i;
    while (i <= i1 && sm[i] >= minH) i++;
    const hi = i - 1;
    const thick = hi - lo + 1;
    if (thick < 4 || thick > maxThick) continue;
    const pos = Math.round((lo + hi) / 2);
    found.push({
      pos,
      half: Math.max(2, Math.round(thick / 2)),
      thick,
      score: Math.min(1, sm[pos] / Math.max(maxD, 1e-6)),
    });
  }
  found.sort((a, b) => b.score - a.score);
  const minDist = Math.max(6, Math.round(Math.min(w, h) * 0.012));
  const peaks: Peak[] = [];
  for (const c of found) {
    if (peaks.some((p) => Math.abs(p.pos - c.pos) < minDist)) continue;
    peaks.push(c);
  }
  return peaks;
}

function nmsParallelWalls(walls: Wall[], gap = 0.32): Wall[] {
  const lenOf = (w: Wall) =>
    Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
  const horiz = (w: Wall) =>
    Math.abs(w.end[0] - w.start[0]) >= Math.abs(w.end[1] - w.start[1]);
  const nms = (group: Wall[], alongX: boolean) => {
    const sorted = [...group].sort((a, b) => lenOf(b) - lenOf(a));
    const kept: Wall[] = [];
    for (const w of sorted) {
      const pos = alongX
        ? (w.start[1] + w.end[1]) / 2
        : (w.start[0] + w.end[0]) / 2;
      const a0 = alongX
        ? Math.min(w.start[0], w.end[0])
        : Math.min(w.start[1], w.end[1]);
      const a1 = alongX
        ? Math.max(w.start[0], w.end[0])
        : Math.max(w.start[1], w.end[1]);
      const hit = kept.some((o) => {
        const opos = alongX
          ? (o.start[1] + o.end[1]) / 2
          : (o.start[0] + o.end[0]) / 2;
        if (Math.abs(pos - opos) > gap) return false;
        const b0 = alongX
          ? Math.min(o.start[0], o.end[0])
          : Math.min(o.start[1], o.end[1]);
        const b1 = alongX
          ? Math.max(o.start[0], o.end[0])
          : Math.max(o.start[1], o.end[1]);
        return Math.min(a1, b1) - Math.max(a0, b0) > 0.4;
      });
      if (!hit) kept.push(w);
    }
    return kept;
  };
  return [
    ...nms(walls.filter(horiz), true),
    ...nms(walls.filter((w) => !horiz(w)), false),
  ];
}

function smooth(arr: Float64Array, r: number): Float64Array {
  const out = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j < 0 || j >= arr.length) continue;
      s += arr[j];
      c++;
    }
    out[i] = s / c;
  }
  return out;
}

function stripRuns(
  mask: Uint8Array,
  w: number,
  h: number,
  pos: number,
  half: number,
  axis: "h" | "v",
  bbox: { x0: number; y0: number; x1: number; y1: number },
): { kind: "wall" | "gap"; a: number; b: number }[] {
  const t0 = axis === "h" ? bbox.x0 : bbox.y0;
  const t1 = axis === "h" ? bbox.x1 : bbox.y1;
  const len = t1 - t0 + 1;
  const dark: boolean[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const t = t0 + i;
    let hits = 0;
    let n = 0;
    for (let d = -half; d <= half; d++) {
      n++;
      if (axis === "h") {
        const y = pos + d;
        if (y < 0 || y >= h) continue;
        hits += mask[y * w + t];
      } else {
        const x = pos + d;
        if (x < 0 || x >= w) continue;
        hits += mask[t * w + x];
      }
    }
    dark[i] = n > 0 && hits / n > 0.42;
  }
  const runs: { kind: "wall" | "gap"; a: number; b: number }[] = [];
  let i = 0;
  while (i < len) {
    const kind = dark[i] ? "wall" : "gap";
    const a = t0 + i;
    while (i < len && (dark[i] ? "wall" : "gap") === kind) i++;
    const b = t0 + i - 1;
    if (b - a < 3) continue;
    runs.push({ kind, a, b });
  }
  return runs;
}

function roomsByFlood(
  mask: Uint8Array,
  w: number,
  h: number,
  origH: number,
  sx: number,
  sy: number,
  mpp: number,
): BuildingGraph["spaces"] {
  const cell = 4;
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const blocked = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let c = 0;
      for (let yy = 0; yy < cell; yy++) {
        for (let xx = 0; xx < cell; xx++) {
          const x = gx * cell + xx;
          const y = gy * cell + yy;
          if (x < w && y < h) c += mask[y * w + x];
        }
      }
      blocked[gy * gw + gx] = c > cell ? 1 : 0;
    }
  }

  const seen = new Uint8Array(gw * gh);
  const flood = (sx0: number, sy0: number, paint: number) => {
    const stack = [[sx0, sy0]];
    const cells: [number, number][] = [];
    seen[sy0 * gw + sx0] = paint;
    while (stack.length) {
      const [x, y] = stack.pop()!;
      cells.push([x, y]);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const i = ny * gw + nx;
        if (seen[i] || blocked[i]) continue;
        seen[i] = paint;
        stack.push([nx, ny]);
      }
    }
    return cells;
  };

  for (let x = 0; x < gw; x++) {
    if (!blocked[x] && !seen[x]) flood(x, 0, 1);
    if (!blocked[(gh - 1) * gw + x] && !seen[(gh - 1) * gw + x])
      flood(x, gh - 1, 1);
  }
  for (let y = 0; y < gh; y++) {
    if (!blocked[y * gw] && !seen[y * gw]) flood(0, y, 1);
    if (!blocked[y * gw + gw - 1] && !seen[y * gw + gw - 1])
      flood(gw - 1, y, 1);
  }

  const spaces: BuildingGraph["spaces"] = [];
  let n = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (seen[i] || blocked[i]) continue;
      const cells = flood(x, y, 2);
      if (cells.length < 12) continue;
      let minx = gw;
      let miny = gh;
      let maxx = 0;
      let maxy = 0;
      for (const [cx, cy] of cells) {
        minx = Math.min(minx, cx);
        miny = Math.min(miny, cy);
        maxx = Math.max(maxx, cx);
        maxy = Math.max(maxy, cy);
      }
      const x0 = minx * cell * sx * mpp;
      const x1 = (maxx + 1) * cell * sx * mpp;
      const y0 = (origH - (maxy + 1) * cell * sy) * mpp;
      const y1 = (origH - miny * cell * sy) * mpp;
      const poly: Vec2[] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ];
      const area = polygonArea(poly);
      if (area < 1.2) continue;
      spaces.push({
        id: `SP-${n++}`,
        name: guessName(area),
        polygon: poly,
        confidence: 0.65,
      });
    }
  }
  return spaces;
}

function guessName(area: number): string {
  if (area < 3.5) return "Toilet / Bath";
  if (area < 7) return "Kitchen / Utility";
  if (area < 12) return "Bedroom";
  return "Living / Dining";
}
