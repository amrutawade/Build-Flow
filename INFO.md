2D Floor Plan —> 3D Model The current app is a classical orthogonal-plan reader, not a learned detector. It follows the same 01–10 story as the reference pipeline, with two hard limits: axis-aligned walls only, and no LLM for coordinates.

***
                    FLOOR PLAN
                        │
                        ▼
                 calibrateImage()
                        │
                        ▼
                  wall detection
                        │
                        ▼
                wall candidates
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
       opening candidates    room/space candidates
              │
       ┌──────┴──────┐
       ▼             ▼
  door detection   window detection
       │             │
       └──────┬──────┘
              ▼
        merge openings
              │
              ▼
        sanitize openings
              │
              ▼
        repair topology
              │
              ▼
       rehost openings
              │
              ▼
         enrich graph
              │
              ▼
       validate graph
              │
              ▼
          IFC4 export

          ***

How this maps to the reference pipeline
Ref	What the code does	Where
01 Input	PNG/JPEG only. PDF/DXF are rejected.	analyze/route.ts
02 Clean & scale	EXIF rotate + small deskew; grayscale; Otsu threshold. Scale = user m/px or “longest ink bbox ≈ 12 m”.	calibrate.ts, fromImage.ts
03 Detect walls	Dark-ink mask → H/V projection peaks → centerlines. Not a wall-segmentation model.	wallsFromMask
04 Topology	Snap ortho, grow tips, split T/crossings, seal dangling ends.	repairTopology
05 Openings	Gaps on wall runs + CAD-symbol scan (hollow box = window, arc = door). Hosted on a wall.	stitchFrags, scanOpeningsAlongWalls
06 Rooms	Closed faces from centerlines; fallback flood-fill. Names by area only (not OCR).	spacesFromWalls, guessName
07 HITL	Analyze stops at confirm; solve is a second call.	pipeline.ts
08–09	Extrude storey, write IFC4.	solveGraph, writeIfc4.ts
10	Junctions ≤ 30 mm, hosted openings, spaces.	validate/report.ts
Entry point: analyzeImage → calibrateImage → graphFromCalibrated → (after confirm) repairTopology again in solveGraph.

How the image is actually read (vision)
graphFromCalibrated in fromImage.ts is the whole vision stack:
1. Resize so the long side is ≤ 1600 px, grayscale, 3×3 median.
2. Threshold (Otsu, clamped ~40–100). Try normal and inverted; keep the mask with more H/V density peaks.
3. Split ink: darkest strokes = walls, lighter strokes = door arcs / window ticks (splitInkLayers).
4. Morphological open on wall ink, plus keep pixels that sit on long H or V runs (keepLinePixels). Union those.
5. Find walls as ridges in row/column ink density (densityPeaks + sliding projectionBands).
6. Along each ridge, walk a thin strip and split into wall runs vs gaps (stripRuns, dark if >42% of the strip is ink).
7. Stitch collinear fragments; leftover gaps become candidate openings (stitchFrags).
8. Drop duplicates / parallel doubles (nmsParallelWalls 32 cm) and short “sketch” lines (pruneSketchNoise).
9. repairTopology, then a second opening pass along each wall (scanOpeningsAlongWalls), then joinOpeningJambs.
There is no learned wall/door/window model. Everything is ink density + heuristics.

How walls vs windows vs doors are decided
Walls
* Dark, long, axis-aligned ink ridges.
* Thickness from peak width, clamped to 0.10–0.23 m.
* External vs internal: after topology, by whether the wall sits on the bounding box of the wall set (isEnvelopeWall), not by construction type.
Windows — any of:
* Collinear gap 1.2–2.4 m (later up to 3.8 m if “external”) on a wall run.
* Along a wall, a hollow cavity: dark faces on both sides, empty core (typical CAD window box); mullions can glue 2–3 panes.
* Flood-fill of small empty rectangles whose short side is ~wall thickness (hollowRectWindows).
* Reclassified as window if the host is on the envelope and width ≥ ~0.9 m.
Fixed sizes: height 1.2 m, sill 0.9 m.
Doors — any of:
* Collinear gap 0.55–1.2 m.
* An empty cut in the wall plus light ink in a quarter-circle (doorSwingVote → hinge + swing).
* Width later clamped toward 0.7–1.1 m; height 2.1 m, sill 0.
Openings that sit at a wall end are often discarded (doors especially), so a door in a corner is easy to miss.

