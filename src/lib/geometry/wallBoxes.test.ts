import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { wallBoxes } from "./wallBoxes";
import type { Opening, Wall } from "../models";

describe("wallBoxes", () => {
  it("cuts a door void so the wall is not a solid rectangle", () => {
    const wall: Wall = {
      id: "W",
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
      height: 3,
      kind: "internal",
      confidence: 1,
    };
    const openings: Opening[] = [
      {
        id: "D",
        type: "door",
        wallId: "W",
        offset: 1,
        width: 0.9,
        height: 2.1,
        sill: 0,
        confidence: 1,
      },
    ];
    const boxes = wallBoxes(wall, openings);
    assert.ok(boxes.some((b) => b.x0 < 1 && b.x1 <= 1.01 && b.y1 === 3));
    assert.ok(boxes.some((b) => b.x0 >= 0.99 && b.x1 <= 1.91 && b.y0 >= 2.09));
    assert.ok(!boxes.some((b) => b.x0 <= 1 && b.x1 >= 1.9 && b.y0 === 0 && b.y1 === 3));
  });
});
