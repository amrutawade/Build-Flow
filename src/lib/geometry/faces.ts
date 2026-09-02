import type { Space, Vec2, Wall } from "../models";

function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return a / 2;
}

function vertKey(p: Vec2): string {
  return `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
}

/** Closed rooms from wall centerlines (planar graph faces). Geometry only. */
export function spacesFromWalls(walls: Wall[]): Space[] {
  type Vert = { p: Vec2; outs: number[] };
  const verts: Vert[] = [];
  const index = new Map<string, number>();

  const vert = (p: Vec2): number => {
    const k = vertKey(p);
    const hit = index.get(k);
    if (hit !== undefined) return hit;
    const i = verts.length;
    index.set(k, i);
    verts.push({ p: [p[0], p[1]], outs: [] });
    return i;
  };

  for (const wall of walls) {
    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    if (len < 0.08) continue;
    const a = vert(wall.start);
    const b = vert(wall.end);
    if (a === b) continue;
    verts[a].outs.push(b);
    verts[b].outs.push(a);
  }

  const heading = (i: number, j: number) =>
    Math.atan2(verts[j].p[1] - verts[i].p[1], verts[j].p[0] - verts[i].p[0]);

  const pickNext = (curr: number, prev: number): number | null => {
    const inH = heading(prev, curr);
    let bestTo: number | null = null;
    let bestTurn = -Infinity;
    const outs = verts[curr].outs;
    for (const to of outs) {
      if (to === prev && outs.length > 1) continue;
      const outH = heading(curr, to);
      let turn = outH - inH;
      while (turn <= -Math.PI) turn += 2 * Math.PI;
      while (turn > Math.PI) turn -= 2 * Math.PI;
      if (turn > bestTurn + 1e-9) {
        bestTurn = turn;
        bestTo = to;
      }
    }
    return bestTo;
  };

  const used = new Set<string>();
  const rooms: Vec2[][] = [];

  for (let i = 0; i < verts.length; i++) {
    for (const to of verts[i].outs) {
      const startKey = `${i}>${to}`;
      if (used.has(startKey)) continue;
      const ids = [i];
      let prev = i;
      let curr = to;
      used.add(startKey);
      let guard = 0;
      let closed = false;
      while (guard++ < 400) {
        ids.push(curr);
        if (curr === i && ids.length >= 4) {
          closed = true;
          break;
        }
        const next = pickNext(curr, prev);
        if (next === null) break;
        const k = `${curr}>${next}`;
        if (used.has(k)) break;
        used.add(k);
        prev = curr;
        curr = next;
      }
      if (!closed || ids.length < 4) continue;
      const poly = ids.slice(0, -1).map((id) => verts[id].p);
      const area = signedArea(poly);
      if (area < 1.2) continue;
      rooms.push(poly);
    }
  }

  rooms.sort((a, b) => signedArea(a) - signedArea(b));
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
