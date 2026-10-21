import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichGraph, ifcCatalog } from "./catalog";
import { sampleTwoBhk } from "../samples/twoBhk";

describe("BIM catalog", () => {
  it("stores wall lengths and IFC classes in JSON", () => {
    const graph = enrichGraph(sampleTwoBhk());
    const south = graph.walls.find((w) => w.id === "W-S");
    assert.ok(south);
    assert.equal(south.ifcClass, "IfcWall");
    assert.equal(south.length, 11.4);
    const win = graph.openings.find((o) => o.type === "window");
    assert.equal(win?.ifcClass, "IfcWindow");
    assert.ok((graph.windows?.length ?? 0) >= 1);
    assert.equal(graph.windows?.length, graph.openings.filter((o) => o.type === "window").length);
    const living = graph.spaces.find((s) => s.name.startsWith("Living"));
    assert.ok(living?.area && living.area > 30);
  });

  it("lists IfcWall and IfcWindow for the inspector", () => {
    const rows = ifcCatalog(sampleTwoBhk());
    assert.ok(rows.some((r) => r.ifcClass === "IfcWall"));
    assert.ok(rows.some((r) => r.ifcClass === "IfcWindow"));
    assert.ok(rows.some((r) => r.ifcClass === "IfcDoor"));
    assert.ok(rows.some((r) => r.ifcClass === "IfcSpace"));
  });
});
