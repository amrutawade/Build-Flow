import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import { graphFromCalibrated } from "./fromImage";
import { calibrateImage } from "./calibrate";
import { samplePng, PLAN_PPM } from "../samples/renderPlan";
import { worldToPixel } from "../geometry/imageMap";

describe("plan alignment", () => {
  it("puts wall centerlines on dark pixels of the same image used in 3D", async () => {
    const png = await samplePng();
    const cal = await calibrateImage(png);
    const graph = await graphFromCalibrated(cal, {
      storeyHeight: 3,
      metersPerPixel: 1 / PLAN_PPM,
    });
    const { data, info } = await sharp(cal.png)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let dark = 0;
    let n = 0;
    for (const wall of graph.walls) {
      for (const t of [0.2, 0.5, 0.8]) {
        const x = wall.start[0] + (wall.end[0] - wall.start[0]) * t;
        const y = wall.start[1] + (wall.end[1] - wall.start[1]) * t;
        const [px, py] = worldToPixel(graph, x, y);
        const ix = Math.round(px);
        const iy = Math.round(py);
        if (ix < 2 || iy < 2 || ix >= info.width - 2 || iy >= info.height - 2) continue;
        n++;
        let min = 255;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            min = Math.min(min, data[(iy + dy) * info.width + (ix + dx)]);
          }
        }
        if (min < 90) dark++;
      }
    }
    assert.ok(n > 10, `sampled ${n}`);
    assert.ok(dark / n > 0.7, `only ${(dark / n).toFixed(2)} of wall samples sit on ink`);
  });
});
