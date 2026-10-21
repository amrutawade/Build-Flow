import type { BuildingGraph, Opening, Vec2, Wall } from "../models";
import { polygonArea } from "../geometry/area";
import { wallFrame } from "../geometry/frame";
import { fmt, ifcGuidFromKey } from "./guid";

type Ref = number;

/**
 * Writes IFC4 CoordinationView-style STEP.
 * Geometry comes from the building graph (meters). Nothing here invents coordinates.
 */
export function writeIfc4(graph: BuildingGraph): string {
  const w = new Writer(graph.name);
  w.writeModel(graph);
  return w.serialize();
}

const SURFACE = {
  wallExternal: 0xd8d0c0,
  wallInternal: 0xb7ae9c,
  door: 0x6b3f24,
  window: 0x7ec8dc,
  space: 0xa8c4a0,
  slab: 0x8a8580,
} as const;

function collectOpenings(graph: BuildingGraph): Opening[] {
  const byId = new Map<string, Opening>();
  for (const o of graph.openings) byId.set(o.id, o);
  for (const o of graph.doors ?? []) {
    byId.set(o.id, { ...o, type: "door" });
  }
  for (const o of graph.windows ?? []) {
    byId.set(o.id, { ...o, type: "window" });
  }
  return [...byId.values()];
}

class Writer {
  private nextId = 1;
  private lines: string[] = [];
  private seq = 0;
  private readonly now = 1_710_000_000;
  private readonly projectName: string;
  private readonly painted = new Map<string, { style: Ref; material: Ref }>();
  private readonly byMaterial = new Map<Ref, Ref[]>();

  constructor(projectName: string) {
    this.projectName = projectName;
  }

  private id(): Ref {
    return this.nextId++;
  }

  private emit(entity: string): Ref {
    const n = this.id();
    this.lines.push(`#${n}=${entity};`);
    return n;
  }

