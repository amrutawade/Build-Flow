import type { BuildingGraph, Opening, Vec2, Wall } from "../models";
import { wallFrame } from "../geometry/frame";
import { snapToleranceMeters } from "./imageMap";

function clusterValues(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const v of sorted) {
    const g = groups[groups.length - 1];
    if (!g || v - g[g.length - 1] > tol) groups.push([v]);
    else g.push(v);
  }
  return groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

function nearest(grid: number[], v: number): number {
  let best = grid[0] ?? v;
  let d = Infinity;
  for (const g of grid) {
    const t = Math.abs(g - v);
    if (t < d) {
      d = t;
      best = g;
    }
  }
  return best;
}

function isHorizontal(wall: Wall): boolean {
  return (
    Math.abs(wall.end[0] - wall.start[0]) >= Math.abs(wall.end[1] - wall.start[1])
  );
}

/** Snap only the wall axis (X for vertical, Y for horizontal) so centerlines stay on the ink. */
export function snapOrthogonal(walls: Wall[], tol = 0.2): Wall[] {
  if (walls.length === 0) return walls;
  const horiz = walls.filter(isHorizontal);
  const vert = walls.filter((w) => !isHorizontal(w));
  const ys = clusterValues(
    horiz.map((w) => (w.start[1] + w.end[1]) / 2),
    tol,
  );
  const xs = clusterValues(
    vert.map((w) => (w.start[0] + w.end[0]) / 2),
    tol,
  );
  return walls
    .map((w) => {
      if (isHorizontal(w)) {
        const y = nearest(ys, (w.start[1] + w.end[1]) / 2);
        return { ...w, start: [w.start[0], y] as Vec2, end: [w.end[0], y] as Vec2 };
      }
      const x = nearest(xs, (w.start[0] + w.end[0]) / 2);
      return { ...w, start: [x, w.start[1]] as Vec2, end: [x, w.end[1]] as Vec2 };
    })
    .filter((w) => dist(w.start, w.end) > 0.25);
}

function pinOntoCrossings(walls: Wall[], snap: number): Wall[] {
  return walls.map((w) => {
    const start = [w.start[0], w.start[1]] as Vec2;
    const end = [w.end[0], w.end[1]] as Vec2;
    const horiz = isHorizontal(w);
    for (const other of walls) {
      if (other.id === w.id || horiz === isHorizontal(other)) continue;
      for (const p of [start, end]) {
        if (isHorizontal(other)) {
          const y = other.start[1];
          const x0 = Math.min(other.start[0], other.end[0]) - snap;
          const x1 = Math.max(other.start[0], other.end[0]) + snap;
          if (Math.abs(p[1] - y) < snap && p[0] >= x0 && p[0] <= x1) p[1] = y;
        } else {
          const x = other.start[0];
          const y0 = Math.min(other.start[1], other.end[1]) - snap;
          const y1 = Math.max(other.start[1], other.end[1]) + snap;
          if (Math.abs(p[0] - x) < snap && p[1] >= y0 && p[1] <= y1) p[0] = x;
        }
      }
    }
    return { ...w, start, end };
  });
}

/** Grow wall ends along their axis so T-junctions and corners actually touch. */
function extendToJunctions(walls: Wall[], maxReach: number): Wall[] {
  return walls.map((w) => {
    const horiz = isHorizontal(w);
    const start = extendTip(w.start, w.end, w, walls, horiz, maxReach);
    const end = extendTip(w.end, w.start, w, walls, horiz, maxReach);
    return { ...w, start, end };
  });
}

function extendTip(
  p: Vec2,
  other: Vec2,
  self: Wall,
  walls: Wall[],
  horiz: boolean,
  maxReach: number,
): Vec2 {
  let best = p;
  let bestD = maxReach + 1;
  if (horiz) {
    const isLeft = p[0] <= other[0];
    for (const o of walls) {
      if (o.id === self.id || isHorizontal(o)) continue;
      const xHit = o.start[0];
      const y0 = Math.min(o.start[1], o.end[1]) - 0.16;
      const y1 = Math.max(o.start[1], o.end[1]) + 0.16;
      if (p[1] < y0 || p[1] > y1) continue;
      const d = isLeft ? p[0] - xHit : xHit - p[0];
      if (d > -0.04 && d <= maxReach && Math.abs(d) < bestD && Math.abs(d) > 1e-4) {
        bestD = Math.abs(d);
        best = [xHit, p[1]];
      }
    }
  } else {
    const isLow = p[1] <= other[1];
    for (const o of walls) {
      if (o.id === self.id || !isHorizontal(o)) continue;
      const yHit = o.start[1];
      const x0 = Math.min(o.start[0], o.end[0]) - 0.16;
      const x1 = Math.max(o.start[0], o.end[0]) + 0.16;
      if (p[0] < x0 || p[0] > x1) continue;
      const d = isLow ? p[1] - yHit : yHit - p[1];
      if (d > -0.04 && d <= maxReach && Math.abs(d) < bestD && Math.abs(d) > 1e-4) {
        bestD = Math.abs(d);
        best = [p[0], yHit];
      }
    }
  }
  return best;
}

