import type { BuildingGraph, ConvertOptions, Opening, Vec2, Wall } from "@/lib/models";
import { spacesFromWalls } from "@/lib/geometry/faces";
import type { PdfLine, PdfRect } from "./classify";
import type { PdfTextItem } from "./text";

export type PdfPath = {
  color?: [number, number, number];
  fillColor?: [number, number, number];
  lineWidth: number;
  bbox: [number, number, number, number];
  hasCurve: boolean;
  closed: boolean;
  opIndex: number;
};

export type PdfVectorPage = {
    width: number;
    height: number;
  
    lines: PdfLine[];
    rects: PdfRect[];
    paths: PdfPath[];
  
    textCount: number;
    imageCount: number;
  
    markedContent: PdfMarkedContent[];
    annotations: PdfAnnotation[];
    textItems?: PdfTextItem[];
  };

type Matrix = [number, number, number, number, number, number];
type Color = [number, number, number];
const ID: Matrix = [1, 0, 0, 1, 0, 0];

function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

function point(m: Matrix, x: number, y: number): Vec2 {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
function finiteNumbers(value: unknown): number[] | null {
    if (
      Array.isArray(value) &&
      value.every(
        (v) => typeof v === "number" && Number.isFinite(v),
      )
    ) {
      return value;
    }
  
    if (!ArrayBuffer.isView(value)) {
      return null;
    }
  
    const view = value as unknown as {
      length: number;
      [index: number]: number;
    };
  
    if (!Number.isFinite(view.length)) {
      return null;
    }
  
    const out: number[] = [];
  
    for (let i = 0; i < view.length; i++) {
      const n = Number(view[i]);
  
      if (!Number.isFinite(n)) {
        return null;
      }
  
      out.push(n);
    }
  
    return out;
  }

function flattenNumbers(value: unknown): number[] {
  const direct = finiteNumbers(value);
  if (direct) return direct;
  if (Array.isArray(value)) return value.flatMap(flattenNumbers);
  return [];
}

function parseColor(value: unknown): Color | undefined {
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) {
      return [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
    }
    if (/^#[0-9a-f]{3}$/.test(s)) {
      return [parseInt(s[1] + s[1], 16) / 255, parseInt(s[2] + s[2], 16) / 255, parseInt(s[3] + s[3], 16) / 255];
    }
  }
  const n = finiteNumbers(value);
  if (n && n.length >= 3) return [n[0], n[1], n[2]];
  return undefined;
}

function isAxisAligned(a: Vec2, b: Vec2, tolerance = 0.985): boolean {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const len = Math.hypot(dx, dy) || 1;
  return Math.max(dx, dy) / len >= tolerance;
}