  private str(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private guid(key?: string): string {
    this.seq += 1;
    return this.str(ifcGuidFromKey(`${this.projectName}:${key ?? "ent"}:${this.seq}`));
  }

  private pt2(p: Vec2): Ref {
    return this.emit(`IFCCARTESIANPOINT((${fmt(p[0])},${fmt(p[1])}))`);
  }

  private pt3(x: number, y: number, z: number): Ref {
    return this.emit(
      `IFCCARTESIANPOINT((${fmt(x)},${fmt(y)},${fmt(z)}))`,
    );
  }

  private dir(x: number, y: number, z: number): Ref {
    return this.emit(`IFCDIRECTION((${fmt(x)},${fmt(y)},${fmt(z)}))`);
  }

  private axis3(
    origin: Ref,
    axis?: Ref,
    refDir?: Ref,
  ): Ref {
    return this.emit(
      `IFCAXIS2PLACEMENT3D(#${origin},${axis ? `#${axis}` : "$"},${refDir ? `#${refDir}` : "$"})`,
    );
  }

  private axis2(origin: Ref, refDir?: Ref): Ref {
    return this.emit(
      `IFCAXIS2PLACEMENT2D(#${origin},${refDir ? `#${refDir}` : "$"})`,
    );
  }

  writeModel(graph: BuildingGraph): void {
    const appOrg = this.emit(
      `IFCORGANIZATION($,${this.str("BuildFlow")},${this.str("plan2ifc")},$,$)`,
    );
    const app = this.emit(
      `IFCAPPLICATION(#${appOrg},${this.str("0.1.0")},${this.str("plan2ifc")},${this.str("plan2ifc")})`,
    );
    const person = this.emit(`IFCPERSON($,${this.str("Owner")},$,$,$,$,$,$)`);
    const org = this.emit(`IFCORGANIZATION($,${this.str("Owner")},$,$,$)`);
    const pao = this.emit(`IFCPERSONANDORGANIZATION(#${person},#${org},$)`);
    const oh = this.emit(
      `IFCOWNERHISTORY(#${pao},#${app},$,.ADDED.,$,$,$,${this.now})`,
    );

    const origin = this.pt3(0, 0, 0);
    const zDir = this.dir(0, 0, 1);
    const xDir = this.dir(1, 0, 0);
    const world = this.axis3(origin, zDir, xDir);
    const worldCtx = this.emit(
      `IFCGEOMETRICREPRESENTATIONCONTEXT($,${this.str("Model")},3,1.0E-5,#${world},$)`,
    );
    const bodyCtx = this.emit(
      `IFCGEOMETRICREPRESENTATIONSUBCONTEXT(${this.str("Body")},${this.str("Model")},*,*,*,*,#${worldCtx},$,.MODEL_VIEW.,$)`,
    );
    const metre = this.emit(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
    const sqm = this.emit(`IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
    const units = this.emit(`IFCUNITASSIGNMENT((#${metre},#${sqm}))`);

    const project = this.emit(
      `IFCPROJECT(${this.guid()},#${oh},${this.str(graph.name)},${this.str("Generated from 2D floor plan")},$,$,$,(#${worldCtx}),#${units})`,
    );
    const sitePlace = this.localPlacement();
    const site = this.emit(
      `IFCSITE(${this.guid()},#${oh},${this.str("Site")},$,$,#${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`,
    );
    const buildingPlace = this.localPlacement(sitePlace);
    const building = this.emit(
      `IFCBUILDING(${this.guid()},#${oh},${this.str("Building")},$,$,#${buildingPlace},$,$,.ELEMENT.,$,$,$)`,
    );
    const storeyPlacement = this.localPlacement(buildingPlace);
    const storey = this.emit(
      `IFCBUILDINGSTOREY(${this.guid()},#${oh},${this.str(graph.storeyName)},$,$,#${storeyPlacement},$,$,.ELEMENT.,${fmt(0)})`,
    );

    this.emit(
      `IFCRELAGGREGATES(${this.guid()},#${oh},$,$,#${project},(#${site}))`,
    );
    this.emit(
      `IFCRELAGGREGATES(${this.guid()},#${oh},$,$,#${site},(#${building}))`,
    );
    this.emit(
      `IFCRELAGGREGATES(${this.guid()},#${oh},$,$,#${building},(#${storey}))`,
    );

    const productIds: Ref[] = [];
    const wallByKey = new Map<string, Ref>();

    for (const wall of graph.walls) {
      const wallRef = this.writeWall(wall, oh, storeyPlacement, bodyCtx);
      productIds.push(wallRef);
      wallByKey.set(wall.id, wallRef);
    }

    for (const opening of collectOpenings(graph)) {
      const hostWall = graph.walls.find((x) => x.id === opening.wallId);
      const host = hostWall ? wallByKey.get(hostWall.id) : undefined;
      if (!host || !hostWall) continue;
      const { fillerRef } = this.writeOpening(
        opening,
        hostWall,
        host,
        oh,
        storeyPlacement,
        bodyCtx,
      );
      productIds.push(fillerRef);
    }

    for (const space of graph.spaces) {
      productIds.push(
        this.writeSpace(space, graph.storeyHeight, oh, storeyPlacement, bodyCtx),
      );
    }

    const slab = this.writeSlab(graph, oh, storeyPlacement, bodyCtx);
    if (slab) productIds.push(slab);

    if (productIds.length > 0) {
      this.emit(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE(${this.guid()},#${oh},$,$,(${productIds.map((n) => `#${n}`).join(",")}),#${storey})`,
      );
    }

    for (const [material, products] of this.byMaterial) {
      if (products.length === 0) continue;
      this.emit(
        `IFCRELASSOCIATESMATERIAL(${this.guid()},#${oh},$,$,(${products.map((n) => `#${n}`).join(",")}),#${material})`,
      );
    }
  }

  private hexRgb(hex: number): string {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    return `${fmt(r)},${fmt(g)},${fmt(b)}`;
  }

  /** IFC4 surface colour + material so viewers show walls/doors/windows. */
  private appearance(
    name: string,
    hex: number,
    bodyCtx: Ref,
    transparency = 0,
  ): { style: Ref; material: Ref } {
    const hit = this.painted.get(name);
    if (hit) return hit;
    const rgb = this.emit(
      `IFCCOLOURRGB(${this.str(name)},${this.hexRgb(hex)})`,
    );
    const shading = this.emit(
      `IFCSURFACESTYLERENDERING(#${rgb},${fmt(transparency)},$,$,$,$,$,$,.NOTDEFINED.)`,
    );
    const style = this.emit(
      `IFCSURFACESTYLE(${this.str(name)},.BOTH.,(#${shading}))`,
    );
    const material = this.emit(`IFCMATERIAL(${this.str(name)},$,$)`);
    const styled = this.emit(`IFCSTYLEDITEM($,(#${style}),$)`);
    const styledRep = this.emit(
      `IFCSTYLEDREPRESENTATION(#${bodyCtx},${this.str("Style")},${this.str("Material")},(#${styled}))`,
    );
    this.emit(
      `IFCMATERIALDEFINITIONREPRESENTATION($,$,(#${styledRep}),#${material})`,
    );
    const pack = { style, material };
    this.painted.set(name, pack);
    return pack;
  }

  private paintSolid(solid: Ref, style: Ref): void {
    this.emit(`IFCSTYLEDITEM(#${solid},(#${style}),$)`);
  }

  private assignMaterial(product: Ref, material: Ref): void {
    const list = this.byMaterial.get(material) ?? [];
    list.push(product);
    this.byMaterial.set(material, list);
  }

  private localPlacement(parentPlacement?: Ref): Ref {
    const origin = this.pt3(0, 0, 0);
    const axis = this.axis3(origin);
    return this.emit(
      `IFCLOCALPLACEMENT(${parentPlacement ? `#${parentPlacement}` : "$"},#${axis})`,
    );
  }

  private writeWall(
    wall: Wall,
    oh: Ref,
    storeyPlacement: Ref,
    bodyCtx: Ref,
  ): Ref {
    const { dx, dy, length, ux, uy } = wallFrame(wall);
    const origin = this.pt3(wall.start[0], wall.start[1], 0);
    const axis = this.dir(0, 0, 1);
    const ref = this.dir(ux, uy, 0);
    const placement3 = this.axis3(origin, axis, ref);
    const placement = this.emit(
      `IFCLOCALPLACEMENT(#${storeyPlacement},#${placement3})`,
    );

    const profileOrigin = this.pt2([length / 2, 0]);
    const profilePos = this.axis2(profileOrigin);
    const profile = this.emit(
      `IFCRECTANGLEPROFILEDEF(.AREA.,${this.str(wall.id)},#${profilePos},${fmt(length)},${fmt(wall.thickness)})`,
    );
    const solidPos = this.axis3(this.pt3(0, 0, 0));
    const extrudeDir = this.dir(0, 0, 1);
    const solid = this.emit(
      `IFCEXTRUDEDAREASOLID(#${profile},#${solidPos},#${extrudeDir},${fmt(wall.height)})`,
    );
    const look = this.appearance(
      wall.kind === "external" ? "External wall" : "Internal wall",
      wall.kind === "external" ? SURFACE.wallExternal : SURFACE.wallInternal,
      bodyCtx,
    );
    this.paintSolid(solid, look.style);
    const shape = this.emit(
      `IFCSHAPEREPRESENTATION(#${bodyCtx},${this.str("Body")},${this.str("SweptSolid")},(#${solid}))`,
    );
    const def = this.emit(
      `IFCPRODUCTDEFINITIONSHAPE($,$,(#${shape}))`,
    );

    void dx;
    void dy;
    const wallRef = this.emit(
      `IFCWALL(${this.guid()},#${oh},${this.str(wall.id)},${this.str(`${wall.kind} wall`)},$,#${placement},#${def},$,.NOTDEFINED.)`,
    );
    this.assignMaterial(wallRef, look.material);
    return wallRef;
  }

  private writeOpening(
    opening: Opening,
    wall: Wall,
    wallRef: Ref,
    oh: Ref,
    storeyPlacement: Ref,
    bodyCtx: Ref,
  ): { openingRef: Ref; fillerRef: Ref } {
    const { length, ux, uy } = wallFrame(wall);
    const t = Math.min(Math.max(opening.offset, 0), Math.max(length - opening.width, 0));
    const mid = t + opening.width / 2;
    const cx = wall.start[0] + ux * mid;
    const cy = wall.start[1] + uy * mid;
    const z = opening.type === "window" ? opening.sill : 0;

    const origin = this.pt3(cx, cy, z);
    const axis = this.dir(0, 0, 1);
    const ref = this.dir(ux, uy, 0);
    const placement3 = this.axis3(origin, axis, ref);
    const placement = this.emit(
      `IFCLOCALPLACEMENT(#${storeyPlacement},#${placement3})`,
    );

    const profileOrigin = this.pt2([0, 0]);
    const profilePos = this.axis2(profileOrigin);
    const profile = this.emit(
      `IFCRECTANGLEPROFILEDEF(.AREA.,${this.str(opening.id)},#${profilePos},${fmt(opening.width)},${fmt(wall.thickness + 0.02)})`,
    );
    const solidPos = this.axis3(this.pt3(0, 0, 0));
    const extrudeDir = this.dir(0, 0, 1);
    const voidSolid = this.emit(
      `IFCEXTRUDEDAREASOLID(#${profile},#${solidPos},#${extrudeDir},${fmt(opening.height)})`,
    );
    const voidShape = this.emit(
      `IFCSHAPEREPRESENTATION(#${bodyCtx},${this.str("Body")},${this.str("SweptSolid")},(#${voidSolid}))`,
    );
    const voidDef = this.emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${voidShape}))`);

    const openingRef = this.emit(
      `IFCOPENINGELEMENT(${this.guid()},#${oh},${this.str(`${opening.id}-void`)},$,$,#${placement},#${voidDef},$,.OPENING.)`,
    );
    this.emit(
      `IFCRELVOIDSELEMENT(${this.guid()},#${oh},$,$,#${wallRef},#${openingRef})`,
    );

    const nx = -uy;
    const ny = ux;
    const sign = opening.type === "door" ? (opening.swing ?? 1) : 1;
    const out = opening.type === "door" ? (wall.thickness * 0.55 + 0.04) * sign : 0;
    const fillOrigin = this.pt3(cx + nx * out, cy + ny * out, z);
    const fillPlace3 = this.axis3(fillOrigin, axis, ref);
    const fillPlacement = this.emit(
      `IFCLOCALPLACEMENT(#${storeyPlacement},#${fillPlace3})`,
    );
    const leafThick = opening.type === "door" ? 0.045 : 0.04;
    const fillW =
      opening.type === "door"
        ? Math.min(0.95, Math.max(0.5, opening.width - 0.06))
        : Math.max(0.3, opening.width - 0.08);
    const fillH = Math.max(0.2, opening.height - (opening.type === "door" ? 0.08 : 0.08));
    const fillProfile = this.emit(
      `IFCRECTANGLEPROFILEDEF(.AREA.,${this.str(`${opening.id}-fill`)},#${profilePos},${fmt(fillW)},${fmt(leafThick)})`,
    );
    const fillSolid = this.emit(
      `IFCEXTRUDEDAREASOLID(#${fillProfile},#${this.axis3(this.pt3(0, 0, 0))},#${extrudeDir},${fmt(fillH)})`,
    );
    const look =
      opening.type === "door"
        ? this.appearance("Door", SURFACE.door, bodyCtx)
        : this.appearance("Window", SURFACE.window, bodyCtx, 0.45);
    this.paintSolid(fillSolid, look.style);
    const fillShape = this.emit(
      `IFCSHAPEREPRESENTATION(#${bodyCtx},${this.str("Body")},${this.str("SweptSolid")},(#${fillSolid}))`,
    );
    const fillDef = this.emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${fillShape}))`);

    const fillerRef =
      opening.type === "door"
        ? this.emit(
            `IFCDOOR(${this.guid()},#${oh},${this.str(opening.id)},$,$,#${fillPlacement},#${fillDef},$,${fmt(opening.height)},${fmt(opening.width)},.DOOR.,.NOTDEFINED.,$)`,
          )
        : this.emit(
            `IFCWINDOW(${this.guid()},#${oh},${this.str(opening.id)},$,$,#${fillPlacement},#${fillDef},$,${fmt(opening.height)},${fmt(opening.width)},.WINDOW.,.NOTDEFINED.,$)`,
          );
    this.assignMaterial(fillerRef, look.material);
    this.emit(
      `IFCRELFILLSELEMENT(${this.guid()},#${oh},$,$,#${openingRef},#${fillerRef})`,
    );

    return { openingRef, fillerRef };
  }

  private writeSpace(
    space: BuildingGraph["spaces"][number],
    height: number,
    oh: Ref,
    storeyPlacement: Ref,
    bodyCtx: Ref,
  ): Ref {
    const pts = space.polygon.map((p) => this.pt2(p));
    if (pts.length > 0 && pts[0] !== pts[pts.length - 1]) {
      pts.push(pts[0]);
    }
    const poly = this.emit(
      `IFCPOLYLINE((${pts.map((n) => `#${n}`).join(",")}))`,
    );
    const profile = this.emit(
      `IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,${this.str(space.id)},#${poly})`,
    );
    const origin = this.pt3(0, 0, 0);
    const solidPos = this.axis3(origin);
    const extrudeDir = this.dir(0, 0, 1);
    const solid = this.emit(
      `IFCEXTRUDEDAREASOLID(#${profile},#${solidPos},#${extrudeDir},${fmt(height)})`,
    );
    const look = this.appearance("Space", SURFACE.space, bodyCtx, 0.7);
    this.paintSolid(solid, look.style);
    const shape = this.emit(
      `IFCSHAPEREPRESENTATION(#${bodyCtx},${this.str("Body")},${this.str("SweptSolid")},(#${solid}))`,
    );
    const def = this.emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shape}))`);
    const placement = this.emit(
      `IFCLOCALPLACEMENT(#${storeyPlacement},#${this.axis3(origin)})`,
    );
    const area = polygonArea(space.polygon);
    const spaceRef = this.emit(
      `IFCSPACE(${this.guid()},#${oh},${this.str(space.name)},${this.str(`${area.toFixed(2)} m2`)},$,#${placement},#${def},$,.ELEMENT.,.INTERNAL.,$)`,
    );
    this.assignMaterial(spaceRef, look.material);
    const areaQty = this.emit(
      `IFCQUANTITYAREA(${this.str("NetFloorArea")},$,$,${fmt(area)})`,
    );
    const elemQty = this.emit(
      `IFCELEMENTQUANTITY(${this.guid()},#${oh},${this.str("BaseQuantities")},$,${this.str("plan2ifc")},(#${areaQty}))`,
    );
    this.emit(
      `IFCRELDEFINESBYPROPERTIES(${this.guid()},#${oh},$,$,(#${spaceRef}),#${elemQty})`,
    );
    return spaceRef;
  }

  private writeSlab(
    graph: BuildingGraph,
    oh: Ref,
    storeyPlacement: Ref,
    bodyCtx: Ref,
  ): Ref | null {
    if (graph.walls.length === 0) return null;
    const xs = graph.walls.flatMap((w) => [w.start[0], w.end[0]]);
    const ys = graph.walls.flatMap((w) => [w.start[1], w.end[1]]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(0.5, maxX - minX + 0.4);
    const d = Math.max(0.5, maxY - minY + 0.4);
    const origin = this.pt3((minX + maxX) / 2, (minY + maxY) / 2, -0.12);
    const axis = this.dir(0, 0, 1);
    const ref = this.dir(1, 0, 0);
    const placement = this.emit(
      `IFCLOCALPLACEMENT(#${storeyPlacement},#${this.axis3(origin, axis, ref)})`,
    );
    const profile = this.emit(
      `IFCRECTANGLEPROFILEDEF(.AREA.,${this.str("SLAB")},#${this.axis2(this.pt2([0, 0]))},${fmt(w)},${fmt(d)})`,
    );
    const solid = this.emit(
      `IFCEXTRUDEDAREASOLID(#${profile},#${this.axis3(this.pt3(0, 0, 0))},#${this.dir(0, 0, 1)},${fmt(0.12)})`,
    );
    const look = this.appearance("Floor slab", SURFACE.slab, bodyCtx);
    this.paintSolid(solid, look.style);
    const shape = this.emit(
      `IFCSHAPEREPRESENTATION(#${bodyCtx},${this.str("Body")},${this.str("SweptSolid")},(#${solid}))`,
    );
    const def = this.emit(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${shape}))`);
    const slabRef = this.emit(
      `IFCSLAB(${this.guid()},#${oh},${this.str("Floor")},${this.str("Storey slab")},$,#${placement},#${def},$,.FLOOR.)`,
    );
    this.assignMaterial(slabRef, look.material);
    return slabRef;
  }

  serialize(): string {
    return [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      `FILE_NAME('${this.projectName.replace(/'/g, "")}.ifc','2026-01-01T00:00:00',('plan2ifc'),('BuildFlow'),'plan2ifc','plan2ifc','');`,
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      ...this.lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n");
  }
}
