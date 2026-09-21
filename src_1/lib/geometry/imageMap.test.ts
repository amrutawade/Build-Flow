import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { overlayCenter, pixelToWorld, planImageMeshData, worldToPixel } from "./imageMap";
import type { BuildingGraph } from "../models";

describe("imageMap", () => {
  it("round-trips pixels and matches overlay center", () => {
    const graph = {
      metersPerPixel: 0.025,
      imageWidth: 400,
      imageHeight: 300,
      imageOffsetX: 1,
      imageOffsetY: 0.5,
    };
    const [x, y] = pixelToWorld(graph, 40, 260);
    const [px, py] = worldToPixel(graph, x, y);
    assert.ok(Math.abs(px - 40) < 1e-6);
    assert.ok(Math.abs(py - 260) < 1e-6);
    const pose = overlayCenter(graph as BuildingGraph);
    const [cx, cy] = pixelToWorld(graph, 200, 150);
    assert.equal(pose.x, cx);
    assert.equal(pose.z, -cy);
    const mesh = planImageMeshData(graph as BuildingGraph);
    const tl = pixelToWorld(graph, 0, 0);
    assert.equal(mesh.positions[0], tl[0]);
    assert.equal(mesh.positions[2], -tl[1]);
  });
});