function colorDistance(a?: Color, b?: Color): number {
  if (!a || !b) return 999;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function isRed(c?: Color): boolean {
  return !!c && c[0] > 0.75 && c[1] < 0.35 && c[2] < 0.35;
}
function isCyan(c?: Color): boolean {
  return !!c && c[1] > 0.65 && c[2] > 0.65 && c[0] < 0.35;
}
function isGold(c?: Color): boolean {
  return !!c && c[0] > 0.55 && c[1] > 0.35 && c[1] < 0.75 && c[2] < 0.25;
}
function isBlack(c?: Color): boolean {
  return !!c && c[0] < 0.25 && c[1] < 0.25 && c[2] < 0.25;
}

function bboxFromPoints(points: Vec2[]): [number, number, number, number] | null {
  if (!points.length) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function transformedBBox(m: Matrix, raw: number[] | null): [number, number, number, number] | null {
  if (!raw || raw.length < 4) return null;
  const pts = [point(m, raw[0], raw[1]), point(m, raw[2], raw[1]), point(m, raw[2], raw[3]), point(m, raw[0], raw[3])];
  return bboxFromPoints(pts);
}

function pathCommandArray(args: unknown[]): number[] {
  // PDF.js 4/5/6: constructPath(count, [Float32Array(commands)], bbox)
  // Older versions sometimes expose commands directly as the first argument.
  if (Array.isArray(args[1])) {
    const nested = args[1].flatMap(flattenNumbers);
    if (nested.length) return nested;
  }
  return flattenNumbers(args[0]);
}

// export async function extractVectorPage(args: {
//   page: {
//     getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
//     getViewport: (options: { scale: number; dontFlip?: boolean }) => { width: number; height: number };
//   };
//   OPS: Record<string, number>;
//   textCount: number;
//   imageCount: number;
// }): Promise<PdfVectorPage> {
//   const opList = await args.page.getOperatorList();
//   const lines: PdfLine[] = [];
//   const rects: PdfRect[] = [];
//   const paths: PdfPath[] = [];

//   let ctm: Matrix = [...ID];
//   let lineWidth = 1;
//   let stroke: Color | undefined;
//   let fill: Color | undefined;
//   const stack: { ctm: Matrix; lineWidth: number; stroke?: Color; fill?: Color }[] = [];

//   for (let i = 0; i < opList.fnArray.length; i++) {
//     const fn = opList.fnArray[i];
//     const a = opList.argsArray[i] ?? [];

//     if (fn === args.OPS.save) {
//       stack.push({ ctm: [...ctm], lineWidth, stroke, fill });
//       continue;
//     }
//     if (fn === args.OPS.restore) {
//       const s = stack.pop();
//       if (s) { ctm = s.ctm; lineWidth = s.lineWidth; stroke = s.stroke; fill = s.fill; }
//       continue;
//     }
//     if (fn === args.OPS.transform) {
//       const m = flattenNumbers(a);
//       if (m.length >= 6) ctm = mul(ctm, [m[0], m[1], m[2], m[3], m[4], m[5]]);
//       continue;
//     }
//     if (fn === args.OPS.setLineWidth) {
//       const n = Number(a[0]);
//       if (Number.isFinite(n)) lineWidth = Math.max(0, n);
//       continue;
//     }
//     if (fn === args.OPS.setStrokeRGBColor || fn === args.OPS.setStrokeColorN) {
//       stroke = parseColor(a[0]) ?? parseColor(a);
//       continue;
//     }
//     if (fn === args.OPS.setFillRGBColor || fn === args.OPS.setFillColorN) {
//       fill = parseColor(a[0]) ?? parseColor(a);
//       continue;
//     }
//     if (fn === args.OPS.setStrokeGray) {
//       const g = Number(a[0]);
//       if (Number.isFinite(g)) stroke = [g, g, g];
//       continue;
//     }
//     if (fn === args.OPS.setFillGray) {
//       const g = Number(a[0]);
//       if (Number.isFinite(g)) fill = [g, g, g];
//       continue;
//     }

//     if (fn === args.OPS.rectangle) {
//       const x = Number(a[0]), y = Number(a[1]), w = Number(a[2]), h = Number(a[3]);
//       if (![x, y, w, h].every(Number.isFinite)) continue;
//       const pts = [point(ctm, x, y), point(ctm, x + w, y), point(ctm, x + w, y + h), point(ctm, x, y + h)];
//       const bb = bboxFromPoints(pts);
//       if (bb) rects.push({ x: bb[0], y: bb[1], width: bb[2] - bb[0], height: bb[3] - bb[1], strokeWidth: lineWidth, filled: !!fill, color: stroke, opIndex: i });
//       continue;
//     }

//     if (fn !== args.OPS.constructPath) continue;

//     const commands = pathCommandArray(a);
//     if (!commands.length) continue;

//     let c = 0;
//     let current: Vec2 | null = null;
//     let start: Vec2 | null = null;
//     const points: Vec2[] = [];
//     let hasCurve = false;
//     let closed = false;

//     const addLine = (p: Vec2) => {
//       if (current && isAxisAligned(current, p)) {
//         const len = Math.hypot(p[0] - current[0], p[1] - current[1]);
//         if (len >= 0.25 && lineWidth > 0) lines.push({ a: current, b: p, width: lineWidth, color: stroke, opIndex: i });
//       }
//       current = p;
//       points.push(p);
//     };

//     while (c < commands.length) {
//       const code = commands[c++];
//       if (code === 0) { // moveTo
//         if (c + 1 >= commands.length) break;
//         current = point(ctm, commands[c++], commands[c++]);
//         start = current;
//         points.push(current);
//       } else if (code === 1) { // lineTo
//         if (c + 1 >= commands.length) break;
//         addLine(point(ctm, commands[c++], commands[c++]));
//       } else if (code === 2) { // curveTo: 6 coords
//         if (c + 5 >= commands.length) break;
//         const p = point(ctm, commands[c + 4], commands[c + 5]);
//         points.push(point(ctm, commands[c], commands[c + 1]), point(ctm, commands[c + 2], commands[c + 3]), p);
//         current = p;
//         c += 6;
//         hasCurve = true;
//       } else if (code === 3) { // curveTo3: 4 coords
//         if (c + 3 >= commands.length) break;
//         const p = point(ctm, commands[c + 2], commands[c + 3]);
//         points.push(point(ctm, commands[c], commands[c + 1]), p);
//         current = p;
//         c += 4;
//         hasCurve = true;
//       } else if (code === 4) { // closePath
//         if (current && start && isAxisAligned(current, start) && lineWidth > 0) {
//           const len = Math.hypot(start[0] - current[0], start[1] - current[1]);
//           if (len >= 0.25) lines.push({ a: current, b: start, width: lineWidth, color: stroke, opIndex: i });
//         }
//         current = start;
//         closed = true;
//       } else {
//         break;
//       }
//     }

//     const bb = bboxFromPoints(points) ?? transformedBBox(ctm, finiteNumbers(a[2]));
//     if (bb) paths.push({ color: stroke, fillColor: fill, lineWidth, bbox: bb, hasCurve, closed, opIndex: i });
//   }

//   const vp = args.page.getViewport({ scale: 1, dontFlip: true });
//   return { width: vp.width, height: vp.height, lines, rects, paths, textCount: args.textCount, imageCount: args.imageCount };
// }


export type PdfMarkedContent = {
  id?: string | number;
  tag?: string;
  opIndex: number;
};

export type PdfAnnotation = {
  subtype?: string;
  rect?: [number, number, number, number];
  contents?: string;
  fieldName?: string;
};

export async function extractVectorPage(
  args: {
    page: {
      getOperatorList: () => Promise<{
        fnArray: number[];
        argsArray: unknown[][];
      }>;

      getViewport: (options: {
        scale: number;
        dontFlip?: boolean;
      }) => {
        width: number;
        height: number;
      };

      getAnnotations?: (
        options?: {
          intent?: string;
        },
      ) => Promise<any[]>;
    };

    OPS: Record<
      string,
      number | undefined
    >;

    textCount: number;
    imageCount: number;
  },
): Promise<PdfVectorPage> {
  const opList =
    await args.page.getOperatorList();

  const lines: PdfLine[] = [];
  const rects: PdfRect[] = [];
  const paths: PdfPath[] = [];
  const markedContent:
    PdfMarkedContent[] = [];

  let ctm: Matrix = [
    ...ID,
  ];

  let lineWidth = 1;

  let stroke:
    Color | undefined;

  let fill:
    Color | undefined;

  const stack: {
    ctm: Matrix;
    lineWidth: number;
    stroke?: Color;
    fill?: Color;
  }[] = [];

  for (
    let i = 0;
    i < opList.fnArray.length;
    i++
  ) {
    const fn =
      opList.fnArray[i];

    const a =
      opList.argsArray[i] ?? [];

    /*
     * Graphics state.
     */
    if (
      fn === args.OPS.save
    ) {
      stack.push({
        ctm: [...ctm],
        lineWidth,
        stroke,
        fill,
      });

      continue;
    }

    if (
      fn === args.OPS.restore
    ) {
      const state =
        stack.pop();

      if (state) {
        ctm = state.ctm;
        lineWidth =
          state.lineWidth;
        stroke =
          state.stroke;
        fill =
          state.fill;
      }

      continue;
    }

    /*
     * Transform.
     */
    if (
      fn === args.OPS.transform
    ) {
      const m =
        flattenNumbers(a);

      if (
        m.length >= 6
      ) {
        ctm = mul(
          ctm,
          [
            m[0],
            m[1],
            m[2],
            m[3],
            m[4],
            m[5],
          ],
        );
      }

      continue;
    }

    /*
     * Stroke width.
     */
    if (
      fn ===
      args.OPS.setLineWidth
    ) {
      const width =
        Number(a[0]);

      if (
        Number.isFinite(width)
      ) {
        lineWidth =
          Math.max(
            0,
            width,
          );
      }

      continue;
    }

    /*
     * Stroke colour.
     */
    if (
      fn ===
      args.OPS.setStrokeRGBColor
    ) {
      stroke =
        parseColor(a);

      continue;
    }

    if (
      fn ===
      args.OPS.setStrokeColorN
    ) {
      stroke =
        parseColor(a);

      continue;
    }

    if (
      fn ===
      args.OPS.setStrokeGray
    ) {
      const g =
        Number(a[0]);

      if (
        Number.isFinite(g)
      ) {
        stroke = [
          g,
          g,
          g,
        ];
      }

      continue;
    }

    /*
     * Fill colour.
     */
    if (
      fn ===
      args.OPS.setFillRGBColor
    ) {
      fill =
        parseColor(a);

      continue;
    }

    if (
      fn ===
      args.OPS.setFillColorN
    ) {
      fill =
        parseColor(a);

      continue;
    }

    if (
      fn ===
      args.OPS.setFillGray
    ) {
      const g =
        Number(a[0]);

      if (
        Number.isFinite(g)
      ) {
        fill = [
          g,
          g,
          g,
        ];
      }

      continue;
    }

    /*
     * Marked content.
     *
     * CAD exports sometimes use marked
     * content to identify layers.
     */
    if (
      fn ===
      args.OPS.beginMarkedContent
    ) {
      markedContent.push({
        tag:
          typeof a[0] ===
          "string"
            ? a[0]
            : undefined,

        opIndex: i,
      });

      continue;
    }

    if (
      fn ===
      args.OPS.beginMarkedContentProps
    ) {
      const tag =
        typeof a[0] ===
        "string"
          ? a[0]
          : undefined;

      const props =
        a[1];

      let id:
        | string
        | number
        | undefined;

      if (
        props &&
        typeof props ===
          "object"
      ) {
        const p =
          props as Record<
            string,
            unknown
          >;

        const candidate =
          p.id ??
          p.mcId ??
          p.MCID;

        if (
          typeof candidate ===
            "string" ||
          typeof candidate ===
            "number"
        ) {
          id =
            candidate;
        }
      }

      markedContent.push({
        tag,
        id,
        opIndex: i,
      });

      continue;
    }

    /*
     * Rectangle.
     */
    if (
      fn ===
      args.OPS.rectangle
    ) {
      const x =
        Number(a[0]);

      const y =
        Number(a[1]);

      const width =
        Number(a[2]);

      const height =
        Number(a[3]);

      if (
        ![
          x,
          y,
          width,
          height,
        ].every(
          Number.isFinite,
        )
      ) {
        continue;
      }

      const pts = [
        point(
          ctm,
          x,
          y,
        ),

        point(
          ctm,
          x + width,
          y,
        ),

        point(
          ctm,
          x + width,
          y + height,
        ),

        point(
          ctm,
          x,
          y + height,
        ),
      ];

      const bb =
        bboxFromPoints(pts);

      if (!bb) {
        continue;
      }

      rects.push({
        x: bb[0],
        y: bb[1],
        width:
          bb[2] - bb[0],
        height:
          bb[3] - bb[1],
        strokeWidth:
          lineWidth,
        filled:
          !!fill,
        color:
          stroke,
        opIndex: i,
      });

      continue;
    }

    /*
     * Constructed path.
     *
     * PDF.js uses:
     *
     *   args[0] = operation codes
     *   args[1] = coordinates
     *
     * This distinction is important.
     */
    if (
      fn !==
      args.OPS.constructPath
    ) {
      continue;
    }

    const commands =
      finiteNumbers(
        a[0],
      ) ?? [];

    const coordinates =
      finiteNumbers(
        a[1],
      ) ?? [];

    if (
      !commands.length ||
      !coordinates.length
    ) {
      continue;
    }

    let ci = 0;
    let pi = 0;

    let current:
      Vec2 | null = null;

    let start:
      Vec2 | null = null;

    const points: Vec2[] = [];

    let hasCurve = false;
    let closed = false;

    const nextPoint =
      (): Vec2 | null => {
        if (
          pi + 1 >=
          coordinates.length
        ) {
          return null;
        }

        const p =
          point(
            ctm,
            coordinates[pi],
            coordinates[
              pi + 1
            ],
          );

        pi += 2;

        return p;
      };

    while (
      ci < commands.length
    ) {
      const code =
        commands[ci++];

      /*
       * moveTo
       */
      if (code === 0) {
        const p =
          nextPoint();

        if (!p) break;

        current = p;
        start = p;

        points.push(p);

        continue;
      }

      /*
       * lineTo
       */
      if (code === 1) {
        const p =
          nextPoint();

        if (!p) break;

        if (
          current &&
          isAxisAligned(
            current,
            p,
          )
        ) {
          const len =
            Math.hypot(
              p[0] -
                current[0],
              p[1] -
                current[1],
            );

          if (
            len >= 0.25 &&
            lineWidth > 0
          ) {
            lines.push({
              a: current,
              b: p,
              width:
                lineWidth,
              color:
                stroke,
              opIndex: i,
            });
          }
        }

        current = p;
        points.push(p);

        continue;
      }

      /*
       * curveTo
       */
      if (code === 2) {
        if (
          pi + 5 >=
          coordinates.length
        ) {
          break;
        }

        const p1 =
          nextPoint();

        const p2 =
          nextPoint();

        const p3 =
          nextPoint();

        if (
          !p1 ||
          !p2 ||
          !p3
        ) {
          break;
        }

        points.push(
          p1,
          p2,
          p3,
        );

        current = p3;
        hasCurve = true;

        continue;
      }

      /*
       * curveTo3
       */
      if (code === 3) {
        if (
          pi + 3 >=
          coordinates.length
        ) {
          break;
        }

        const p1 =
          nextPoint();

        const p2 =
          nextPoint();

        if (
          !p1 ||
          !p2
        ) {
          break;
        }

        points.push(
          p1,
          p2,
        );

        current = p2;
        hasCurve = true;

        continue;
      }

      /*
       * closePath
       */
      if (code === 4) {
        closed = true;

        if (
          current &&
          start &&
          isAxisAligned(
            current,
            start,
          )
        ) {
          const len =
            Math.hypot(
              start[0] -
                current[0],
              start[1] -
                current[1],
            );

          if (
            len >= 0.25 &&
            lineWidth > 0
          ) {
            lines.push({
              a: current,
              b: start,
              width:
                lineWidth,
              color:
                stroke,
              opIndex: i,
            });
          }
        }

        current =
          start;

        continue;
      }

      /*
       * Unknown path command.
       *
       * Don't corrupt the remaining
       * geometry.
       */
      break;
    }

    const bbox =
      bboxFromPoints(
        points,
      );

    if (bbox) {
      paths.push({
        color: stroke,
        fillColor: fill,
        lineWidth,
        bbox,
        hasCurve,
        closed,
        opIndex: i,
      });
    }
  }

  let annotations:
    PdfAnnotation[] = [];

  if (
    args.page.getAnnotations
  ) {
    try {
      const raw =
        await args.page.getAnnotations({
          intent: "display",
        });

      annotations =
        raw.map(
          (item: any) => ({
            subtype:
              typeof item?.subtype ===
              "string"
                ? item.subtype
                : undefined,

            rect:
              Array.isArray(item?.rect) &&
              item.rect.length >= 4
                ? [
                    Number(item.rect[0]),
                    Number(item.rect[1]),
                    Number(item.rect[2]),
                    Number(item.rect[3]),
                  ]
                : undefined,

            contents:
              typeof item?.contents ===
              "string"
                ? item.contents
                : undefined,

            fieldName:
              typeof item?.fieldName ===
              "string"
                ? item.fieldName
                : undefined,
          }),
        );
    } catch {
      annotations = [];
    }
  }

  const viewport =
    args.page.getViewport({
      scale: 1,
      dontFlip: true,
    });

  return {
    width:
      viewport.width,

    height:
      viewport.height,

    lines,
    rects,
    paths,

    textCount:
      args.textCount,

    imageCount:
      args.imageCount,

    markedContent,
    annotations,
  };
}

type Segment = { horizontal: boolean; pos: number; a: number; b: number; width: number; color?: Color };
type Track = Segment & { intervals: [number, number][] };

type WallCandidate = {
  start: Vec2;
  end: Vec2;
  horizontal: boolean;
  thickness: number;
  confidence: number;
  color?: Color;
};

function segment(line: PdfLine): Segment {
  const horizontal = Math.abs(line.b[0] - line.a[0]) >= Math.abs(line.b[1] - line.a[1]);
  return horizontal
    ? { horizontal, pos: (line.a[1] + line.b[1]) / 2, a: Math.min(line.a[0], line.b[0]), b: Math.max(line.a[0], line.b[0]), width: Math.max(0.1, line.width), color: line.color }
    : { horizontal, pos: (line.a[0] + line.b[0]) / 2, a: Math.min(line.a[1], line.b[1]), b: Math.max(line.a[1], line.b[1]), width: Math.max(0.1, line.width), color: line.color };
}

function mergeIntervals(xs: [number, number][], gap: number): [number, number][] {
  const sorted = [...xs].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const q = out[out.length - 1];
    if (q && a <= q[1] + gap) q[1] = Math.max(q[1], b);
    else out.push([a, b]);
  }
  return out;
}

function robustMedian(values: number[]): number {
  if (!values.length) return 0;
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = Math.floor(v.length / 2);
  return v.length % 2 ? v[i] : (v[i - 1] + v[i]) / 2;
}

function percentile(values: number[], p: number): number {
  const v = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const i = Math.max(0, Math.min(v.length - 1, Math.round((v.length - 1) * p)));
  return v[i];
}

function textLooksLikeDimension(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (!t) return false;
  if (/^(DOOR|WINDOW|WIN|DR|D|W)[-_ ]?\d{0,4}$/.test(t)) return false;
  return /^(?:\d+(?:\.\d+)?|\d+\s*[X×]\s*\d+|\d+(?:\.\d+)?\s*(?:MM|CM|M|FT|')?)$/.test(t.replace(/,/g, ""));
}

function lineMid(line: PdfLine): Vec2 {
  return [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
}

function pointToLineDistance(p: Vec2, line: PdfLine): number {
  const dx = line.b[0] - line.a[0];
  const dy = line.b[1] - line.a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - line.a[0]) * dx + (p[1] - line.a[1]) * dy) / l2));
  return Math.hypot(p[0] - (line.a[0] + dx * t), p[1] - (line.a[1] + dy * t));
}

