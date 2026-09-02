export type Vec2 = [number, number];

export type WallKind = "external" | "internal";
export type OpeningType = "door" | "window";
export type IfcClass =
  | "IfcWall"
  | "IfcDoor"
  | "IfcWindow"
  | "IfcSpace"
  | "IfcOpeningElement";

export interface Wall {
  id: string;
  start: Vec2;
  end: Vec2;
  /** Centerline length in metres (stored in JSON after enrich). */
  length?: number;
  thickness: number;
  height: number;
  kind: WallKind;
  ifcClass?: "IfcWall";
  confidence: number;
  note?: string;
}

export interface Opening {
  id: string;
  type: OpeningType;
  ifcClass?: "IfcDoor" | "IfcWindow";
  wallId: string;
  /** Distance along wall centerline from start, meters. */
  offset: number;
  width: number;
  height: number;
  sill: number;
  confidence: number;
  /** Door hinge at `offset` (start) or `offset + width` (end). */
  hinge?: "start" | "end";
  /** Door swing: +1 toward wall left-normal `(-uy, ux)`, -1 the other side. */
  swing?: 1 | -1;
}

export interface Space {
  id: string;
  name: string;
  polygon: Vec2[];
  /** Floor area in m² (stored in JSON after enrich). */
  area?: number;
  ifcClass?: "IfcSpace";
  confidence: number;
}

export interface BuildingGraph {
  name: string;
  storeyName: string;
  storeyHeight: number;
  /** Image pixels → meters. Present when the graph came from a drawing. */
  metersPerPixel?: number;
  imageWidth?: number;
  imageHeight?: number;
  /** Shift the source image so pixel origin matches graph (0,0). */
  imageOffsetX?: number;
  imageOffsetY?: number;
  warnings: string[];
  walls: Wall[];
  openings: Opening[];
  /** `openings` with `type: "door"` — filled by enrichGraph. */
  doors?: Opening[];
  /** `openings` with `type: "window"` — filled by enrichGraph. */
  windows?: Opening[];
  spaces: Space[];
}

export interface IfcEntityRecord {
  id: string;
  ifcClass: IfcClass;
  name: string;
  properties: { label: string; value: string }[];
}

export interface ConvertOptions {
  storeyHeight: number;
  /** If set, overrides auto scale. Typical brochure: 0.02 (50 px/m). */
  metersPerPixel?: number;
  wallHeight?: number;
}
