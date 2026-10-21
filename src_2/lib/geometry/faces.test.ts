import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sampleTwoBhk } from "../samples/twoBhk";
import { repairTopology, joinOpeningJambs } from "./topology";
import { spacesFromWalls } from "./faces";
import { polygonArea } from "./area";
import { validateGraph } from "../validate/report";

describe("spacesFromWalls", () => {
  it("recovers the 2 BHK rooms from wall topology", () => {
    const graph = repairTopology(sampleTwoBhk());
    const spaces = spacesFromWalls(graph.walls);
    assert.ok(spaces.length >= 6, `rooms ${spaces.length}`);
    const area = spaces.reduce((s, sp) => s + polygonArea(sp.polygon), 0);
    assert.ok(area > 60 && area < 100, `carpet ${area}`);
  });

  it("hosts a door on the wall that spans a colinear gap", () => {
    const graph = repairTopology({
      name: "gap",
      storeyName: "Ground Floor",
      storeyHeight: 3,
      warnings: [],
      walls: [
        {
          id: "A",
          start: [0, 0],
          end: [2, 0],
          thickness: 0.2,
          height: 3,
          kind: "internal",
          confidence: 1,
        },
        {
          id: "B",
          start: [2.8, 0],
          end: [6, 0],
          thickness: 0.2,
          height: 3,
          kind: "internal",
          confidence: 1,
        },
        {
          id: "C",
          start: [0, 0],
          end: [0, 4],
          thickness: 0.2,
          height: 3,
          kind: "internal",
          confidence: 1,
        },
        {
          id: "D",
          start: [6, 0],
          end: [6, 4],
          thickness: 0.2,
          height: 3,
          kind: "internal",
          confidence: 1,
        },
        {
          id: "E",
          start: [0, 4],
          end: [6, 4],
          thickness: 0.2,
          height: 3,
          kind: "internal",
          confidence: 1,
        },
      ],
      openings: [],
      spaces: [],
    });
    const doors = graph.openings.filter((o) => o.type === "door");
    assert.ok(doors.length >= 1, `expected a hosted door, got ${graph.openings.length} openings`);
    const host = graph.walls.find((w) => w.id === doors[0].wallId);
    assert.ok(host, "door must sit on a wall");
    const len = Math.hypot(host!.end[0] - host!.start[0], host!.end[1] - host!.start[1]);
    assert.ok(len > doors[0].width + 0.5, `host ${len} should include the ${doors[0].width}m door`);
  });

  it("closes a rectangle whose four corners miss by about 0.7 m", () => {
    const W = (
      id: string,
      start: [number, number],
      end: [number, number],
    ) => ({
      id,
      start,
      end,
      thickness: 0.2,
      height: 3,
      kind: "external" as const,
      confidence: 1,
    });
    const graph = repairTopology({
      name: "gaps",
      storeyName: "Ground Floor",
      storeyHeight: 3,
      warnings: [],
      walls: [
        W("S", [0.7, 0], [3.3, 0]),
        W("E", [4, 0.7], [4, 2.3]),
        W("N", [0.7, 3], [3.3, 3]),
        W("W", [0, 0.7], [0, 2.3]),
      ],
      openings: [],
      spaces: [],
    });
    const topology = validateGraph({
      ...graph,
      spaces: [
        {
          id: "s",
          name: "Room",
          polygon: [
            [0, 0],
            [4, 0],
            [4, 3],
            [0, 3],
          ],
          confidence: 1,
        },
      ],
    }).checks.find((c) => c.id === "topology");
    assert.equal(topology?.pass, true, topology?.detail);
  });

  it("does not stretch a short interior partition onto far exterior walls", () => {
    const W = (
      id: string,
      start: [number, number],
      end: [number, number],
    ) => ({
      id,
      start,
      end,
      thickness: 0.15,
      height: 3,
      kind: "internal" as const,
      confidence: 1,
    });
    const graph = repairTopology({
      name: "no-stretch",
      storeyName: "Ground Floor",
      storeyHeight: 3,
      warnings: [],
      walls: [
        W("S", [0, 0], [8, 0]),
        W("N", [0, 6], [8, 6]),
        W("W", [0, 0], [0, 6]),
        W("E", [8, 0], [8, 6]),
        W("stub", [3, 2.2], [3, 3.4]),
      ],
      openings: [],
      spaces: [],
    });
    const stub = graph.walls.find((w) => w.id === "stub" || w.id.startsWith("stub"));
    assert.ok(stub, "short partition kept");
    const y0 = Math.min(stub!.start[1], stub!.end[1]);
    const y1 = Math.max(stub!.start[1], stub!.end[1]);
    assert.ok(y0 > 1.5, `stub pulled south to y=${y0}`);
    assert.ok(y1 < 4.5, `stub pulled north to y=${y1}`);
  });

  it("T-joins a partition onto a window jamb", () => {
    const W = (
      id: string,
      start: [number, number],
      end: [number, number],
    ) => ({
      id,
      start,
      end,
      thickness: 0.2,
      height: 3,
      kind: "external" as const,
      confidence: 1,
    });
    const walls = [
      W("S", [0, 0], [6, 0]),
      W("N", [0, 4], [6, 4]),
      W("W", [0, 0], [0, 4]),
      W("E", [6, 0], [6, 4]),
      W("stub", [1.4, 0.45], [1.4, 2.2]),
    ];
    const next = joinOpeningJambs(walls, [
      {
        id: "WIN",
        type: "window",
        wallId: "S",
        offset: 1.5,
        width: 1,
        height: 1.2,
        sill: 0.9,
        confidence: 1,
      },
    ]);
    const stub = next.find((w) => w.id === "stub")!;
    const tip = stub.start[1] < stub.end[1] ? stub.start : stub.end;
    assert.ok(Math.abs(tip[0] - 1.4) < 0.02);
    assert.ok(Math.abs(tip[1]) < 0.04, `T-junction y ${tip[1]}`);
  });

  it("extends a wall that stops short of a corner so a T can meet it", () => {
    const W = (
      id: string,
      start: [number, number],
      end: [number, number],
    ) => ({
      id,
      start,
      end,
      thickness: 0.2,
      height: 3,
      kind: "external" as const,
      confidence: 1,
    });
    const graph = repairTopology({
      name: "corner-window",
      storeyName: "Ground Floor",
      storeyHeight: 3,
      warnings: [],
      walls: [
        W("S", [1.2, 0], [6, 0]),
        W("E", [6, 0], [6, 4]),
        W("N", [6, 4], [0, 4]),
        W("W", [0, 1.2], [0, 4]),
        W("stem", [2.4, 0.5], [2.4, 3.5]),
      ],
      openings: [
        {
          id: "WIN",
          type: "window",
          wallId: "S",
          offset: 0,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
          confidence: 1,
        },
      ],
      spaces: [],
    });
    const topology = validateGraph({
      ...graph,
      spaces: [
        {
          id: "s",
          name: "Room",
          polygon: [
            [0, 0],
            [6, 0],
            [6, 4],
            [0, 4],
          ],
          confidence: 1,
        },
      ],
    }).checks.find((c) => c.id === "topology");
    assert.equal(topology?.pass, true, topology?.detail);
    const win = graph.openings.find((o) => o.type === "window");
    assert.ok(win, "window must stay hosted");
    assert.ok(
      (win?.offset ?? 0) > 0.2,
      `window should sit in from the corner, offset ${win?.offset}`,
    );
  });
});
