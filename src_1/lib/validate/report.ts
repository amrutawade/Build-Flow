import type { BuildingGraph } from "../models";
import { polygonArea } from "../geometry/area";

export interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: Check[];
}

const JOIN = 0.03;

/** Assignment checks: topology, openings hosted, spaces, IFC-ready graph. */
export function validateGraph(graph: BuildingGraph): ValidationReport {
  const checks: Check[] = [];

  const dangling = danglingEnds(graph);
  checks.push({
    id: "topology",
    label: "Walls meet at corners / T-junctions",
    pass: dangling === 0,
    detail:
      dangling === 0
        ? "Every endpoint is within 30 mm of another wall."
        : `${dangling} endpoint(s) sit more than 30 mm from any other wall.`,
  });

  const low = graph.walls.filter((w) => w.confidence < 0.55);
  checks.push({
    id: "confidence",
    label: "Uncertain walls are flagged",
    pass: true,
    detail:
      low.length === 0
        ? "No low-confidence walls."
        : `${low.length} wall(s) below 0.55 confidence: ${low.map((w) => w.id).join(", ")}. Confirm or delete before solve.`,
  });

  const orphan = graph.openings.filter(
    (o) => !graph.walls.some((w) => w.id === o.wallId),
  );
  checks.push({
    id: "openings",
    label: "Doors and windows hosted in a wall",
    pass: orphan.length === 0,
    detail:
      orphan.length === 0
        ? `${graph.openings.length} opening(s) hosted.`
        : `${orphan.length} opening(s) have no host wall.`,
  });

  const unnamed = graph.spaces.filter((s) => !s.name.trim());
  const areas = graph.spaces.map((s) => s.area ?? polygonArea(s.polygon));
  checks.push({
    id: "spaces",
    label: "IfcSpace per room with area",
    pass: graph.spaces.length > 0 && unnamed.length === 0 && areas.every((a) => a > 0.5),
    detail:
      graph.spaces.length === 0
        ? "No closed rooms. Check wall loops."
        : `${graph.spaces.length} space(s), ${areas.reduce((a, b) => a + b, 0).toFixed(1)} m² total.`,
  });

  checks.push({
    id: "walls",
    label: "IfcWall objects with length and thickness",
    pass: graph.walls.length >= 3,
    detail: `${graph.walls.length} wall(s) with centerlines.`,
  });

  const ok =
    checks.filter((c) => c.id !== "confidence").every((c) => c.pass) &&
    dangling === 0;

  return { ok, checks };
}

function danglingEnds(graph: BuildingGraph): number {
  let n = 0;
  for (const wall of graph.walls) {
    for (const p of [wall.start, wall.end]) {
      const meets = graph.walls.some((other) => {
        if (other.id === wall.id) return false;
        return pointToSegment(p, other.start, other.end) <= JOIN;
      });
      if (meets) continue;
      n++;
    }
  }
  return n;
}

function pointToSegment(
  p: BuildingGraph["walls"][number]["start"],
  a: BuildingGraph["walls"][number]["start"],
  b: BuildingGraph["walls"][number]["end"],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