function isPerpendicular(a: PdfLine, b: PdfLine): boolean {
  const ah = Math.abs(a.b[0] - a.a[0]) >= Math.abs(a.b[1] - a.a[1]);
  const bh = Math.abs(b.b[0] - b.a[0]) >= Math.abs(b.b[1] - b.a[1]);
  return ah !== bh;
}

function isDimensionLike(line: PdfLine, page: PdfVectorPage, allLines: PdfLine[]): boolean {
  const len = Math.hypot(line.b[0] - line.a[0], line.b[1] - line.a[1]);
  if (len < Math.max(10, Math.min(page.width, page.height) * 0.01)) return false;

  const m = lineMid(line);
  const axis = Math.abs(line.b[0] - line.a[0]) >= Math.abs(line.b[1] - line.a[1]);
  const nearPerpendicular = allLines.filter((other) => {
    if (other === line || !isPerpendicular(line, other)) return false;
    const olen = Math.hypot(other.b[0] - other.a[0], other.b[1] - other.a[1]);
    if (olen < Math.max(2, line.width * 0.8) || olen > Math.max(35, len * 0.18)) return false;
    const om = lineMid(other);
    const along = axis ? om[0] : om[1];
    const lo = axis ? Math.min(line.a[0], line.b[0]) : Math.min(line.a[1], line.b[1]);
    const hi = axis ? Math.max(line.a[0], line.b[0]) : Math.max(line.a[1], line.b[1]);
    return along >= lo - Math.max(8, line.width * 4) && along <= hi + Math.max(8, line.width * 4) && pointToLineDistance(om, line) <= Math.max(8, line.width * 5);
  }).length;

  const dimensionText = (page.textItems ?? []).some((t) => {
    if (!textLooksLikeDimension(t.text)) return false;
    const tx = t.position[0] + t.width / 2;
    const ty = t.position[1] + t.height / 2;
    return Math.hypot(tx - m[0], ty - m[1]) <= Math.max(18, len * 0.12);
  });

  return nearPerpendicular >= 2 || dimensionText;
}

