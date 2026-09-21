export type Vec2 = [number, number];

export type WallKind = "external" | "internal";

export type OpeningType = "door" | "window" | unknown;

export type GeometrySource =
  | "pdf-vector"
  | "pdf-raster"
  | "image"
  | "inferred";

export type WallEvidence =
  | "filled-band"
  | "parallel-boundaries"
  | "single-line"
  | "rectangle"
  | "raster-line"
  | "inferred";

export type OpeningEvidence =
  | "door-symbol"
  | "window-symbol"
  | "parallel-gap"
  | "vector-geometry"
  | "raster-geometry"
  | "inferred";

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
  length?: number;
  thickness: number;
  height: number;
  kind: WallKind;
  ifcClass?: "IfcWall";
  confidence: number;
  note?: string;
  source?: GeometrySource;
  evidence?: WallEvidence;
  sourceThickness?: number;
  reconstructed?: boolean;
}

export interface Opening {
  id: string;
  type: OpeningType;
  ifcClass?: "IfcDoor" | "IfcWindow";
  wallId: string;

  /**
   * Distance along wall centerline from start, in meters.
   */
  offset: number;

  width: number;
  height: number;
  sill: number;

  confidence: number;

  hinge?: "start" | "end";
  swing?: 1 | -1;

  source?: GeometrySource;
  evidence?: OpeningEvidence;
}

export interface Space {
  id: string;
  name: string;
  polygon: Vec2[];
  area?: number;
  ifcClass?: "IfcSpace";
  confidence: number;
}

export interface StoreyGraph {
  storeyName: string;
  elevation: number;
  storeyHeight: number;
  metersPerPixel?: number;
  metersPerPdfUnit?: number;
  imageWidth?: number;
  imageHeight?: number;
  imageOffsetX?: number;
  imageOffsetY?: number;
  warnings: string[];
  walls: Wall[];
  openings: Opening[];
  doors?: Opening[];
  windows?: Opening[];
  spaces: Space[];
}

export interface BuildingGraph {
  name: string;
  storeyName: string;
  storeyHeight: number;

  /**
   * Used for raster/image input.
   */
  metersPerPixel?: number;

  /**
   * Used for native/vector PDF input.
   */
  metersPerPdfUnit?: number;

  imageWidth?: number;
  imageHeight?: number;

  imageOffsetX?: number;
  imageOffsetY?: number;

  warnings: string[];

  walls: Wall[];
  openings: Opening[];

  doors?: Opening[];
  windows?: Opening[];

  spaces: Space[];

  /** Multi-storey BIM. The root fields remain the first/active storey for backwards compatibility. */
  storeys?: StoreyGraph[];
}

export interface IfcEntityRecord {
  id: string;
  ifcClass: IfcClass;
  name: string;
  properties: {
    label: string;
    value: string;
  }[];
}

export interface ConvertOptions {
  storeyHeight: number;

  /**
   * Used only for raster/image input.
   */
  metersPerPixel?: number;

  /**
   * Used only for native/vector PDF input.
   *
   * PDF coordinates are NOT image pixels.
   */
  metersPerPdfUnit?: number;

  /**
   * Maximum working resolution used by the raster
   * floor-plan detector.
   *
   * Normal images: 1600 is usually enough.
   * High-resolution scanned PDFs: 2200–2400
   * preserves small door/window symbols better.
   */
  rasterWorkMax?: number;

  wallHeight?: number;

  /** For PDFs: process every floor-plan page as a storey. */
  allPages?: boolean;
  /** Optional names supplied in page order. */
  storeyNames?: string[];
}