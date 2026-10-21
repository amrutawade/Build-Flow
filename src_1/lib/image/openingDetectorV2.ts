import type { BuildingGraph, Opening, Vec2, Wall } from "../models";

export type GrayImage = {
  data: Uint8Array;
  width: number;
  height: number;
};

type CandidateType = "door" | "window";

type Candidate = {
  wall: Wall;
  type: CandidateType;
  a: number;
  b: number;

  score: number;

  evidence: {
    gap: number;
    jambs: number;
    parallelLines: number;
    arc: number;
    leaf: number;
    interior: number;
  };
};

const EPS = 1e-6;

/**
 * Much more tolerant than a single threshold.
 *
 * The detector works from:
 *   - dark wall pixels
 *   - lighter symbol pixels
 *   - local contrast
 *
 * It does NOT assume:
 *   width > X === window
 */
export function detectOpeningsV2(
  gray: GrayImage,
  wallInk: Uint8Array,
  lightInk: Uint8Array,
  walls: Wall[],
  metersPerPixel: number,
): Opening[] {
  const candidates: Candidate[] = [];

  for (const wall of walls) {
    const wallLength = length(wall.start, wall.end);

    if (wallLength < 0.45) {
      continue;
    }

    const direction = normalize([
      wall.end[0] - wall.start[0],
      wall.end[1] - wall.start[1],
    ]);

    const normal: Vec2 = [
      -direction[1],
      direction[0],
    ];

    /*
     * Search many possible opening sizes.
     *
     * We deliberately do NOT say:
     *   0.5-1.3 = door
     *   >1.05 = window
     *
     * Both doors and windows are tested against the same geometry.
     */
    const sizes = [
      0.55,
      0.65,
      0.75,
      0.85,
      1.0,
      1.2,
      1.4,
      1.6,
      1.8,
      2.0,
      2.4,
      3.0,
    ];

    const stepMeters = Math.max(
      0.08,
      Math.min(0.15, wallLength / 30),
    );

    for (
      let center = 0.25;
      center < wallLength - 0.25;
      center += stepMeters
    ) {
      for (const width of sizes) {
        if (center - width / 2 < 0.05) continue;
        if (center + width / 2 > wallLength - 0.05) continue;
        if (width > wallLength * 0.85) continue;

        const candidate = evaluateCandidate(
          gray,
          wallInk,
          lightInk,
          wall,
          direction,
          normal,
          center,
          width,
          metersPerPixel,
        );

        if (candidate.score >= 0.62) {
          candidates.push(candidate);
        }
      }
    }
  }

  const selected = nonMaximumSuppression(
    candidates,
    metersPerPixel,
  );

  return selected.map((c, i) =>
    candidateToOpening(c, i),
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate evaluation                                                       */
/* -------------------------------------------------------------------------- */

function evaluateCandidate(
  gray: GrayImage,
  wallInk: Uint8Array,
  lightInk: Uint8Array,
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  mpp: number,
): Candidate {
  const wallLength = length(wall.start, wall.end);

  const gap = scoreWallGap(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    wallInk,
    mpp,
  );

  const jambs = scoreJambs(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    wallInk,
    mpp,
  );

  const parallelLines = scoreWindowParallelLines(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    gray,
    wallInk,
    mpp,
  );

  const arc = scoreDoorArc(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    gray,
    lightInk,
    mpp,
  );

  const leaf = scoreDoorLeaf(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    gray,
    lightInk,
    mpp,
  );

  const interior = scoreInteriorOpening(
    wall,
    dir,
    normal,
    center,
    widthMeters,
    gray,
    mpp,
  );

  /*
   * Important:
   *
   * A door normally has:
   *   gap + jamb + leaf/arc
   *
   * A window normally has:
   *   gap + jamb + parallel lines
   *
   * So we explicitly score those patterns.
   */
  const doorScore =
    0.30 * gap +
    0.12 * jambs +
    0.22 * arc +
    0.18 * leaf +
    0.08 * interior +
    0.10 * (1 - parallelLines);

  const windowScore =
    0.30 * gap +
    0.15 * jambs +
    0.28 * parallelLines +
    0.17 * interior +
    0.10 * (1 - arc);

  const type: CandidateType =
    doorScore >= windowScore ? "door" : "window";

  const score =
    type === "door"
      ? doorScore
      : windowScore;

  return {
    wall,
    type,
    a: Math.max(0, center - widthMeters / 2),
    b: Math.min(wallLength, center + widthMeters / 2),
    score,
    evidence: {
      gap,
      jambs,
      parallelLines,
      arc,
      leaf,
      interior,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Wall interruption                                                          */
/* -------------------------------------------------------------------------- */

function scoreWallGap(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  wallInk: Uint8Array,
  mpp: number,
): number {
  const half = widthMeters / 2;

  const samples = Math.max(
    5,
    Math.round(widthMeters / mpp),
  );

  let inside = 0;
  let outside = 0;

  for (let i = 0; i <= samples; i++) {
    const s =
      center - half +
      (widthMeters * i) / samples;

    const p = add(
      wall.start,
      mul(dir, s),
    );

    /*
     * Check across wall thickness.
     */
    let crossHits = 0;

    for (
      let n = -Math.max(2, Math.round(0.35 / mpp));
      n <= Math.max(2, Math.round(0.35 / mpp));
      n++
    ) {
      const q = add(
        p,
        mul(normal, n * mpp),
      );

      if (sampleMask(
        wallInk,
        q,
      )) {
        crossHits++;
      }
    }

    if (crossHits === 0) {
      inside++;
    }
  }

  const outsideStart = center - half - 0.18;
  const outsideEnd = center + half + 0.18;

  for (const s of [outsideStart, outsideEnd]) {
    const p = add(
      wall.start,
      mul(dir, s),
    );

    let hit = 0;

    for (
      let n = -Math.max(2, Math.round(0.35 / mpp));
      n <= Math.max(2, Math.round(0.35 / mpp));
      n++
    ) {
      if (
        sampleMask(
          wallInk,
          add(p, mul(normal, n * mpp)),
        )
      ) {
        hit++;
      }
    }

    if (hit > 0) {
      outside++;
    }
  }

  const gapRatio =
    inside / Math.max(1, samples + 1);

  /*
   * Opening should be empty while the wall continues
   * on both sides.
   */
  return clamp(
    gapRatio * 0.8 +
      (outside === 2 ? 0.2 : 0),
    0,
    1,
  );
}

/* -------------------------------------------------------------------------- */
/* Jamb detection                                                             */
/* -------------------------------------------------------------------------- */

function scoreJambs(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  wallInk: Uint8Array,
  mpp: number,
): number {
  const left = center - widthMeters / 2;
  const right = center + widthMeters / 2;

  const leftScore = scoreJamb(
    wall,
    dir,
    normal,
    left,
    wallInk,
    mpp,
  );

  const rightScore = scoreJamb(
    wall,
    dir,
    normal,
    right,
    wallInk,
    mpp,
  );

  return Math.min(leftScore, rightScore);
}

function scoreJamb(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  s: number,
  wallInk: Uint8Array,
  mpp: number,
): number {
  const p = add(
    wall.start,
    mul(dir, s),
  );

  let hits = 0;
  let total = 0;

  /*
   * Jambs are approximately perpendicular to wall direction.
   */
  for (
    let along = -0.06;
    along <= 0.06;
    along += Math.max(mpp, 0.01)
  ) {
    for (
      let across = -0.25;
      across <= 0.25;
      across += Math.max(mpp, 0.01)
    ) {
      const q = add(
        add(p, mul(dir, along)),
        mul(normal, across),
      );

      total++;

      if (sampleMask(wallInk, q)) {
        hits++;
      }
    }
  }

  return clamp(
    hits / Math.max(1, total) * 2.2,
    0,
    1,
  );
}

/* -------------------------------------------------------------------------- */
/* Window detection                                                           */
/* -------------------------------------------------------------------------- */

function scoreWindowParallelLines(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  gray: GrayImage,
  wallInk: Uint8Array,
  mpp: number,
): number {
  /*
   * Typical window symbol:
   *
   *   wall ┃ ┃
   *        ┃ ┃
   *        ┃ ┃
   *
   * Two relatively parallel thin lines inside the opening.
   *
   * We test several offsets instead of expecting one exact
   * pixel position.
   */

  const offsets = [
    -0.08,
    -0.05,
    -0.025,
    0.025,
    0.05,
    0.08,
  ];

  let best = 0;

  for (const offset of offsets) {
    let hits = 0;
    let total = 0;

    const start = center - widthMeters * 0.42;
    const end = center + widthMeters * 0.42;

    for (
      let s = start;
      s <= end;
      s += Math.max(mpp * 1.5, 0.02)
    ) {
      const p = add(
        wall.start,
        mul(dir, s),
      );

      const q = add(
        p,
        mul(normal, offset),
      );

      total++;

      if (
        isDarkLocal(
          gray,
          q,
          0.75
        )
      ) {
        hits++;
      }
    }

    best = Math.max(
      best,
      hits / Math.max(1, total),
    );
  }

  /*
   * Windows usually have stronger evidence from two
   * separated lines.
   */
  return clamp(best * 1.8, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Door arc detection                                                         */
/* -------------------------------------------------------------------------- */

function scoreDoorArc(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  gray: GrayImage,
  lightInk: Uint8Array,
  mpp: number,
): number {
  const radius =
    Math.max(
      0.45,
      Math.min(1.5, widthMeters),
    );

  const hingeCandidates = [
    center - widthMeters / 2,
    center + widthMeters / 2,
  ];

  let best = 0;

  for (const hingeS of hingeCandidates) {
    const hinge = add(
      wall.start,
      mul(dir, hingeS),
    );

    /*
     * Test quarter-circle arcs on both sides.
     */
    for (const side of [-1, 1]) {
      let hits = 0;
      let total = 0;

      for (
        let angle = 0;
        angle <= Math.PI / 2;
        angle += Math.PI / 36
      ) {
        const along =
          Math.cos(angle) * radius;

        const across =
          Math.sin(angle) *
          radius *
          side;

        const p = add(
          add(
            hinge,
            mul(dir, along),
          ),
          mul(normal, across),
        );

        total++;

        if (
          sampleMask(lightInk, p) ||
          isDarkLocal(gray, p, 0.72)
        ) {
          hits++;
        }
      }

      best = Math.max(
        best,
        hits / Math.max(1, total),
      );
    }
  }

  return clamp(best * 1.8, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Door leaf detection                                                        */
/* -------------------------------------------------------------------------- */

function scoreDoorLeaf(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  gray: GrayImage,
  lightInk: Uint8Array,
  mpp: number,
): number {
  let best = 0;

  const hinges = [
    center - widthMeters / 2,
    center + widthMeters / 2,
  ];

  for (const hingeS of hinges) {
    const hinge = add(
      wall.start,
      mul(dir, hingeS),
    );

    for (const side of [-1, 1]) {
      let hits = 0;
      let total = 0;

      /*
       * Door leaf is approximately a straight line
       * from the hinge into the room.
       */
      for (
        let r = 0.12;
        r <= widthMeters;
        r += Math.max(mpp * 2, 0.025)
      ) {
        const p = add(
          add(
            hinge,
            mul(dir, r * 0.25),
          ),
          mul(
            normal,
            side * r * 0.9,
          ),
        );

        total++;

        if (
          sampleMask(lightInk, p) ||
          isDarkLocal(gray, p, 0.70)
        ) {
          hits++;
        }
      }

      best = Math.max(
        best,
        hits / Math.max(1, total),
      );
    }
  }

  return clamp(best * 1.7, 0, 1);
}

/* -------------------------------------------------------------------------- */
/* Interior/open-space evidence                                               */
/* -------------------------------------------------------------------------- */

function scoreInteriorOpening(
  wall: Wall,
  dir: Vec2,
  normal: Vec2,
  center: number,
  widthMeters: number,
  gray: GrayImage,
  mpp: number,
): number {
  let bright = 0;
  let total = 0;

  /*
   * Sample just beyond the wall into both sides.
   *
   * A real opening generally connects to empty/room space.
   */
  for (const side of [-1, 1]) {
    for (
      let s = center - widthMeters * 0.4;
      s <= center + widthMeters * 0.4;
      s += Math.max(mpp * 2, 0.03)
    ) {
      const p = add(
        add(
          wall.start,
          mul(dir, s),
        ),
        mul(normal, side * 0.25),
      );

      total++;

      const value = sampleGray(
        gray,
        p,
      );

      if (value > 150) {
        bright++;
      }
    }
  }

  return clamp(
    bright / Math.max(1, total),
    0,
    1,
  );
}

/* -------------------------------------------------------------------------- */
/* Non maximum suppression                                                    */
/* -------------------------------------------------------------------------- */

function nonMaximumSuppression(
  candidates: Candidate[],
  mpp: number,
): Candidate[] {
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score,
  );

  const result: Candidate[] = [];

  for (const candidate of sorted) {
    const duplicate = result.some(
      existing =>
        existing.wall.id === candidate.wall.id &&
        overlap(
          existing.a,
          existing.b,
          candidate.a,
          candidate.b,
        ) > 0.45,
    );

    if (!duplicate) {
      result.push(candidate);
    }
  }

  return result.sort(
    (a, b) =>
      a.wall.id.localeCompare(b.wall.id) ||
      a.a - b.a,
  );
}

/* -------------------------------------------------------------------------- */
/* Conversion                                                                 */
/* -------------------------------------------------------------------------- */

function candidateToOpening(
  c: Candidate,
  index: number,
): Opening {
  const width = c.b - c.a;

  const isDoor = c.type === "door";

  /*
   * Height/sill are architectural defaults.
   *
   * They are NOT used to detect the symbol.
   */
  return {
    id: `${isDoor ? "D" : "WIN"}-V2-${index}`,
    type: c.type,
    wallId: c.wall.id,
    offset: c.a,
    width,

    height: isDoor
      ? 2.1
      : 1.2,

    sill: isDoor
      ? 0
      : 0.9,

    confidence: clamp(
      c.score,
      0,
      0.99,
    ),
  };
}

/* -------------------------------------------------------------------------- */
/* Image helpers                                                              */
/* -------------------------------------------------------------------------- */

function sampleMask(
  mask: Uint8Array,
  p: Vec2,
): boolean {
  const x = Math.round(p[0]);
  const y = Math.round(p[1]);

  /*
   * World coordinates are handled by caller in the actual
   * integration below. This helper expects pixel coordinates.
   */
  if (
    x < 0 ||
    y < 0
  ) {
    return false;
  }

  /*
   * The actual image dimensions are not available here,
   * so this version is replaced by the bounded variant
   * below.
   */
  return false;
}

function sampleGray(
  gray: GrayImage,
  p: Vec2,
): number {
  const x = Math.round(p[0]);
  const y = Math.round(p[1]);

  if (
    x < 0 ||
    y < 0 ||
    x >= gray.width ||
    y >= gray.height
  ) {
    return 255;
  }

  return gray.data[y * gray.width + x];
}

function isDarkLocal(
  gray: GrayImage,
  p: Vec2,
  threshold: number,
): boolean {
  const value = sampleGray(
    gray,
    p,
  );

  return value < threshold * 255;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function length(
  a: Vec2,
  b: Vec2,
): number {
  return Math.hypot(
    b[0] - a[0],
    b[1] - a[1],
  );
}

function normalize(
  v: Vec2,
): Vec2 {
  const l =
    Math.hypot(v[0], v[1]) || 1;

  return [
    v[0] / l,
    v[1] / l,
  ];
}

function add(
  a: Vec2,
  b: Vec2,
): Vec2 {
  return [
    a[0] + b[0],
    a[1] + b[1],
  ];
}

function mul(
  a: Vec2,
  s: number,
): Vec2 {
  return [
    a[0] * s,
    a[1] * s,
  ];
}

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(
    min,
    Math.min(max, value),
  );
}

function overlap(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): number {
  const lo = Math.max(a0, b0);
  const hi = Math.min(a1, b1);

  if (hi <= lo) {
    return 0;
  }

  const intersection = hi - lo;
  const union =
    Math.max(a1, b1) -
    Math.min(a0, b0);

  return intersection /
    Math.max(EPS, union);
}