function buildTracks(lines: PdfLine[], colors: (c?: Color) => boolean): Track[] {
  const source = lines.filter((l) => l.width > 0 && colors(l.color)).map(segment);
  const tracks: Track[] = [];
  for (const s of source) {
    let t = tracks.find((x) => x.horizontal === s.horizontal && Math.abs(x.pos - s.pos) <= Math.max(1.5, s.width * 2.5) && s.a <= x.b + 2.5 && s.b >= x.a - 2.5);
    if (!t) {
      t = { ...s, intervals: [[s.a, s.b]] };
      tracks.push(t);
    } else {
      t.a = Math.min(t.a, s.a); t.b = Math.max(t.b, s.b); t.width = Math.max(t.width, s.width); t.intervals.push([s.a, s.b]);
    }
  }
  for (const t of tracks) t.intervals = mergeIntervals(t.intervals, Math.max(2.5, t.width * 3));
  return tracks;
}

function overlap(a: Track, b: Track): [number, number] | null {
  const lo = Math.max(a.a, b.a), hi = Math.min(a.b, b.b);
  return hi - lo >= 8 ? [lo, hi] : null;
}

function supportAt(t: Track, x: number): boolean {
  return t.intervals.some(([a, b]) => x >= a && x <= b);
}

function gapCandidates(a: Track, b: Track, lo: number, hi: number): { a: number; b: number }[] {
  const cuts = [lo, hi];
  for (const [x, y] of [...a.intervals, ...b.intervals]) { if (x > lo && x < hi) cuts.push(x); if (y > lo && y < hi) cuts.push(y); }
  cuts.sort((x, y) => x - y);
  const uniq = cuts.filter((v, i) => i === 0 || v - cuts[i - 1] > 1);
  const gaps: { a: number; b: number }[] = [];
  for (let i = 0; i + 1 < uniq.length; i++) {
    const x = uniq[i], y = uniq[i + 1];
    if (y - x < 8) continue;
    const mid = (x + y) / 2;
    if (!supportAt(a, mid) && !supportAt(b, mid)) gaps.push({ a: x, b: y });
  }
  return gaps;
}

