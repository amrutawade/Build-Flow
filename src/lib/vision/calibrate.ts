import sharp from "sharp";

export interface CalibratedImage {
  png: Buffer;
  gray: Buffer;
  width: number;
  height: number;
}

/**
 * Floor-plan calibration.
 *
 * Important:
 * - Do NOT aggressively deskew architectural drawings.
 * - Text, furniture, dimensions and door arcs can dominate global projections.
 * - We only rotate when long horizontal/vertical structures strongly agree.
 */
export async function calibrateImage(input: Buffer): Promise<CalibratedImage> {
  const upright = await sharp(input)
    .rotate()
    .png()
    .toBuffer();

  const angle = await estimateSkew(upright);

  const png =
    Math.abs(angle) < 0.75
      ? upright
      : await sharp(upright)
          .rotate(angle, {
            background: {
              r: 247,
              g: 244,
              b: 236,
              alpha: 1,
            },
          })
          .png()
          .toBuffer();

  const { data, info } = await sharp(png)
    .grayscale()
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    png,
    gray: data,
    width: info.width,
    height: info.height,
  };
}

/**
 * Estimate only small architectural skew.
 *
 * We intentionally keep this conservative.
 */
async function estimateSkew(png: Buffer): Promise<number> {
  const base = await orientationScore(png, 0);

  let bestAngle = 0;
  let bestScore = base.total;

  // Architectural floor plans normally need only small correction.
  for (let a = -4; a <= 4; a += 0.5) {
    if (a === 0) continue;

    const result = await orientationScore(png, a);

    if (result.total > bestScore) {
      bestScore = result.total;
      bestAngle = a;
    }
  }

  const improvement = bestScore / Math.max(base.total, 1);

  /*
   * Be conservative.
   *
   * If the improvement is weak, the "skew" is probably caused by
   * furniture/text/dimensions rather than the actual walls.
   */
  if (improvement < 1.08) {
    return 0;
  }

  if (Math.abs(bestAngle) < 1.0) {
    return 0;
  }

  /*
   * Never make a large correction automatically.
   * A floor plan with >4° rotation is more likely a genuinely rotated
   * drawing than a slightly skewed scan.
   */
  if (Math.abs(bestAngle) > 4) {
    return 0;
  }

  /*
   * Refine around the candidate.
   */
  let refinedAngle = bestAngle;
  let refinedScore = bestScore;

  for (
    let a = bestAngle - 0.5;
    a <= bestAngle + 0.5;
    a += 0.1
  ) {
    const result = await orientationScore(png, a);

    if (result.total > refinedScore) {
      refinedScore = result.total;
      refinedAngle = a;
    }
  }

  const refinedImprovement =
    refinedScore / Math.max(base.total, 1);

  if (refinedImprovement < 1.10) {
    return 0;
  }

  return refinedAngle;
}

interface OrientationScore {
  horizontal: number;
  vertical: number;
  total: number;
}

/**
 * Score architectural alignment.
 *
 * Instead of counting all dark pixels equally, we:
 *
 * 1. crop away drawing margins
 * 2. downsample
 * 3. threshold dark pixels
 * 4. calculate row/column projections
 * 5. reward repeated strong peaks
 */
async function orientationScore(
  png: Buffer,
  angle: number
): Promise<OrientationScore> {
  const { data, info } = await sharp(png)
    .resize({
      width: 500,
      withoutEnlargement: true,
    })
    .grayscale()
    .normalize()
    .rotate(angle, {
      background: {
        r: 255,
        g: 255,
        b: 255,
        alpha: 1,
      },
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

  /*
   * Ignore the outside ~7%.
   *
   * This removes a lot of:
   * - dimension lines
   * - dimension text
   * - titles
   * - labels outside the building
   */
  const x0 = Math.round(w * 0.07);
  const x1 = Math.round(w * 0.93);
  const y0 = Math.round(h * 0.07);
  const y1 = Math.round(h * 0.93);

  const row = new Float64Array(h);
  const col = new Float64Array(w);

  /*
   * Only reasonably dark pixels are considered.
   *
   * This avoids treating shadows/furniture anti-aliasing as
   * architectural lines.
   */
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const gray = data[y * w + x];

      if (gray > 105) continue;

      /*
       * Non-linear weight:
       * very dark architectural lines receive much more weight
       * than gray anti-aliased pixels.
       */
      const ink = Math.pow((105 - gray) / 105, 1.5);

      row[y] += ink;
      col[x] += ink;
    }
  }

  const horizontal = projectionScore(row, w);
  const vertical = projectionScore(col, h);

  /*
   * Both directions matter.
   *
   * A document containing lots of horizontal text should not
   * cause the entire drawing to rotate.
   */
  const total =
    Math.sqrt(Math.max(horizontal, 0)) +
    Math.sqrt(Math.max(vertical, 0));

  return {
    horizontal,
    vertical,
    total,
  };
}

/**
 * Measure repeated strong architectural lines.
 *
 * A single huge peak is not enough.
 */
function projectionScore(
  projection: Float64Array,
  imageLength: number
): number {
  const values = Array.from(projection);

  values.sort((a, b) => b - a);

  if (!values.length) {
    return 0;
  }

  const mean =
    values.reduce((sum, value) => sum + value, 0) /
    values.length;

  if (mean <= 0) {
    return 0;
  }

  /*
   * Use several peaks rather than just the largest one.
   *
   * Walls normally create multiple strong rows/columns.
   */
  const count = Math.max(
    4,
    Math.min(16, Math.round(imageLength * 0.025))
  );

  let score = 0;

  for (let i = 0; i < count && i < values.length; i++) {
    const normalized = values[i] / mean;

    /*
     * Cap extreme peaks so one dimension/text line
     * cannot dominate the entire score.
     */
    const capped = Math.min(normalized, 12);

    score += capped;
  }

  return score / count;
}