import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { graphFromImage } from "./fromImage";
import { samplePng, PLAN_PPM } from "../samples/renderPlan";
import { sampleTwoBhk } from "../samples/twoBhk";
import { wallFrame } from "../geometry/frame";

describe("graphFromImage", () => {
  it("extrudes the sample plan with real wall height and a wall grid", async () => {
    const png = await samplePng();
    const graph = await graphFromImage(png, {
      storeyHeight: 0,
      metersPerPixel: 1 / PLAN_PPM,
    });
    assert.equal(graph.storeyHeight, 3);
    assert.ok(graph.walls.length >= 8, `expected walls, got ${graph.walls.length}`);
    assert.ok(graph.walls.every((w) => w.height === 3));
    const truth = sampleTwoBhk();
    const spanX = Math.max(...graph.walls.flatMap((w) => [w.start[0], w.end[0]]));
    const truthX = Math.max(...truth.walls.flatMap((w) => [w.start[0], w.end[0]]));
    assert.ok(
      Math.abs(spanX - truthX) < 2.5,
      `plan width ${spanX} vs truth ${truthX}`,
    );
    const throughLiving = graph.walls.filter((w) => {
      const y = (w.start[1] + w.end[1]) / 2;
      const x0 = Math.min(w.start[0], w.end[0]);
      const x1 = Math.max(w.start[0], w.end[0]);
      return Math.abs(w.start[1] - w.end[1]) < 0.2 && y > 3.8 && y < 4.6 && x0 < 1 && x1 > 10;
    });
    assert.equal(
      throughLiving.length,
      0,
      "must not draw one wall through the whole plan at the bedroom split",
    );
    assert.ok(graph.spaces.length >= 4, `rooms ${graph.spaces.length}`);
    const doors = graph.openings.filter((o) => o.type === "door");
    const windows = graph.openings.filter((o) => o.type === "window");
    assert.ok(doors.length >= 4, `doors ${doors.length}`);
    assert.ok(windows.length >= 1, `windows ${windows.length}`);
    assert.equal(graph.windows?.length, windows.length);
    const kitchenSplit = graph.walls.filter((w) => {
      const y = (w.start[1] + w.end[1]) / 2;
      const x0 = Math.min(w.start[0], w.end[0]);
      const x1 = Math.max(w.start[0], w.end[0]);
      return (
        Math.abs(w.start[1] - w.end[1]) < 0.25 &&
        y > 3.6 &&
        y < 4.5 &&
        x0 < 10 &&
        x1 > 11.5
      );
    });
    assert.ok(kitchenSplit.length >= 1, "short kitchen wall should be detected");
    const north = graph.walls.filter((w) => {
      const y = (w.start[1] + w.end[1]) / 2;
      const x0 = Math.min(w.start[0], w.end[0]);
      const x1 = Math.max(w.start[0], w.end[0]);
      return Math.abs(w.start[1] - w.end[1]) < 0.3 && y > 7.8 && x1 - x0 > 4;
    });
    assert.ok(north.length >= 1, "north exterior wall should be detected");
    const margin = 40 / PLAN_PPM;
    let aligned = 0;
    for (const o of truth.openings) {
      const wall = truth.walls.find((w) => w.id === o.wallId);
      if (!wall) continue;
      const f = wallFrame(wall);
      const tx = wall.start[0] + f.ux * (o.offset + o.width / 2) + margin;
      const ty = wall.start[1] + f.uy * (o.offset + o.width / 2) + margin;
      if (
        graph.openings.some((d) => {
          const host = graph.walls.find((w) => w.id === d.wallId);
          if (!host) return false;
          const hf = wallFrame(host);
          const dx = host.start[0] + hf.ux * (d.offset + d.width / 2);
          const dy = host.start[1] + hf.uy * (d.offset + d.width / 2);
          return Math.hypot(dx - tx, dy - ty) < 0.85;
        })
      ) {
        aligned++;
      }
    }
    assert.ok(
      aligned >= 6,
      `only ${aligned}/${truth.openings.length} openings sit on the drawing gaps`,
    );
  });
});