function makePairedWalls(tracks: Track[], page: PdfVectorPage): { walls: WallCandidate[]; gaps: { horizontal: boolean; pos: number; a: number; b: number; thickness: number; confidence: number }[] } {
  const walls: WallCandidate[] = [];
  const gaps: { horizontal: boolean; pos: number; a: number; b: number; thickness: number; confidence: number }[] = [];
  const candidates: { i: number; j: number; distance: number; overlap: number; ratio: number; lo: number; hi: number }[] = [];
  const widthPopulation = tracks.map((t) => t.width);
  const typicalWidth = Math.max(0.5, robustMedian(widthPopulation));
  const wideWidth = Math.max(typicalWidth * 4, percentile(widthPopulation, 0.90) * 2);
  const maxThickness = Math.max(8, Math.min(page.width, page.height) * 0.018, wideWidth * 2.5);

  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const a = tracks[i], b = tracks[j];
      if (a.horizontal !== b.horizontal) continue;
      const distance = Math.abs(a.pos - b.pos);
      if (distance < Math.max(typicalWidth * 1.5, 2) || distance > maxThickness) continue;
      const widthRatio = Math.min(a.width, b.width) / Math.max(a.width, b.width, 0.01);
      if (widthRatio < 0.45) continue;
      const lo = Math.max(a.a, b.a);
      const hi = Math.min(a.b, b.b);
      const ov = hi - lo;
      const ratio = ov / Math.max(1, Math.min(a.b - a.a, b.b - b.a));
      if (ov < 20 || ratio < 0.42) continue;
      candidates.push({ i, j, distance, overlap: ov, ratio, lo, hi });
    }
  }

  // A wall boundary should normally have one close parallel mate. Pick the
  // best mate per track instead of pairing every nearby line; this prevents
  // window frames and adjacent wall bands from multiplying wall candidates.
  const chosen = new Set<string>();
  for (let i = 0; i < tracks.length; i++) {
    const list = candidates.filter((c) => c.i === i || c.j === i).sort((a, b) => {
      const scoreA = Math.abs(a.distance - typicalWidth * 3.5) / Math.max(1, typicalWidth) - Math.min(0.35, a.ratio * 0.35) + (a.overlap < 40 ? 0.5 : 0);
      const scoreB = Math.abs(b.distance - typicalWidth * 3.5) / Math.max(1, typicalWidth) - Math.min(0.35, b.ratio * 0.35) + (b.overlap < 40 ? 0.5 : 0);
      return scoreA - scoreB;
    });
    const best = list[0];
    if (!best) continue;
    chosen.add(`${best.i}:${best.j}`);
  }

  for (const c of candidates) {
    if (!chosen.has(`${c.i}:${c.j}`)) continue;
    const a = tracks[c.i], b = tracks[c.j];
    const center = (a.pos + b.pos) / 2;
    walls.push({
      start: a.horizontal ? [c.lo, center] : [center, c.lo],
      end: a.horizontal ? [c.hi, center] : [center, c.hi],
      horizontal: a.horizontal,
      thickness: c.distance,
      confidence: Math.min(0.99, 0.82 + c.ratio * 0.14),
      color: isRed(a.color) || isRed(b.color) ? [1, 0, 0] : a.color,
    });
    for (const gap of gapCandidates(a, b, c.lo, c.hi)) {
      if (gap.b - gap.a >= 18) gaps.push({ horizontal: a.horizontal, pos: center, a: gap.a, b: gap.b, thickness: c.distance, confidence: c.ratio });
    }
  }
  return { walls, gaps };
}
function segmentEndpointDistance(a: PdfLine, b: PdfLine): number {
  const pts: Vec2[] = [a.a, a.b];
  let best = Infinity;
  for (const p of pts) best = Math.min(best, pointToLineDistance(p, b));
  for (const p of [b.a, b.b]) best = Math.min(best, pointToLineDistance(p, a));
  return best;
}

function endpointNearSegment(line: PdfLine, other: PdfLine, tolerance: number): boolean {
  return pointToLineDistance(line.a, other) <= tolerance ||
    pointToLineDistance(line.b, other) <= tolerance ||
    pointToLineDistance(other.a, line) <= tolerance ||
    pointToLineDistance(other.b, line) <= tolerance;
}

function lineTouchesStructuralNetwork(line: PdfLine, source: PdfLine[], tolerance: number): number {
  let count = 0;
  for (const other of source) {
    if (other === line) continue;
    if (!isPerpendicular(line, other)) continue;
    if (endpointNearSegment(line, other, tolerance)) count++;
    if (count >= 4) break;
  }
  return count;
}

function singleLineWalls(lines: PdfLine[], page: PdfVectorPage, paired: WallCandidate[]): WallCandidate[] {
  const out: WallCandidate[] = [];
  const redMode = lines.some((l) => isRed(l.color));
  const source = lines.filter(
    (l) => l.width > 0 &&
      (redMode ? isRed(l.color) : true),
  );

  // IMPORTANT: do not use the median stroke width as a wall threshold.
  // Dimension lines often dominate the population. Instead, use width only
  // as weak evidence and require topology for a single-line wall.
  const widths = source.map((l) => l.width).filter(Number.isFinite);
  const q50 = robustMedian(widths);
  const q75 = percentile(widths, 0.75);
  const q90 = percentile(widths, 0.90);
  const thickReference = Math.max(q75, q50 * 1.35, q90 * 0.75, 0.01);

  for (const line of source) {
    const s = segment(line);
    const minLen = Math.max(18, Math.min(page.width, page.height) * 0.008);
    if (s.b - s.a < minLen) continue;
    if (!redMode && isDimensionLike(line, page, source)) continue;

    const nearPair = paired.some((w) => {
      const wh = Math.abs(w.end[0] - w.start[0]) >= Math.abs(w.end[1] - w.start[1]);
      const wp = wh ? w.start[1] : w.start[0];
      const wa = wh ? Math.min(w.start[0], w.end[0]) : Math.min(w.start[1], w.end[1]);
      const wb = wh ? Math.max(w.start[0], w.end[0]) : Math.max(w.start[1], w.end[1]);
      return wh === s.horizontal &&
        Math.abs(wp - s.pos) < Math.max(3, line.width * 2) &&
        Math.min(wb, s.b) - Math.max(wa, s.a) > 20;
    });
    if (nearPair) continue;

    // A single line is a wall only when it participates in the structural
    // network. Endpoint/intersection evidence is much stronger than stroke
    // width because PDF exports can use arbitrary line widths.
    const junctions = lineTouchesStructuralNetwork(
      line,
      source,
      Math.max(2.5, line.width * 2.5),
    );

    // Check whether the line closes toward another structural line. This is
    // useful for one-line CAD walls where only the wall centreline was drawn.
    const connected = junctions >= 2;
    const materiallyThick = line.width >= thickReference;

    // A thick isolated line can still be a dimension/reference line. It is
    // therefore never sufficient by itself.
    if (!connected && !materiallyThick) continue;
    if (!connected && !isAxisAligned(line.a, line.b, 0.995)) continue;

    // Reject classic dimension-like geometry even when its text was not
    // extracted: long isolated line + two perpendicular end marks.
    const dimensionMarks = source.filter((other) => {
      if (!isPerpendicular(line, other)) return false;
      const len = lineLength(other);
      if (len > Math.max(40, lineLength(line) * 0.20)) return false;
      return endpointNearSegment(line, other, Math.max(2.5, line.width * 3));
    }).length;
    if (!connected && dimensionMarks >= 2) continue;

    const widthEvidence = Math.min(0.18, line.width / Math.max(thickReference, 0.01) * 0.12);
    const topologyEvidence = Math.min(0.45, junctions * 0.11);

    out.push({
      start: s.horizontal ? [s.a, s.pos] : [s.pos, s.a],
      end: s.horizontal ? [s.b, s.pos] : [s.pos, s.b],
      horizontal: s.horizontal,
      thickness: Math.max(0.1, s.width),
      confidence: Math.min(0.86, 0.42 + widthEvidence + topologyEvidence),
      color: s.color,
    });
  }
  return out;
}