Why T-junctions fail
A T is: a stem whose tip should lie on another wall’s centerline, and that host should be split at the hit so three segments share a vertex.
The code tries to do that (extendToJunctions, splitAtJunctions, closeDangling, joinOpeningJambs), but several earlier choices make the T never exist, or exist a few centimetres off (validation wants 30 mm).
1. The stem is often never detected
Projection peaks need a strong H or V ridge. A short internal partition is a weak peak in a 40% band of the plan. Then:
* Runs shorter than 0.35 m are dropped; walls shorter than 0.40 m are dropped.
* pruneSketchNoise drops walls < 0.95 m unless they already sit near a long wall or well inside the envelope. Typical bedroom T-stems are in that range.
* nmsParallelWalls kills a second line within 0.32 m of a longer parallel wall — common on double-line CAD walls, which also makes the real stem only ~half a wall thick and too short.
If the stem is missing, topology cannot invent a T.
2. The stem stops at the face, not the centerline
Centerlines are the middle of the ink ridge. The stem’s ink ends at the face of the through-wall, so the tip is short by ~thickness/2 (often 5–15 cm, sometimes more on double-line drawings).
extendToJunctions only grows 0.55 m, and only if the host’s span already covers the tip with a 16 cm pad:
topology.ts
Lines 105-117
if (horiz) {
  const isLeft = p[0] <= other[0];
  for (const o of walls) {
    if (o.id === self.id || isHorizontal(o)) continue;
    const xHit = o.start[0];
    const y0 = Math.min(o.start[1], o.end[1]) - 0.16;
    const y1 = Math.max(o.start[1], o.end[1]) + 0.16;
    if (p[1] < y0 || p[1] > y1) continue;
    const d = isLeft ? p[0] - xHit : xHit - p[0];
    if (d > -0.04 && d <= maxReach && Math.abs(d) < bestD && Math.abs(d) > 1e-4) {

If the host was split into two fragments that do not cover the stem’s axis (gap at the T, or a window treated as a hole), the 16 cm test fails and the stem stays dangling.
3. Gaps at the T are treated as doors/windows
stitchFrags / bridgeColinearOpenings treat a collinear gap of 0.55–1.2 m as a door and do not merge. At a T, extra crossing ink, furniture, or a dimension tick can punch a hole in the through-wall. Then the stem has nothing solid to T into, or it T’s into an opening. colinearHole then blocks growToCoverTips from growing across that gap.
joinOpeningJambs is meant to snap partitions onto jambs, but it runs after the first topology pass, only if an opening was detected, and it will happily snap to the midpoint of a window as well as the jambs.
4. Split only happens if the tip is already close
splitAtJunctions cuts the through-wall only if a stem endpoint is within snap * 1.5 of the centerline. If the stem is still short, the host stays one long segment. Rooms (spacesFromWalls) also need shared vertices (coordinates rounded to 1 cm). A stem that is 4 cm off:
* fails the 30 mm topology check, and/or
* never splits the host, so two rooms stay one face.
5. Orthogonal-only + morphological open
openMask (erode then dilate) can nick thin T connections. Non-ortho or slightly skewed partitions never become walls. Deskew only searches ±8°.
6. Sealing can attach the stem to the wrong wall
snapTipsToAxisGrid / closeDangling / stitchCorners pull a free end to the nearest orthogonal axis within 20% of the plan span (up to 4 m). A short T-stem in a large room can snap to a far parallel wall or to a corner pair, instead of the intended mid-span T. dropOrphanStubs can then delete a stem that still doesn’t touch anything and is < 0.85 m.

End-to-end picture
pixels → deskew/threshold → H/V density ridges → centerline fragments
      → stitch + guess gaps as door/window
      → prune short/parallel lines          ← T-stems often die here
      → snap / extend 0.55 m / split T      ← face-vs-centerline + 16 cm pad
      → scan CAD window boxes + door arcs
      → snap leftover tips to jambs
      → faces or flood-fill rooms (area names)

So T-junction failure is usually not “3D extrusion is wrong”. It is 2D: the stem is missing, too short, or the through-wall was broken at the junction before topology could snap and split.
If you want this fixed in code, switch to Agent mode; the highest-leverage changes are: keep short interior stems, extend T-tips to the nearest orthogonal segment (not only if that segment already covers the tip), and do not classify a collinear gap as an opening when a perpendicular wall already points at that gap (tAtSpan exists but only for small gaps < 0.55 m).


