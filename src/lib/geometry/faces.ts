import type { Space, Vec2, Wall } from "../models";

function signedArea(poly: Vec2[]): number {
  let a = 0;

  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;

    a +=
      poly[i][0] * poly[j][1] -
      poly[j][0] * poly[i][1];
  }

  return a / 2;
}

function vertKey(p: Vec2): string {
  return `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
}

/**
 * Closed rooms from wall centerlines.
 *
 * Uses a planar half-edge walk to recover bounded faces.
 */
export function spacesFromWalls(walls: Wall[]): Space[] {
  type Vert = {
    p: Vec2;
    outs: number[];
  };

  const verts: Vert[] = [];
  const index = new Map<string, number>();

  const vert = (p: Vec2): number => {
    const key = vertKey(p);

    const existing = index.get(key);

    if (existing !== undefined) {
      return existing;
    }

    const id = verts.length;

    index.set(key, id);

    verts.push({
      p: [p[0], p[1]],
      outs: [],
    });

    return id;
  };

  // Prevent duplicate graph edges.
  const edges = new Set<string>();

  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0];
    const dy = wall.end[1] - wall.start[1];

    const len = Math.hypot(dx, dy);

    if (len < 0.08) continue;

    const a = vert(wall.start);
    const b = vert(wall.end);

    if (a === b) continue;

    const edgeKey =
      a < b
        ? `${a}:${b}`
        : `${b}:${a}`;

    if (edges.has(edgeKey)) continue;

    edges.add(edgeKey);

    verts[a].outs.push(b);
    verts[b].outs.push(a);
  }

  const heading = (from: number, to: number): number => {
    return Math.atan2(
      verts[to].p[1] - verts[from].p[1],
      verts[to].p[0] - verts[from].p[0],
    );
  };

  const normalizeAngle = (angle: number): number => {
    while (angle <= -Math.PI) {
      angle += 2 * Math.PI;
    }

    while (angle > Math.PI) {
      angle -= 2 * Math.PI;
    }

    return angle;
  };

  /**
   * Walk the face on the left side of the directed edge.
   *
   * At a vertex, choose the outgoing edge immediately
   * clockwise from the reverse incoming direction.
   */
  const pickNext = (
    prev: number,
    curr: number,
  ): number | null => {
    const incoming = heading(curr, prev);

    let best: number | null = null;
    let bestDelta = Infinity;

    for (const to of verts[curr].outs) {
      if (to === prev) continue;

      const out = heading(curr, to);

      let delta = normalizeAngle(out - incoming);

      // Convert to clockwise turn.
      if (delta <= 0) {
        delta += 2 * Math.PI;
      }

      if (delta < bestDelta) {
        bestDelta = delta;
        best = to;
      }
    }

    // Dead end.
    if (best === null) {
      return prev;
    }

    return best;
  };

  const used = new Set<string>();
  const rooms: Vec2[][] = [];

  for (let start = 0; start < verts.length; start++) {
    for (const first of verts[start].outs) {
      const startEdge = `${start}>${first}`;

      if (used.has(startEdge)) {
        continue;
      }

      const ids: number[] = [start];

      let prev = start;
      let curr = first;

      let closed = false;

      for (let guard = 0; guard < 400; guard++) {
        const edge = `${prev}>${curr}`;

        if (used.has(edge)) {
          if (curr === start) {
            closed = true;
          }

          break;
        }

        used.add(edge);
        ids.push(curr);

        if (curr === start) {
          closed = ids.length >= 4;
          break;
        }

        const next = pickNext(prev, curr);

        if (next === null) {
          break;
        }

        prev = curr;
        curr = next;
      }

      if (!closed || ids.length < 4) {
        continue;
      }

      const polygon = ids
        .slice(0, -1)
        .map((id) => verts[id].p);

      const area = signedArea(polygon);

      // Keep only counter-clockwise bounded faces.
      if (area < 1.2) {
        continue;
      }

      rooms.push(polygon);
    }
  }

  rooms.sort(
    (a, b) => signedArea(a) - signedArea(b),
  );

  return rooms.map((polygon, n) => ({
    id: `SP-${n}`,
    name: guessName(signedArea(polygon)),
    polygon,
    confidence: 0.75,
  }));
}

function guessName(area: number): string {
  if (area < 3.5) return "Toilet / Bath";
  if (area < 7) return "Kitchen / Utility";
  if (area < 12) return "Bedroom";

  return "Living / Dining";
}