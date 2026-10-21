import type {
  BuildingGraph,
  IfcEntityRecord,
  Opening,
  Space,
  Wall,
} from "../models";
import { polygonArea } from "../geometry/area";
import { wallFrame } from "../geometry/frame";

function m(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function enrichGraph(graph: BuildingGraph): BuildingGraph {
  const walls = graph.walls.map(enrichWall);
  const openings = graph.openings.map(enrichOpening);
  const spaces = graph.spaces.map(enrichSpace);
  return {
    ...graph,
    walls,
    openings,
    spaces,
    doors: openings.filter((o) => o.type === "door"),
    windows: openings.filter((o) => o.type === "window"),
  };
}

function enrichWall(wall: Wall): Wall {
  return {
    ...wall,
    length: m(wallFrame(wall).length),
    thickness: m(wall.thickness),
    height: m(wall.height),
    start: [m(wall.start[0]), m(wall.start[1])],
    end: [m(wall.end[0]), m(wall.end[1])],
    ifcClass: "IfcWall",
  };
}

function enrichOpening(opening: Opening): Opening {
  return {
    ...opening,
    ifcClass: opening.type === "door" ? "IfcDoor" : "IfcWindow",
    offset: m(opening.offset),
    width: m(opening.width),
    height: m(opening.height),
    sill: m(opening.sill),
    hinge: opening.hinge,
    swing: opening.swing,
  };
}

function enrichSpace(space: Space): Space {
  return {
    ...space,
    area: m(space.area || polygonArea(space.polygon)),
    ifcClass: "IfcSpace",
  };
}

export function ifcCatalog(graph: BuildingGraph): IfcEntityRecord[] {
  const g = enrichGraph(graph);
  const walls: IfcEntityRecord[] = g.walls.map((wall) => ({
    id: wall.id,
    ifcClass: "IfcWall",
    name: wall.id,
    properties: [
      { label: "Length", value: `${(wall.length ?? 0).toFixed(3)} m` },
      { label: "Height", value: `${wall.height.toFixed(3)} m` },
      { label: "Thickness", value: `${wall.thickness.toFixed(3)} m` },
      { label: "PredefinedType", value: wall.kind === "external" ? "NOTDEFINED (external)" : "NOTDEFINED (internal)" },
      { label: "Start", value: `${wall.start[0].toFixed(3)}, ${wall.start[1].toFixed(3)}` },
      { label: "End", value: `${wall.end[0].toFixed(3)}, ${wall.end[1].toFixed(3)}` },
    ],
  }));

  const openings: IfcEntityRecord[] = g.openings.map((o) => {
    const host = g.walls.find((w) => w.id === o.wallId);
    return {
      id: o.id,
        ifcClass: o.ifcClass ?? (o.type === "door" ? "IfcDoor" : "IfcWindow"),
      name: o.id,
      properties: [
        { label: "OverallWidth", value: `${o.width.toFixed(3)} m` },
        { label: "OverallHeight", value: `${o.height.toFixed(3)} m` },
        { label: "Sill height", value: `${o.sill.toFixed(3)} m` },
        { label: "Offset on wall", value: `${o.offset.toFixed(3)} m` },
        { label: "Hosted in", value: host ? `IfcWall ${host.id}` : o.wallId },
      ],
    };
  });

  const spaces: IfcEntityRecord[] = g.spaces.map((s) => ({
    id: s.id,
    ifcClass: "IfcSpace",
    name: s.name,
    properties: [
      { label: "LongName", value: s.name },
      { label: "NetFloorArea", value: `${(s.area ?? 0).toFixed(2)} m²` },
    ],
  }));

  return [...walls, ...openings, ...spaces];
}

export function findIfcEntity(
  catalog: IfcEntityRecord[],
  id: string | null,
): IfcEntityRecord | null {
  if (!id) return null;
  return catalog.find((e) => e.id === id) ?? null;
}
