import sharp from "sharp";

export interface CalibratedImage {
  png: Buffer;
  gray: Buffer;
  width: number;
  height: number;
}

/** EXIF orientation + small deskew so wall axes match the 3D overlay image. */
export async function calibrateImage(input: Buffer): Promise<CalibratedImage> {
  const upright = await sharp(input).rotate().png().toBuffer();
  const angle = await estimateSkew(upright);
  const png =
    Math.abs(angle) < 0.25
      ? upright
      : await sharp(upright)
          .rotate(angle, { background: { r: 247, g: 244, b: 236, alpha: 1 } })
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

async function estimateSkew(png: Buffer): Promise<number> {
  const score0 = await axisScore(png, 0);
  let best = 0;
  let bestScore = score0;
  for (let a = -8; a <= 8; a += 1) {
    if (a === 0) continue;
    const score = await axisScore(png, a);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (Math.abs(best) < 1.5 || bestScore < score0 * 1.12) return 0;
  for (let a = best - 0.75; a <= best + 0.75; a += 0.25) {
    const score = await axisScore(png, a);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

async function axisScore(png: Buffer, angle: number): Promise<number> {
  const { data, info } = await sharp(png)
    .resize({ width: 320, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .rotate(angle, { background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rw = info.width;
  const rh = info.height;
  const row = new Float64Array(rh);
  const col = new Float64Array(rw);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const v = 255 - data[y * rw + x];
      row[y] += v;
      col[x] += v;
    }
  }
  return peakiness(row) + peakiness(col);
}

function peakiness(arr: Float64Array): number {
  let max = 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    max = Math.max(max, arr[i]);
    sum += arr[i];
  }
  const mean = sum / arr.length || 1;
  return (max / mean) ** 2;
}
