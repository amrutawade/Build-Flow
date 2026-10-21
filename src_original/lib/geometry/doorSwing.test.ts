import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { doorLeafEnd } from "./doorSwing";
import type { Opening, Wall } from "../models";

describe("doorSwing", () => {
  it("opens 90 degrees from the hinged jamb toward the arc side", () => {
    const wall: Wall = {
      id: "W",
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
      height: 3,
      kind: "internal",
      confidence: 1,
    };
    const opening: Opening = {
      id: "D",
      type: "door",
      wallId: "W",
      offset: 1,
      width: 0.9,
      height: 2.1,
      sill: 0,
      confidence: 1,
      hinge: "start",
      swing: 1,
    };
    const leaf = doorLeafEnd(opening, wall);
    assert.ok(Math.abs(leaf[0] - 1) < 1e-6);
    assert.ok(Math.abs(leaf[1] - 0.9) < 1e-6);
  });
});
