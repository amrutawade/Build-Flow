import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeIfc4 } from "../ifc/writeIfc4";
import { sampleTwoBhk } from "../samples/twoBhk";
import { exportGraphToIfc } from "../pipeline";
import { ifcGuidFromKey } from "../ifc/guid";
import { polygonArea } from "../geometry/area";

describe("IFC export", () => {
  it("writes a 22-char IFC guid", () => {
    const g = ifcGuidFromKey("wall-1");
    assert.equal(g.length, 22);
    assert.match(g, /^[0-9A-Za-z_$]{22}$/);
    assert.equal(ifcGuidFromKey("wall-1"), g);
  });

  it("emits IFC4 with walls, doors, spaces", () => {
    const graph = sampleTwoBhk();
    const ifc = writeIfc4(graph);
    assert.match(ifc, /FILE_SCHEMA\(\('IFC4'\)\)/);
    assert.match(ifc, /IFCPROJECT\(/);
    assert.match(ifc, /IFCWALL\(/);
    assert.match(ifc, /IFCDOOR\(/);
    assert.match(ifc, /IFCWINDOW\(/);
    assert.match(ifc, /IFCSPACE\(/);
    assert.match(ifc, /IFCOPENINGELEMENT\(/);
    assert.match(ifc, /IFCCOLOURRGB\(/);
    assert.match(ifc, /IFCSURFACESTYLE\(/);
    assert.match(ifc, /IFCSTYLEDITEM\(/);
    assert.match(ifc, /IFCMATERIAL\('Door'/);
    assert.match(ifc, /IFCMATERIAL\('Window'/);
    assert.match(ifc, /IFCRELASSOCIATESMATERIAL\(/);
    assert.match(ifc, /IFCSLAB\(/);
    const doors = ifc.match(/IFCDOOR\(/g)?.length ?? 0;
    const windows = ifc.match(/IFCWINDOW\(/g)?.length ?? 0;
    assert.ok(doors >= 1, `doors ${doors}`);
    assert.ok(windows >= 1, `windows ${windows}`);
    const walls = ifc.match(/IFCWALL\(/g)?.length ?? 0;
    assert.ok(walls >= graph.walls.length);
  });

  it("is deterministic", () => {
    const graph = sampleTwoBhk();
    assert.equal(exportGraphToIfc(graph), exportGraphToIfc(graph));
  });

  it("keeps sample room areas in range", () => {
    const living = sampleTwoBhk().spaces.find((s) => s.name.startsWith("Living"));
    assert.ok(living);
    const area = polygonArea(living.polygon);
    assert.ok(area > 30 && area < 35);
  });
});