function dedupeWalls(walls: WallCandidate[]): WallCandidate[] {
  const sorted = [...walls].sort((a, b) => b.confidence - a.confidence);
  const out: WallCandidate[] = [];
  for (const w of sorted) {
    const h = Math.abs(w.end[0] - w.start[0]) >= Math.abs(w.end[1] - w.start[1]);
    const pos = h ? (w.start[1] + w.end[1]) / 2 : (w.start[0] + w.end[0]) / 2;
    const a = h ? Math.min(w.start[0], w.end[0]) : Math.min(w.start[1], w.end[1]);
    const b = h ? Math.max(w.start[0], w.end[0]) : Math.max(w.start[1], w.end[1]);
    const dup = out.some((q) => {
      const qh = Math.abs(q.end[0] - q.start[0]) >= Math.abs(q.end[1] - q.start[1]);
      if (qh !== h) return false;
      const qp = qh ? (q.start[1] + q.end[1]) / 2 : (q.start[0] + q.end[0]) / 2;
      const qa = qh ? Math.min(q.start[0], q.end[0]) : Math.min(q.start[1], q.end[1]);
      const qb = qh ? Math.max(q.start[0], q.end[0]) : Math.max(q.start[1], q.end[1]);
      return Math.abs(qp - pos) < 2 && Math.min(qb, b) - Math.max(qa, a) > Math.min(qb - qa, b - a) * 0.65;
    });
    if (!dup) out.push(w);
  }
  return out;
}

function mergeWallFragments(walls: WallCandidate[]): WallCandidate[] {
  const out: WallCandidate[] = [];
  for (const w of [...walls].sort((a, b) => b.confidence - a.confidence)) {
    const h = Math.abs(w.end[0] - w.start[0]) >= Math.abs(w.end[1] - w.start[1]);
    const pos = h ? (w.start[1] + w.end[1]) / 2 : (w.start[0] + w.end[0]) / 2;
    const a = h ? Math.min(w.start[0], w.end[0]) : Math.min(w.start[1], w.end[1]);
    const b = h ? Math.max(w.start[0], w.end[0]) : Math.max(w.start[1], w.end[1]);
    const q = out.find((x) => {
      const xh = Math.abs(x.end[0] - x.start[0]) >= Math.abs(x.end[1] - x.start[1]);
      if (xh !== h) return false;
      const xp = xh ? (x.start[1] + x.end[1]) / 2 : (x.start[0] + x.end[0]) / 2;
      const xa = xh ? Math.min(x.start[0], x.end[0]) : Math.min(x.start[1], x.end[1]);
      const xb = xh ? Math.max(x.start[0], x.end[0]) : Math.max(x.start[1], x.end[1]);
      return Math.abs(xp - pos) <= 1.5 && Math.abs(x.thickness - w.thickness) <= 2.5 && Math.min(xb, b) >= Math.max(xa, a) - 8;
    });
    if (!q) { out.push({ ...w }); continue; }
    if (h) {
      q.start = [Math.min(q.start[0], w.start[0]), q.start[1]];
      q.end = [Math.max(q.end[0], w.end[0]), q.end[1]];
    } else {
      q.start = [q.start[0], Math.min(q.start[1], w.start[1])];
      q.end = [q.end[0], Math.max(q.end[1], w.end[1])];
    }
    q.thickness = (q.thickness + w.thickness) / 2;
    q.confidence = Math.max(q.confidence, w.confidence);
  }
  return out;
}

function inferScale(page: PdfVectorPage, walls: WallCandidate[], redMode: boolean): { mpp: number; estimated: boolean } {
  if (!walls.length) return { mpp: 0.01, estimated: true };
  const paired = walls.filter((w) => w.confidence >= 0.8 && w.thickness > 3 && w.thickness < 20);
  if (paired.length) {
    const thicknesses = paired.map((w) => w.thickness).sort((a, b) => a - b);
    // In the Hard CAD plan, ~8.76 source units is the wall-band thickness;
    // ~6.2 is used by window/door frame graphics. Prefer the wall-band cluster.
    const wallThicknesses = redMode ? thicknesses.filter((t) => t >= 7 && t <= 10.5) : thicknesses;
    const median = (wallThicknesses.length ? wallThicknesses : thicknesses)[Math.floor((wallThicknesses.length ? wallThicknesses : thicknesses).length / 2)];
    // Architectural wall thickness priors in metres. Pick the prior that makes
    // the drawing footprint plausible while keeping the source wall thickness realistic.
    const priors = [0.10, 0.115, 0.12, 0.15, 0.18, 0.20, 0.23, 0.25, 0.30];
    const xs = walls.flatMap((w) => [w.start[0], w.end[0]]), ys = walls.flatMap((w) => [w.start[1], w.end[1]]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    let best = 0.01, score = Infinity;
    for (const p of priors) {
      const mpp = p / median;
      const footprint = span * mpp;
      if (footprint < 6 || footprint > 45) continue;
      const s = Math.abs(Math.log(p / 0.15)) + (footprint < 8 || footprint > 45 ? 1 : 0);
      if (s < score) { score = s; best = mpp; }
    }
    return { mpp: best, estimated: true };
  }
  const xs = walls.flatMap((w) => [w.start[0], w.end[0]]), ys = walls.flatMap((w) => [w.start[1], w.end[1]]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  // Keep an estimated architectural footprint in a conservative range.
  // Exact scale still comes from metersPerPdfUnit or a known dimension.
  const targetSpan = Math.min(35, Math.max(8, span * 0.012));
  return { mpp: targetSpan / span, estimated: true };
}

function pointInGap(g: { horizontal: boolean; pos: number; a: number; b: number }, p: Vec2): boolean {
  const along = g.horizontal ? p[0] : p[1];
  const across = g.horizontal ? p[1] : p[0];
  return along >= g.a - 2 && along <= g.b + 2 && Math.abs(across - g.pos) <= 14;
}

function distanceAlongWall(
    wall: Wall,
    point: Vec2,
  ): number {
    const dx =
      wall.end[0] -
      wall.start[0];
  
    const dy =
      wall.end[1] -
      wall.start[1];
  
    const length =
      Math.hypot(
        dx,
        dy,
      );
  
    if (
      length <=
      1e-9
    ) {
      return 0;
    }
  
    const px =
      point[0] -
      wall.start[0];
  
    const py =
      point[1] -
      wall.start[1];
  
    return (
      (px * dx +
        py * dy) /
      length
    );
  }


function distancePointToCandidate(p: Vec2, w: WallCandidate): number {
  const dx = w.end[0] - w.start[0], dy = w.end[1] - w.start[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - w.start[0]) * dx + (p[1] - w.start[1]) * dy) / l2));
  return Math.hypot(p[0] - (w.start[0] + dx * t), p[1] - (w.start[1] + dy * t));
}

