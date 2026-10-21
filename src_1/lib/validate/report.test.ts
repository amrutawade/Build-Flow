import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateGraph } from "./report";
import { enrichGraph } from "../bim/catalog";
import { repairTopology } from "../geometry/topology";
import { sampleTwoBhk } from "../samples/twoBhk";

describe("validation", () => {
  it("passes the sample 2 BHK after topology", () => {
    const graph = enrichGraph(repairTopology(sampleTwoBhk()));
    const report = validateGraph(graph);
    const topology = report.checks.find((c) => c.id === "topology");
    const spaces = report.checks.find((c) => c.id === "spaces");
    const openings = report.checks.find((c) => c.id === "openings");
    assert.equal(topology?.pass, true);
    assert.equal(spaces?.pass, true);
    assert.equal(openings?.pass, true);
    assert.equal(report.ok, true);
  });

  it("counts a T-junction as connected even if the stem is not a corner", () => {
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
      kind: "internal" as const,
      confidence: 1,
    });
    const report = validateGraph({
      name: "T",
      storeyName: "Ground Floor",
      storeyHeight: 3,
      warnings: [],
      walls: [
        W("S", [0, 0], [4, 0]),
        W("N", [0, 3], [4, 3]),
        W("W", [0, 0], [0, 3]),
        W("E", [4, 0], [4, 3]),
        W("stem", [2, 0], [2, 3]),
      ],
      openings: [],
      spaces: [
        {
          id: "s",
          name: "Room",
          polygon: [
            [0, 0],
            [2, 0],
            [2, 3],
            [0, 3],
          ],
          confidence: 1,
        },
      ],
    });
    const topology = report.checks.find((c) => c.id === "topology");
    assert.equal(topology?.pass, true);
  });

  it("closes corners and hosts a window after topology", () => {
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
        W("S1", [0, 0], [2, 0]),
        W("S2", [2.9, 0], [6, 0]),
        W("E1", [6, 0], [6, 1.5]),
        W("E2", [6, 2.4], [6, 4]),
        W("N1", [6, 4], [3.1, 4]),
        W("N2", [2.2, 4], [0, 4]),
        W("W", [0, 4], [0, 0]),
      ],
      openings: [],
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
    });
    const topology = validateGraph({
      ...graph,
      spaces: graph.spaces.length
        ? graph.spaces
        : [
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
    assert.ok(
      graph.openings.length >= 1,
      `expected hosted openings, got ${graph.openings.length}`,
    );
  });
});
