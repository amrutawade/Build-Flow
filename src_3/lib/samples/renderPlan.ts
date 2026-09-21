import sharp from "sharp";
import type { BuildingGraph } from "../models";
import { sampleTwoBhk } from "../samples/twoBhk";
import { polygonArea } from "../geometry/area";
import { wallFrame } from "../geometry/frame";
import { wallPlanRuns } from "../geometry/wallBoxes";

export const PLAN_PPM = 40;
export const PLAN_MARGIN = 40;

export function sampleSvg(graph: BuildingGraph = sampleTwoBhk()): {
  svg: string;
  width: number;
  height: number;
  metersPerPixel: number;
} {
  const xs = graph.walls.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = graph.walls.flatMap((w) => [w.start[1], w.end[1]]);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const width = Math.round(maxX * PLAN_PPM + PLAN_MARGIN * 2);
  const height = Math.round(maxY * PLAN_PPM + PLAN_MARGIN * 2);

  const tx = (x: number) => PLAN_MARGIN + x * PLAN_PPM;
  const ty = (y: number) => height - (PLAN_MARGIN + y * PLAN_PPM);

  const wallLines = graph.walls
    .flatMap((w) => {
      const { ux, uy } = wallFrame(w);
      const stroke = w.kind === "external" ? 10 : 6;
      return wallPlanRuns(w, graph.openings).map((run, i) => {
        const x1 = w.start[0] + ux * run.x0;
        const y1 = w.start[1] + uy * run.x0;
        const x2 = w.start[0] + ux * run.x1;
        const y2 = w.start[1] + uy * run.x1;
        return `<line x1="${tx(x1)}" y1="${ty(y1)}" x2="${tx(x2)}" y2="${ty(y2)}" stroke="#111" stroke-width="${stroke}" stroke-linecap="square" data-wall="${w.id}-${i}"/>`;
      });
    })
    .join("\n");

  const openingMarks = graph.openings
    .map((o) => {
      const wall = graph.walls.find((w) => w.id === o.wallId);
      if (!wall) return "";
      const { ux, uy } = wallFrame(wall);
      const x0 = wall.start[0] + ux * o.offset;
      const y0 = wall.start[1] + uy * o.offset;
      const x1 = wall.start[0] + ux * (o.offset + o.width);
      const y1 = wall.start[1] + uy * (o.offset + o.width);
      const nx = -uy;
      const ny = ux;
      if (o.type === "door") {
        const swing = 0.85;
        const c = Math.cos(swing);
        const s = Math.sin(swing);
        const lx = ux * o.width;
        const ly = uy * o.width;
        const ex = x0 + lx * c - (nx * o.width) * s;
        const ey = y0 + ly * c - (ny * o.width) * s;
        return `<path d="M ${tx(x0)} ${ty(y0)} L ${tx(ex)} ${ty(ey)}" stroke="#9a8a78" stroke-width="2.5" fill="none"/>
        <path d="M ${tx(x0)} ${ty(y0)} A ${o.width * PLAN_PPM} ${o.width * PLAN_PPM} 0 0 0 ${tx(x1)} ${ty(y1)}" stroke="#9a8a78" stroke-width="1.4" fill="none"/>`;
      }
      const ox = nx * wall.thickness * 0.4;
      const oy = ny * wall.thickness * 0.4;
      const pane = (along0: number, along1: number) => {
        const ax = wall.start[0] + ux * along0;
        const ay = wall.start[1] + uy * along0;
        const bx = wall.start[0] + ux * along1;
        const by = wall.start[1] + uy * along1;
        const pts = [
          [tx(ax + ox), ty(ay + oy)],
          [tx(bx + ox), ty(by + oy)],
          [tx(bx - ox), ty(by - oy)],
          [tx(ax - ox), ty(ay - oy)],
        ]
          .map((p) => p.join(","))
          .join(" ");
        return `<polygon points="${pts}" fill="none" stroke="#2a6a8a" stroke-width="2"/>`;
      };
      const panes = o.width >= 1.35 ? 3 : 2;
      const marks: string[] = [];
      for (let p = 0; p < panes; p++) {
        marks.push(
          pane(
            o.offset + (o.width * p) / panes,
            o.offset + (o.width * (p + 1)) / panes,
          ),
        );
      }
      return marks.join("");
    })
    .join("\n");

  const labels = graph.spaces
    .map((s) => {
      const cx = s.polygon.reduce((a, p) => a + p[0], 0) / s.polygon.length;
      const cy = s.polygon.reduce((a, p) => a + p[1], 0) / s.polygon.length;
      const area = polygonArea(s.polygon).toFixed(1);
      return `<text x="${tx(cx)}" y="${ty(cy)}" text-anchor="middle" font-family="Arial" font-size="14" fill="#333">${escapeXml(s.name)}</text>
      <text x="${tx(cx)}" y="${ty(cy) + 16}" text-anchor="middle" font-family="Arial" font-size="11" fill="#666">${area} m²</text>`;
    })
    .join("\n");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f7f4ec"/>
  ${wallLines}
  ${openingMarks}
  ${labels}
</svg>`;

  return { svg, width, height, metersPerPixel: 1 / PLAN_PPM };
}

export async function samplePng(
  graph: BuildingGraph = sampleTwoBhk(),
): Promise<Buffer> {
  const { svg } = sampleSvg(graph);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}
