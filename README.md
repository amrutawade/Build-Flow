# plan2ifc — floor plan image → IFC4

End goal from the BuildFlow assignment: a **JPG/PNG of a typical Indian 2 BHK** becomes a **valid, semantic `.ifc` file** — `IfcWall` with centerline, thickness and height; `IfcDoor` / `IfcWindow` hosted in those walls; `IfcSpace` with name and area. Not a mesh. Not a tracing.

Geometry is computed from pixels and topology. An LLM is not used for coordinates.

## Pipeline

| Step | What we do |
| --- | --- |
| 01 Input | PNG / JPEG (PDF/DXF: export a raster for this build) |
| 02 Calibrate | Grayscale, threshold; scale from wall bbox or user metres-per-pixel |
| 03 Walls | Orthogonal projection peaks → centerlines |
| 04 Topology | Snap corners, split T-junctions, no 3 cm gaps target |
| 05 Openings | Gaps on wall runs → hosted doors/windows |
| 06 Rooms | Flood-fill closed cells; heuristic names |
| 07 Confirm | **Human gate** — fix labels, scale, drop uncertain walls |
| 08 3D | Extrude storey from the confirmed JSON |
| 09 IFC | IFC4 STEP (`src/lib/ifc/writeIfc4.ts`) |
| 10 Validate | Junctions, hosted openings, spaces, confidence flags |

Target at this stage is **70–80%**, not 99%. Uncertain walls are flagged, not silently turned into a broken building.

## Run

```bash
npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Load sample 2 BHK** — benchmark plan, already solved.
- **Upload a drawing** — stops at **Confirm & write IFC**. Set a known wall length, rename rooms, remove low-confidence walls, then solve.
- **Save BIM JSON** / **Load BIM JSON** — the structured building is the source of 3D and IFC.
- Click an `IfcWall` or `IfcWindow` to inspect length, thickness, host wall.

Open the downloaded `.ifc` in BIM Vision, BlenderBIM, or Revit.

## What we check

- Wall recall vs phantom lines (confidence + HITL delete)
- Topology: endpoints within 30 mm
- Openings hosted on a wall
- IfcSpace per closed room with area
- Same JSON → same IFC (stable GUIDs)

## What breaks first

Skewed phone photos, dimension ticks read as walls, missing printed scale, door swings with no wall gap. Fix those in the confirm gate; do not ask a model for `(x, y)` coordinates.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/sample` | 2 BHK graph + PNG + IFC + validation |
| `POST` | `/api/analyze` | Image → graph + report (no IFC yet) |
| `POST` | `/api/solve` | Confirmed graph → IFC + report |
| `POST` | `/api/export` | Graph → `.ifc` download |
| `POST` | `/api/convert` | Analyze + solve in one call |