function envelope(walls: Wall[]) {
  const xs = walls.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = walls.flatMap((w) => [w.start[1], w.end[1]]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function isExternalWall(wall: Wall, box: ReturnType<typeof envelope>, pad = 0.45): boolean {
  const x = (wall.start[0] + wall.end[0]) / 2;
  const y = (wall.start[1] + wall.end[1]) / 2;
  if (isHorizontal(wall)) {
    return Math.abs(y - box.minY) < pad || Math.abs(y - box.maxY) < pad;
  }
  return Math.abs(x - box.minX) < pad || Math.abs(x - box.maxX) < pad;
}

/** Colinear gaps that look like doors/windows after walls are in place. */
function colinearGroups(walls: Wall[], tol = 0.18): Wall[][] {
  const groups: Wall[][] = [];
  for (const wall of walls) {
    const horiz = isHorizontal(wall);
    const pos = horiz
      ? (wall.start[1] + wall.end[1]) / 2
      : (wall.start[0] + wall.end[0]) / 2;
    const hit = groups.find((g) => {
      const o = g[0];
      if (isHorizontal(o) !== horiz) return false;
      const opos = horiz
        ? (o.start[1] + o.end[1]) / 2
        : (o.start[0] + o.end[0]) / 2;
      return Math.abs(pos - opos) <= tol;
    });
    if (hit) hit.push(wall);
    else groups.push([wall]);
  }
  return groups;
}

function spanOf(wall: Wall, horiz: boolean) {
  return horiz
    ? {
        a: Math.min(wall.start[0], wall.end[0]),
        b: Math.max(wall.start[0], wall.end[0]),
      }
    : {
        a: Math.min(wall.start[1], wall.end[1]),
        b: Math.max(wall.start[1], wall.end[1]),
      };
}

function wallFromSpan(src: Wall, horiz: boolean, a: number, b: number): Wall {
  if (horiz) {
    const y = (src.start[1] + src.end[1]) / 2;
    const startFirst = src.start[0] <= src.end[0];
    return {
      ...src,
      start: startFirst ? [a, y] : [b, y],
      end: startFirst ? [b, y] : [a, y],
    };
  }
  const x = (src.start[0] + src.end[0]) / 2;
  const startFirst = src.start[1] <= src.end[1];
  return {
    ...src,
    start: startFirst ? [x, a] : [x, b],
    end: startFirst ? [x, b] : [x, a],
  };
}

/**
 * Join colinear fragments across door/window gaps so the opening is hosted
 * on one centerline (and visible in 3D), without merging T-junction splits.
 */
function bridgeColinearOpenings(walls: Wall[]): { walls: Wall[]; openings: Opening[] } {
  const box = envelope(walls);
  const out: Wall[] = [];
  const openings: Opening[] = [];
  let n = 0;

  for (const group of colinearGroups(walls)) {
    const horiz = isHorizontal(group[0]);
    const spans = group
      .map((w) => ({ w, ...spanOf(w, horiz) }))
      .sort((a, b) => a.a - b.a);

    let cur = { w: spans[0].w, a: spans[0].a, b: spans[0].b, holes: [] as { a: number; b: number }[] };

    const flush = () => {
      const wall = wallFromSpan(cur.w, horiz, cur.a, cur.b);
      out.push(wall);
      for (const hole of cur.holes) {
        const width = hole.b - hole.a;
        const offset = hole.a - cur.a;
        const external = isExternalWall(wall, box, 0.55);
        const isWindow = width >= 0.9 && external;
        if (!isWindow && (width < 0.55 || width > 1.2)) continue;
        openings.push({
          id: `${isWindow ? "WIN" : "D"}-g${n++}`,
          type: isWindow ? "window" : "door",
          wallId: wall.id,
          offset: Math.max(0, offset),
          width,
          height: isWindow ? 1.2 : 2.1,
          sill: isWindow ? 0.9 : 0,
          confidence: 0.7,
        });
      }
    };

    for (let i = 1; i < spans.length; i++) {
      const next = spans[i];
      const gap = next.a - cur.b;
      const external = isExternalWall(cur.w, box, 0.55) || isExternalWall(next.w, box, 0.55);
      const pos = horiz
        ? (cur.w.start[1] + cur.w.end[1]) / 2
        : (cur.w.start[0] + cur.w.end[0]) / 2;
      const doorLike = gap >= 0.55 && gap <= 1.2;
      const windowLike = gap > 1.2 && gap <= 3.8 && external;
      if (gap < -0.04) {
        cur.b = Math.max(cur.b, next.b);
        if (wallFrame(next.w).length > wallFrame(cur.w).length) cur.w = next.w;
      } else if (
        gap >= 0.04 &&
        gap < 0.55 &&
        !tAtSpan(walls, horiz, pos, cur.b, next.a)
      ) {
        cur.b = next.b;
        if (wallFrame(next.w).length > wallFrame(cur.w).length) cur.w = next.w;
      } else if (doorLike || windowLike) {
        cur.holes.push({ a: cur.b, b: next.a });
        cur.b = next.b;
        if (wallFrame(next.w).length > wallFrame(cur.w).length) cur.w = next.w;
      } else {
        flush();
        cur = { w: next.w, a: next.a, b: next.b, holes: [] };
      }
    }
    flush();
  }

  return { walls: out, openings };
}

function tAtSpan(
  walls: Wall[],
  horiz: boolean,
  pos: number,
  a: number,
  b: number,
): boolean {
  return walls.some((w) => {
    if (isHorizontal(w) === horiz) return false;
    for (const p of [w.start, w.end]) {
      const along = horiz ? p[0] : p[1];
      const across = horiz ? p[1] : p[0];
      if (Math.abs(across - pos) > 0.28) continue;
      if (along >= a - 0.12 && along <= b + 0.12) return true;
    }
    return false;
  });
}

/** Snap endpoints, close T-junctions, split crossings, rehost openings. */
export function repairTopology(graph: BuildingGraph): BuildingGraph {
  const snap = snapToleranceMeters(graph);
  const aligned = pinOntoCrossings(
    extendToJunctions(snapOrthogonal(graph.walls, Math.min(snap, 0.1)), 0.55),
    Math.max(snap, 0.12),
  );
  const walls: Wall[] = aligned.map((w) => ({ ...w }));

  const split = splitAtCrossings(splitAtJunctions(walls, Math.max(snap, 0.06)));
  const extended = extendToJunctions(split, 0.55);
  let joined = extended.filter((w) => dist(w.start, w.end) > 0.05);
  joined = sealWallNetwork(joined);
  const bridged = bridgeColinearOpenings(joined);
  const cleaned = sealWallNetwork(bridged.walls);
  const fromVision = rehostOpenings(graph.walls, cleaned, graph.openings);
  const openings = dedupeOpenings(
    [...fromVision, ...bridged.openings],
    cleaned,
  ).filter(
    (opening) => {
      const host = cleaned.find((w) => w.id === opening.wallId);
      if (!host) return false;
      const len = wallFrame(host).length;
      const maxW = opening.type === "window" ? 3.8 : 1.3;
      const minW = opening.type === "window" ? 0.35 : 0.5;
      if (opening.width < minW || opening.width > maxW) return false;
      return opening.offset + opening.width <= len + 0.12;
    },
  ).map((opening) => {
    const host = cleaned.find((w) => w.id === opening.wallId)!;
    const len = wallFrame(host).length;
    const width = Math.min(opening.width, len - 0.05);
    const offset = Math.max(0, Math.min(opening.offset, Math.max(0, len - width)));
    const isWindow = opening.type === "window";
    return {
      ...opening,
      offset,
      width,
      type: isWindow ? ("window" as const) : ("door" as const),
      height: isWindow ? opening.height || 1.2 : opening.height || 2.1,
      sill: isWindow ? opening.sill || 0.9 : 0,
    };
  });

  const padded = padHostsToCorners(cleaned, openings);
  return { ...graph, walls: padded.walls, openings: padded.openings };
}

function dedupeOpenings(openings: Opening[], walls: Wall[]): Opening[] {
  const kept: Opening[] = [];
  for (const o of openings) {
    const host = walls.find((w) => w.id === o.wallId);
    if (!host) continue;
    const { ux, uy } = wallFrame(host);
    const mx = host.start[0] + ux * (o.offset + o.width / 2);
    const my = host.start[1] + uy * (o.offset + o.width / 2);
    const dup = kept.some((p) => {
      const h2 = walls.find((w) => w.id === p.wallId);
      if (!h2) return false;
      const f = wallFrame(h2);
      const px = h2.start[0] + f.ux * (p.offset + p.width / 2);
      const py = h2.start[1] + f.uy * (p.offset + p.width / 2);
      return Math.hypot(px - mx, py - my) < 0.45;
    });
    if (!dup) kept.push(o);
  }
  return kept;
}

function rehostOpenings(
  original: Wall[],
  next: Wall[],
  openings: Opening[],
): Opening[] {
  if (next.length === 0) return [];
  return openings.map((opening) => {
    const host = original.find((w) => w.id === opening.wallId);
    if (!host) return null;
    const { ux, uy } = wallFrame(host);
    const px = host.start[0] + ux * (opening.offset + opening.width / 2);
    const py = host.start[1] + uy * (opening.offset + opening.width / 2);
    const origH = isHorizontal(host);
    let best: Wall | null = null;
    let bestD = Infinity;
    for (const wall of next) {
      if (isHorizontal(wall) !== origH) continue;
      const d = distToSeg([px, py], wall.start, wall.end);
      if (d < bestD) {
        bestD = d;
        best = wall;
      }
    }
    if (!best || bestD > 0.4) return null;
    const frame = wallFrame(best);
    const offset =
      (px - best.start[0]) * frame.ux +
      (py - best.start[1]) * frame.uy -
      opening.width / 2;
    return { ...opening, wallId: best.id, offset: Math.max(0, offset) };
  }).filter((o): o is Opening => o !== null);
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function planReach(walls: Wall[]): number {
  if (walls.length === 0) return 0.9;
  const xs = walls.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = walls.flatMap((w) => [w.start[1], w.end[1]]);
  const span = Math.max(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    1,
  );
  return Math.min(4.0, Math.max(1.5, span * 0.2));
}

function tipMeetsWall(p: Vec2, self: Wall, walls: Wall[]): boolean {
  return walls.some(
    (o) => o.id !== self.id && pointSeg(p, o.start, o.end) <= 0.03,
  );
}

function dropOrphanStubs(walls: Wall[]): Wall[] {
  return walls.filter((w) => {
    const len = wallFrame(w).length;
    const loose =
      !tipMeetsWall(w.start, w, walls) && !tipMeetsWall(w.end, w, walls);
    if (!(loose && len < 0.85)) return true;
    const horiz = isHorizontal(w);
    return walls.some((o) => {
      if (o.id === w.id || isHorizontal(o) === horiz) return false;
      const vx = horiz ? o.start[0] : w.start[0];
      const hy = horiz ? w.start[1] : o.start[1];
      const corner: Vec2 = [vx, hy];
      return dist(w.start, corner) < 1.8 || dist(w.end, corner) < 1.8;
    });
  });
}

/** Extend a free end only onto a real nearby orthogonal wall, not a distant grid line. */
function snapTipsToAxisGrid(walls: Wall[], reach: number): Wall[] {
  return walls.map((w) => {
    const horiz = isHorizontal(w);
    const snap = (p: Vec2, other: Vec2): Vec2 => {
      if (tipMeetsWall(p, w, walls)) return p;
      let best = p;
      let bestD = reach;
      for (const o of walls) {
        if (o.id === w.id || isHorizontal(o) === horiz) continue;
        if (horiz) {
          const x = o.start[0];
          const d = Math.abs(p[0] - x);
          if (d < 1e-4 || d > bestD) continue;
          if (Math.abs(x - other[0]) < 0.08) continue;
          const y0 = Math.min(o.start[1], o.end[1]) - 0.2;
          const y1 = Math.max(o.start[1], o.end[1]) + 0.2;
          if (p[1] < y0 || p[1] > y1) continue;
          bestD = d;
          best = [x, p[1]];
        } else {
          const y = o.start[1];
          const d = Math.abs(p[1] - y);
          if (d < 1e-4 || d > bestD) continue;
          if (Math.abs(y - other[1]) < 0.08) continue;
          const x0 = Math.min(o.start[0], o.end[0]) - 0.2;
          const x1 = Math.max(o.start[0], o.end[0]) + 0.2;
          if (p[0] < x0 || p[0] > x1) continue;
          bestD = d;
          best = [p[0], y];
        }
      }
      return best;
    };
    return { ...w, start: snap(w.start, w.end), end: snap(w.end, w.start) };
  });
}

function sealWallNetwork(walls: Wall[]): Wall[] {
  const tReach = 0.55;
  const cornerReach = planReach(walls);
  let next = walls;
  for (let i = 0; i < 10; i++) {
    next = dropOrphanStubs(
      growToCoverTips(
        stitchCorners(
          closeDangling(snapTipsToAxisGrid(next, tReach), tReach),
          cornerReach,
        ),
      ),
    );
  }
  return next;
}

function pointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Pull free ends onto the nearest orthogonal wall so T-junctions close. */
function closeDangling(walls: Wall[], reach: number): Wall[] {
  const onWall = (p: Vec2, self: Wall) =>
    walls.some((o) => o.id !== self.id && pointSeg(p, o.start, o.end) <= 0.03);

  const snapTip = (p: Vec2, self: Wall): Vec2 => {
    if (onWall(p, self)) return p;
    const horiz = isHorizontal(self);
    let best = p;
    let bestD = reach;
    const spanPad = 0.2;
    for (const o of walls) {
      if (o.id === self.id) continue;
      if (horiz === isHorizontal(o)) continue;
      if (horiz) {
        const x = o.start[0];
        const y0 = Math.min(o.start[1], o.end[1]) - spanPad;
        const y1 = Math.max(o.start[1], o.end[1]) + spanPad;
        if (p[1] < y0 || p[1] > y1) continue;
        const d = Math.abs(p[0] - x);
        if (d <= reach && d < bestD) {
          bestD = d;
          best = [x, p[1]];
        }
      } else {
        const y = o.start[1];
        const x0 = Math.min(o.start[0], o.end[0]) - spanPad;
        const x1 = Math.max(o.start[0], o.end[0]) + spanPad;
        if (p[0] < x0 || p[0] > x1) continue;
        const d = Math.abs(p[1] - y);
        if (d <= reach && d < bestD) {
          bestD = d;
          best = [p[0], y];
        }
      }
    }
    return best;
  };

  return walls.map((w) => ({
    ...w,
    start: snapTip(w.start, w),
    end: snapTip(w.end, w),
  }));
}

/** If a T/L tip already sits on our axis just past the end, grow this wall to it. */
function growToCoverTips(walls: Wall[]): Wall[] {
  const next = walls.map((w) => ({
    ...w,
    start: [w.start[0], w.start[1]] as Vec2,
    end: [w.end[0], w.end[1]] as Vec2,
  }));
  const reach = 1.2;
  for (let i = 0; i < next.length; i++) {
    const w = next[i];
    const horiz = isHorizontal(w);
    for (const o of next) {
      if (o.id === w.id || isHorizontal(o) === horiz) continue;
      for (const p of [o.start, o.end]) {
        if (horiz) {
          if (Math.abs(p[1] - w.start[1]) > 0.04) continue;
          const lo = Math.min(w.start[0], w.end[0]);
          const hi = Math.max(w.start[0], w.end[0]);
          if (p[0] >= lo - 0.03 && p[0] <= hi + 0.03) continue;
          const toward = p[0] < lo ? lo - p[0] : p[0] - hi;
          if (toward > reach) continue;
          if (colinearHole(next, w, horiz, p[0] < lo ? "low" : "high")) continue;
          if (p[0] < lo) {
            if (w.start[0] <= w.end[0]) w.start = [p[0], w.start[1]];
            else w.end = [p[0], w.end[1]];
          } else if (p[0] > hi) {
            if (w.start[0] <= w.end[0]) w.end = [p[0], w.end[1]];
            else w.start = [p[0], w.start[1]];
          }
        } else {
          if (Math.abs(p[0] - w.start[0]) > 0.04) continue;
          const lo = Math.min(w.start[1], w.end[1]);
          const hi = Math.max(w.start[1], w.end[1]);
          if (p[1] >= lo - 0.03 && p[1] <= hi + 0.03) continue;
          const toward = p[1] < lo ? lo - p[1] : p[1] - hi;
          if (toward > reach) continue;
          if (colinearHole(next, w, horiz, p[1] < lo ? "low" : "high")) continue;
          if (p[1] < lo) {
            if (w.start[1] <= w.end[1]) w.start = [w.start[0], p[1]];
            else w.end = [w.end[0], p[1]];
          } else if (p[1] > hi) {
            if (w.start[1] <= w.end[1]) w.end = [w.end[0], p[1]];
            else w.start = [w.start[0], p[1]];
          }
        }
      }
    }
  }
  return next;
}

function colinearHole(
  walls: Wall[],
  self: Wall,
  horiz: boolean,
  side: "low" | "high",
): boolean {
  const a = horiz
    ? Math.min(self.start[0], self.end[0])
    : Math.min(self.start[1], self.end[1]);
  const b = horiz
    ? Math.max(self.start[0], self.end[0])
    : Math.max(self.start[1], self.end[1]);
  const pos = horiz ? self.start[1] : self.start[0];
  for (const o of walls) {
    if (o.id === self.id || isHorizontal(o) !== horiz) continue;
    const opos = horiz ? o.start[1] : o.start[0];
    if (Math.abs(opos - pos) > 0.12) continue;
    const oa = horiz
      ? Math.min(o.start[0], o.end[0])
      : Math.min(o.start[1], o.end[1]);
    const ob = horiz
      ? Math.max(o.start[0], o.end[0])
      : Math.max(o.start[1], o.end[1]);
    const gap = side === "high" ? oa - b : a - ob;
    if (gap >= 0.35 && gap <= 3.8) return true;
  }
  return false;
}

/**
 * 8 dangling ends are usually a rectangle whose corners miss by a few cm.
 * Pair each free horizontal tip with a free vertical tip and snap both to (vx, hy).
 */
function stitchCorners(walls: Wall[], reach: number): Wall[] {
  const next = walls.map((w) => ({
    ...w,
    start: [w.start[0], w.start[1]] as Vec2,
    end: [w.end[0], w.end[1]] as Vec2,
  }));

  const tips: { i: number; key: "start" | "end" }[] = [];
  for (let i = 0; i < next.length; i++) {
    for (const key of ["start", "end"] as const) {
      const p = next[i][key];
      const ok = next.some(
        (o, j) => j !== i && pointSeg(p, o.start, o.end) <= 0.03,
      );
      if (!ok) tips.push({ i, key });
    }
  }

  type Pair = {
    a: (typeof tips)[number];
    b: (typeof tips)[number];
    corner: Vec2;
    score: number;
  };
  const pairs: Pair[] = [];
  for (let u = 0; u < tips.length; u++) {
    for (let v = u + 1; v < tips.length; v++) {
      const a = tips[u];
      const b = tips[v];
      if (a.i === b.i) continue;
      const wa = next[a.i];
      const wb = next[b.i];
      if (isHorizontal(wa) === isHorizontal(wb)) continue;
      const pa = wa[a.key];
      const pb = wb[b.key];
      const vx = isHorizontal(wa) ? wb.start[0] : wa.start[0];
      const hy = isHorizontal(wa) ? wa.start[1] : wb.start[1];
      const corner: Vec2 = [vx, hy];
      const da = dist(pa, corner);
      const db = dist(pb, corner);
      if (da > reach || db > reach) continue;
      pairs.push({ a, b, corner, score: da + db });
    }
  }
  pairs.sort((x, y) => x.score - y.score);
  const used = new Set<string>();
  for (const pair of pairs) {
    const ka = `${pair.a.i}:${pair.a.key}`;
    const kb = `${pair.b.i}:${pair.b.key}`;
    if (used.has(ka) || used.has(kb)) continue;
    used.add(ka);
    used.add(kb);
    next[pair.a.i][pair.a.key] = pair.corner;
    next[pair.b.i][pair.b.key] = pair.corner;
  }
  return next;
}

function splitAtCrossings(walls: Wall[]): Wall[] {
  const result: Wall[] = [];
  for (const wall of walls) {
    const { ux, uy, length } = wallFrame(wall);
    const cuts: number[] = [0, length];
    const horiz = isHorizontal(wall);
    for (const other of walls) {
      if (other.id === wall.id || horiz === isHorizontal(other)) continue;
      const x = horiz ? other.start[0] : wall.start[0];
      const y = horiz ? wall.start[1] : other.start[1];
      const wx0 = Math.min(wall.start[0], wall.end[0]) - 0.02;
      const wx1 = Math.max(wall.start[0], wall.end[0]) + 0.02;
      const wy0 = Math.min(wall.start[1], wall.end[1]) - 0.02;
      const wy1 = Math.max(wall.start[1], wall.end[1]) + 0.02;
      const ox0 = Math.min(other.start[0], other.end[0]) - 0.02;
      const ox1 = Math.max(other.start[0], other.end[0]) + 0.02;
      const oy0 = Math.min(other.start[1], other.end[1]) - 0.02;
      const oy1 = Math.max(other.start[1], other.end[1]) + 0.02;
      if (x < wx0 || x > wx1 || y < wy0 || y > wy1) continue;
      if (x < ox0 || x > ox1 || y < oy0 || y > oy1) continue;
      const t = horiz
        ? (x - wall.start[0]) * Math.sign(wall.end[0] - wall.start[0] || 1)
        : (y - wall.start[1]) * Math.sign(wall.end[1] - wall.start[1] || 1);
      const along = horiz
        ? Math.abs(x - wall.start[0])
        : Math.abs(y - wall.start[1]);
      void t;
      if (along > 0.08 && along < length - 0.08) cuts.push(along);
    }
    cuts.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (const t of cuts) {
      if (uniq.length === 0 || t - uniq[uniq.length - 1] > 0.06) uniq.push(t);
    }
    const before = result.length;
    for (let i = 0; i < uniq.length - 1; i++) {
      const a = uniq[i];
      const b = uniq[i + 1];
      if (b - a < 0.08) continue;
      result.push({
        ...wall,
        id: `${wall.id}-x${i}`,
        start: [wall.start[0] + ux * a, wall.start[1] + uy * a],
        end: [wall.start[0] + ux * b, wall.start[1] + uy * b],
      });
    }
    if (result.length === before) result.push(wall);
  }
  return result.length ? result : walls;
}

function splitAtJunctions(walls: Wall[], snap: number): Wall[] {
  const result: Wall[] = [];
  for (const wall of walls) {
    const cuts: number[] = [0, wallFrame(wall).length];
    const { ux, uy, length } = wallFrame(wall);
    for (const other of walls) {
      if (other.id === wall.id) continue;
      for (const pt of [other.start, other.end]) {
        const vx = pt[0] - wall.start[0];
        const vy = pt[1] - wall.start[1];
        const t = vx * ux + vy * uy;
        if (t <= snap || t >= length - snap) continue;
        const proj: Vec2 = [wall.start[0] + ux * t, wall.start[1] + uy * t];
        if (dist(proj, pt) < snap * 1.5) cuts.push(t);
      }
    }
    cuts.sort((a, b) => a - b);
    const uniq: number[] = [];
    for (const t of cuts) {
      if (uniq.length === 0 || t - uniq[uniq.length - 1] > 0.04) uniq.push(t);
    }
    for (let i = 0; i < uniq.length - 1; i++) {
      const a = uniq[i];
      const b = uniq[i + 1];
      result.push({
        ...wall,
        id: `${wall.id}-${i}`,
        start: [wall.start[0] + ux * a, wall.start[1] + uy * a],
        end: [wall.start[0] + ux * b, wall.start[1] + uy * b],
      });
    }
  }
  return result;
}

function mergeColinear(walls: Wall[]): Wall[] {
  return walls;
}

/**
 * Lengthen a wall to the nearest orthogonal corner so a window/door at a
 * fragment end sits on the wall, and a T-stem has something to meet.
 */
export function padHostsToCorners(
  walls: Wall[],
  openings: Opening[],
): { walls: Wall[]; openings: Opening[] } {
  const reach = planReach(walls);
  const next = walls.map((w) => ({
    ...w,
    start: [w.start[0], w.start[1]] as Vec2,
    end: [w.end[0], w.end[1]] as Vec2,
  }));
  const startPad = new Map<string, number>();

  for (const w of next) {
    const horiz = isHorizontal(w);
    const { ux, uy } = wallFrame(w);
    let pad = 0;
    for (const key of ["start", "end"] as const) {
      const p = w[key];
      if (next.some((o) => o.id !== w.id && pointSeg(p, o.start, o.end) <= 0.03)) continue;
      let best: Vec2 | null = null;
      let bestD = reach;
      let mate: Wall | null = null;
      for (const o of next) {
        if (o.id === w.id || isHorizontal(o) === horiz) continue;
        const vx = horiz ? o.start[0] : w.start[0];
        const hy = horiz ? w.start[1] : o.start[1];
        const corner: Vec2 = [vx, hy];
        const d = dist(p, corner);
        if (d > bestD || d < 1e-4) continue;
        if (horiz && Math.abs(corner[1] - p[1]) > 0.08) continue;
        if (!horiz && Math.abs(corner[0] - p[0]) > 0.08) continue;
        bestD = d;
        best = corner;
        mate = o;
      }
      if (!best || !mate) continue;
      const along =
        (best[0] - w.start[0]) * ux + (best[1] - w.start[1]) * uy;
      const len = wallFrame(w).length;
      let moved = false;
      if (key === "start" && along < -0.02) {
        pad += -along;
        w.start = best;
        moved = true;
      } else if (key === "end" && along > len + 0.02) {
        w.end = best;
        moved = true;
      }
      if (!moved) continue;
      if (pointSeg(best, mate.start, mate.end) > 0.03) {
        const useStart = dist(mate.start, best) <= dist(mate.end, best);
        if (dist(useStart ? mate.end : mate.start, best) > 0.08) {
          if (useStart) mate.start = best;
          else mate.end = best;
        }
      }
    }
    if (pad > 0.02) startPad.set(w.id, pad);
  }

  const shifted = openings.map((o) => {
    const pad = startPad.get(o.wallId);
    return pad ? { ...o, offset: o.offset + pad } : o;
  });
  return {
    walls: next.filter((w) => dist(w.start, w.end) > 0.08),
    openings: shifted,
  };
}

/**
 * Snap free wall tips onto a host at a door/window jamb so partitions
 * meet the window wall as T-junctions instead of stopping in the opening.
 */
export function joinOpeningJambs(walls: Wall[], openings: Opening[]): Wall[] {
  if (openings.length === 0) return walls;
  const next = walls.map((w) => ({
    ...w,
    start: [w.start[0], w.start[1]] as Vec2,
    end: [w.end[0], w.end[1]] as Vec2,
  }));

  const jambs: { host: number; p: Vec2 }[] = [];
  for (const opening of openings) {
    const hi = next.findIndex((w) => w.id === opening.wallId);
    if (hi < 0) continue;
    const host = next[hi];
    const { ux, uy } = wallFrame(host);
    jambs.push({
      host: hi,
      p: [
        host.start[0] + ux * opening.offset,
        host.start[1] + uy * opening.offset,
      ],
    });
    jambs.push({
      host: hi,
      p: [
        host.start[0] + ux * (opening.offset + opening.width),
        host.start[1] + uy * (opening.offset + opening.width),
      ],
    });
    jambs.push({
      host: hi,
      p: [
        host.start[0] + ux * (opening.offset + opening.width / 2),
        host.start[1] + uy * (opening.offset + opening.width / 2),
      ],
    });
  }

  for (let i = 0; i < next.length; i++) {
    const wall = next[i];
    for (const key of ["start", "end"] as const) {
      const p = wall[key];
      if (next.some((o, j) => j !== i && pointSeg(p, o.start, o.end) <= 0.03)) continue;
      let best: Vec2 | null = null;
      let bestD = 1.6;
      let hostI = -1;
      for (const jamb of jambs) {
        if (jamb.host === i) continue;
        const host = next[jamb.host];
        if (isHorizontal(wall) === isHorizontal(host)) continue;
        const vx = isHorizontal(wall) ? host.start[0] : wall.start[0];
        const hy = isHorizontal(wall) ? wall.start[1] : host.start[1];
        const corner: Vec2 = [vx, hy];
        const d = Math.min(dist(p, jamb.p), dist(p, corner) + dist(corner, jamb.p) * 0.25);
        if (dist(corner, jamb.p) > 2.2) continue;
        if (d < bestD) {
          bestD = d;
          best = corner;
          hostI = jamb.host;
        }
      }
      if (!best || hostI < 0) continue;
      wall[key] = best;
    }
  }
  return next;
}

export function spaceArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return Math.abs(a) / 2;
}