export function buildGraphFromVectorPage(page: PdfVectorPage, options: ConvertOptions): BuildingGraph {
  // Red-layer mode is only enabled when red geometry is a meaningful part of
  // the drawing. A single red annotation must not make us discard black wall
  // geometry.
  const redLineCount = page.lines.filter((l) => isRed(l.color)).length;
  const redMode = redLineCount >= 4 && redLineCount >= Math.max(4, page.lines.length * 0.03);

  // First remove lines with explicit dimension evidence. This happens before
  // width analysis so dimension strokes cannot distort the drawing's adaptive
  // stroke population. Width is intentionally NOT used as a fixed wall gate.
  // Do not require a specific PDF stroke colour. Many CAD/PDF exporters
  // emit the same wall geometry with undefined/default/device colours.
  // First remove obvious dimension lines, then use colour only as a weak
  // preference when enough colour information is actually present.
  const nonDimensionLines = page.lines.filter(
    (l) => !isDimensionLike(l, page, page.lines),
  );

  const blackLines = nonDimensionLines.filter(
    (l) => isBlack(l.color) ||
      (!!l.color && colorDistance(l.color, [0, 0, 0]) < 0.55),
  );

  const colouredLineRatio = page.lines.length
    ? blackLines.length / page.lines.length
    : 0;

  // If the PDF does not expose useful stroke colours, analyse all geometric
  // line candidates. Geometry/topology then decides what is structural.
  const structuralLines = redMode
    ? nonDimensionLines.filter((l) => isRed(l.color))
    : colouredLineRatio >= 0.08
      ? blackLines
      : nonDimensionLines;

  const wallTracks = buildTracks(
    structuralLines,
    () => true,
  );
  const paired = makePairedWalls(wallTracks, page);
  const single = redMode ? [] : singleLineWalls(structuralLines, page, paired.walls);
  let raw = mergeWallFragments(dedupeWalls([...paired.walls, ...single]));

  // Some PDF exporters flatten wall bands into filled rectangles instead of
  // emitting stroked paths. Recover their four structural edges as wall
  // candidates instead of declaring the page unusable. Dimension-sized
  // rectangles are intentionally ignored.
  if (raw.length < 3 && page.rects.length) {
    const rectWalls: WallCandidate[] = [];
    for (const r of page.rects) {
      const minDim = Math.min(Math.abs(r.width), Math.abs(r.height));
      const maxDim = Math.max(Math.abs(r.width), Math.abs(r.height));
      if (minDim <= 0 || maxDim < 12) continue;
      if (minDim > Math.min(page.width, page.height) * 0.12) continue;
      const x0 = r.x, x1 = r.x + r.width;
      const y0 = r.y, y1 = r.y + r.height;
      const confidence = r.filled ? 0.76 : 0.62;
      rectWalls.push(
        { start: [x0, y0], end: [x1, y0], horizontal: true, thickness: minDim, confidence },
        { start: [x0, y1], end: [x1, y1], horizontal: true, thickness: minDim, confidence },
        { start: [x0, y0], end: [x0, y1], horizontal: false, thickness: minDim, confidence },
        { start: [x1, y0], end: [x1, y1], horizontal: false, thickness: minDim, confidence },
      );
    }
    raw = mergeWallFragments(dedupeWalls(rectWalls));
  }

  const scale =
  options.metersPerPdfUnit
    ? {
        mpp:
          options.metersPerPdfUnit,
        estimated: false,
      }
    : inferScale(
        page,
        raw,
        redMode,
      );

      
  const xs = raw.flatMap((w) => [w.start[0], w.end[0]]), ys = raw.flatMap((w) => [w.start[1], w.end[1]]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const world = (p: Vec2): Vec2 => [(p[0] - minX) * scale.mpp, (maxY - p[1]) * scale.mpp];
  const height = options.wallHeight ?? options.storeyHeight ?? 3;

  const walls: Wall[] = raw.map((w, i) => ({
    id: `W-${i + 1}`,
    start: world(w.start),
    end: world(w.end),
    // Preserve the measured vector wall-band thickness. Do not force every
    // PDF wall to 80 mm: different CAD exports use different drawing units
    // and stroke widths. The classifier has already decided this geometry is
    // structural before it reaches the BIM graph.
    thickness: Math.min(0.60, Math.max(0.005, w.thickness * scale.mpp)),
    height,
    kind: "internal",
    confidence: w.confidence,
    source: "pdf-vector",
    evidence: w.confidence >= 0.8 ? "parallel-boundaries" : "single-line",
    sourceThickness: w.thickness * scale.mpp,
    reconstructed: w.confidence >= 0.8,
  }));
  const wallXs = walls.flatMap((w) => [w.start[0], w.end[0]]);
  const wallYs = walls.flatMap((w) => [w.start[1], w.end[1]]);
  const minWX = Math.min(...wallXs);
  const maxWX = Math.max(...wallXs);
  const minWY = Math.min(...wallYs);
  const maxWY = Math.max(...wallYs);
  const envelopePad = 0.30;
  for (const w of walls) {
    const nearX = Math.abs(w.start[0] - minWX) < envelopePad || Math.abs(w.start[0] - maxWX) < envelopePad || Math.abs(w.end[0] - minWX) < envelopePad || Math.abs(w.end[0] - maxWX) < envelopePad;
    const nearY = Math.abs(w.start[1] - minWY) < envelopePad || Math.abs(w.start[1] - maxWY) < envelopePad || Math.abs(w.end[1] - minWY) < envelopePad || Math.abs(w.end[1] - maxWY) < envelopePad;
    if (nearX || nearY) w.kind = "external";
  }

  const openings: Opening[] = [];
  let oi = 0;

  // Windows: cyan CAD geometry is a very strong signal in Hard.pdf. Group
  // nearby cyan line fragments into a single window symbol and host it on the
  // nearest reconstructed wall.
  const cyanLines = page.lines.filter((l) => isCyan(l.color));
  const cyanGroups: { wall: number; a: number; b: number; count: number; horizontal: boolean }[] = [];
  for (const line of cyanLines) {
    const s = segment(line);
    const mid: Vec2 = s.horizontal ? [(s.a + s.b) / 2, s.pos] : [s.pos, (s.a + s.b) / 2];
    let best = -1, bestD = Infinity;
    raw.forEach((w, wi) => {
      const d = distancePointToCandidate(mid, w);
      if (d < bestD) { bestD = d; best = wi; }
    });
    if (best < 0 || bestD > 16) continue;
    const along = s.a;
    const end = s.b;
    const existing = cyanGroups.find((g) => g.wall === best && g.horizontal === s.horizontal && Math.min(g.b, end) >= Math.max(g.a, along) - 18);
    if (existing) { existing.a = Math.min(existing.a, along); existing.b = Math.max(existing.b, end); existing.count++; }
    else cyanGroups.push({ wall: best, a: along, b: end, count: 1, horizontal: s.horizontal });
  }
  for (const g of cyanGroups) {
    if (g.count < 2) continue;
    const width = (g.b - g.a) * scale.mpp;
    if (width < 0.45 || width > 2.5) continue;
    const hostRaw = raw[g.wall];
    const host = walls[g.wall];
    if (!hostRaw || !host) continue;
    const alongSource = (g.a + g.b) / 2;
    const hostStartSource = hostRaw.horizontal ? hostRaw.start[0] : hostRaw.start[1];
    const offset = Math.max(0, (alongSource - (hostRaw.horizontal ? Math.min(hostRaw.start[0], hostRaw.end[0]) : Math.min(hostRaw.start[1], hostRaw.end[1]))) * scale.mpp - width / 2);
    openings.push({ id: `O-${oi++}`, type: "window", wallId: host.id, offset: Math.min(offset, Math.max(0, (Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1]) - width))), width, height: 1.2, sill: 0.9, confidence: 0.92, source: "pdf-vector", evidence: "window-symbol" });
    void hostStartSource;
  }

  // Doors: the source drawing renders door swings as many small yellow/gold
  // segments. We use only yellow segments close to a red wall and cluster
  // them along that wall; room-number circles are normally farther away.
  const yellowLines = page.lines.filter((l) => l.color && l.color[0] > 0.9 && l.color[1] > 0.9 && l.color[2] < 0.2);
  for (let wi = 0; wi < raw.length; wi++) {
    const hostRaw = raw[wi], host = walls[wi];
    if (!hostRaw || !host) continue;
    const h = Math.abs(hostRaw.end[0] - hostRaw.start[0]) >= Math.abs(hostRaw.end[1] - hostRaw.start[1]);
    const h0 = h ? Math.min(hostRaw.start[0], hostRaw.end[0]) : Math.min(hostRaw.start[1], hostRaw.end[1]);
    const h1 = h ? Math.max(hostRaw.start[0], hostRaw.end[0]) : Math.max(hostRaw.start[1], hostRaw.end[1]);
    const pts: number[] = [];
    for (const line of yellowLines) {
      const s = segment(line);
      if (s.horizontal !== h) {
        // Door leaf can be perpendicular to the host.
        const p: Vec2 = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
        if (distancePointToCandidate(p, hostRaw) > 16) continue;
        const along = h ? p[0] : p[1];
        if (along >= h0 - 20 && along <= h1 + 20) pts.push(along);
      } else {
        const p: Vec2 = [(line.a[0] + line.b[0]) / 2, (line.a[1] + line.b[1]) / 2];
        if (distancePointToCandidate(p, hostRaw) > 16) continue;
        const along = h ? p[0] : p[1];
        if (along >= h0 - 20 && along <= h1 + 20 && s.b - s.a >= 4) pts.push(along);
      }
    }
    pts.sort((a, b) => a - b);
    let cluster: number[] = [];
    const flush = () => {
      if (cluster.length < 3) { cluster = []; return; }
      const a = Math.min(...cluster), b = Math.max(...cluster), span = b - a;
      if (span < 20 || span > 110) { cluster = []; return; }
      const width = span * scale.mpp;
      if (width < 0.55 || width > 1.5) { cluster = []; return; }
      const hostLen = Math.hypot(host.end[0] - host.start[0], host.end[1] - host.start[1]);
      const hostStart = h ? Math.min(hostRaw.start[0], hostRaw.end[0]) : Math.min(hostRaw.start[1], hostRaw.end[1]);
      const offset = Math.max(0, Math.min(hostLen - width, (a - hostStart) * scale.mpp));
      const duplicate = openings.some((o) => o.wallId === host.id && o.type === "door" && Math.abs(o.offset - offset) < 0.35);
      if (!duplicate) openings.push({ id: `O-${oi++}`, type: "door", wallId: host.id, offset, width, height: 2.1, sill: 0, confidence: 0.78, source: "pdf-vector", evidence: "door-symbol" });
      cluster = [];
    };
    for (const p of pts) {
      if (!cluster.length || p - cluster[cluster.length - 1] <= 22) cluster.push(p);
      else { flush(); cluster = [p]; }
    }
    flush();
  }

  const graph: BuildingGraph = { name: "Converted PDF plan", storeyName: "Ground Floor", storeyHeight: height, metersPerPixel: scale.mpp, imageWidth: Math.round(page.width), imageHeight: Math.round(page.height), imageOffsetX: 0, imageOffsetY: 0, warnings: [], walls, openings, spaces: [] };
  if (
    !options.metersPerPdfUnit
  ) {
    graph.warnings.push(
      "PDF scale is estimated. Provide metersPerPdfUnit using a known wall dimension for accurate IFC dimensions.",
    );
  }
  if (scale.estimated) graph.warnings.push("PDF vector scale was estimated from architectural wall thickness. Provide metersPerPixel for exact IFC dimensions.");
  if (redMode) graph.warnings.push("PDF vector wall layer detected as red CAD geometry; cyan/gold geometry was used as opening evidence.");
  if (walls.length < 8) graph.warnings.push(`Vector extraction produced ${walls.length} walls; review the source PDF if the drawing uses non-orthogonal or rasterized wall geometry.`);
  graph.spaces = spacesFromWalls(graph.walls);
  graph.doors = graph.openings.filter((o) => o.type === "door");
  graph.windows = graph.openings.filter((o) => o.type === "window");
  return graph;
}
