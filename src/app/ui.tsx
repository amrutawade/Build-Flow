"use client";

import { useMemo, useRef, useState } from "react";
import type { BuildingGraph } from "@/lib/models";
import { polygonArea } from "@/lib/geometry/area";
import { wallFrame } from "@/lib/geometry/frame";
import { enrichGraph, findIfcEntity, ifcCatalog } from "@/lib/bim/catalog";
import { excludeWall, rescaleGraph, setStoreyHeight as withStoreyHeight } from "@/lib/geometry/edit";
import { worldToPixel } from "@/lib/geometry/imageMap";
import { wallPlanRuns } from "@/lib/geometry/wallBoxes";
import {
  doorHingePoint,
  doorLeafEnd,
  doorStrikePoint,
} from "@/lib/geometry/doorSwing";
import type { ValidationReport } from "@/lib/validate/report";
import { BuildingViewer } from "./BuildingViewer";

type Phase = "empty" | "confirm" | "solved";

// The default image is served from /public/default.png.
// GitHub Pages hosts this project under /Build-Flow.
const DEFAULT_PLAN_IMAGE =
  process.env.NODE_ENV === "production"
    ? "/images/studio.png"
    : "/images/1Bhk.png";

export function Converter() {
  const [graph, setGraph] = useState<BuildingGraph | null>(null);
  const [ifc, setIfc] = useState<string>("");
  const [preview, setPreview] = useState<string>(DEFAULT_PLAN_IMAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [storeyHeight, setStoreyHeightM] = useState(3);
  const [metersPerPixel, setMetersPerPixel] = useState("");
  const [knownLength, setKnownLength] = useState("");
  const [allPages, setAllPages] = useState(true);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("empty");
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [sourceKey, setSourceKey] = useState(0);
  const previewRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const loadGen = useRef(0);

  function forgetPreview() {
    if (previewRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewRef.current);
    }
    previewRef.current = "";
    setPreview("");
  }

  function showPreview(url: string) {
    if (previewRef.current.startsWith("blob:")) {
      URL.revokeObjectURL(previewRef.current);
    }
    previewRef.current = url;
    setPreview(url);
  }

  function debugOpenings(label: string, graph: BuildingGraph | null) {
    if (!graph) return;
  
    const doors = graph.openings.filter((o) => o.type === "door");
    const windows = graph.openings.filter((o) => o.type === "window");
  
    const orphanOpenings = graph.openings.filter(
      (o) => !graph.walls.some((w) => w.id === o.wallId),
    );
  
    console.group(`[${label}]`);
  
    console.log("Walls:", graph.walls.length);
    console.log("Openings:", graph.openings.length);
    console.log("Doors:", doors.length);
    console.log("Windows:", windows.length);
  
    console.table(
      doors.map((d) => ({
        id: d.id,
        wallId: d.wallId,
        offset: d.offset,
        width: d.width,
        height: d.height,
        confidence: d.confidence,
        hinge: d.hinge,
        swing: d.swing,
      })),
    );
  
    if (orphanOpenings.length) {
      console.warn("ORPHAN OPENINGS:", orphanOpenings);
    }
  
    console.groupEnd();
  }

  function beginNewSource() {
    loadGen.current += 1;
    setSourceKey((k) => k + 1);
    setSelectedId(null);
    setIfc("");
    setReport(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (jsonInputRef.current) jsonInputRef.current.value = "";
  }

  const catalog = useMemo(() => (graph ? ifcCatalog(graph) : []), [graph]);
  const selected = findIfcEntity(catalog, selectedId);

  const stats = useMemo(() => {
    if (!graph) return null;
  
    const area = graph.spaces.reduce(
      (s, sp) => s + (sp.area ?? polygonArea(sp.polygon)),
      0,
    );
  
    const doors = graph.openings.filter((o) => o.type === "door");
    const windows = graph.openings.filter((o) => o.type === "window");
  
    const orphanOpenings = graph.openings.filter(
      (o) => !graph.walls.some((w) => w.id === o.wallId),
    );
  
    return {
      walls: graph.walls.length,
      openings: graph.openings.length,
      doors: doors.length,
      windows: windows.length,
      spaces: graph.spaces.length,
      orphanOpenings: orphanOpenings.length,
      area,
    };
  }, [graph]);

  async function applyGraph(next: BuildingGraph, image?: string) {
    const enriched = enrichGraph(next);
    setGraph(enriched);
    setSelectedId(null);
    if (image) setPreview(image);
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });
    if (!res.ok) throw new Error("IFC export from JSON failed");
    setIfc(await res.text());
  }

  async function loadSample() {
    setBusy(true);
    beginNewSource();
    const gen = loadGen.current;
    try {
      const res = await fetch("/api/sample", { cache: "no-store" });
      const data = await res.json();
      if (gen !== loadGen.current) return;
      const analyzedGraph = enrichGraph(data.graph);
      debugOpenings("AFTER ANALYZE", analyzedGraph);

      setGraph(analyzedGraph);
      setIfc(data.ifc);
      showPreview(data.png);
      setPhase("solved");
      setReport(data.report ?? null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof Error ? e.message : "Sample failed");
    } finally {
      if (gen === loadGen.current) setBusy(false);
    }
  }

  async function onUpload(file: File) {
    setBusy(true);
    beginNewSource();
    showPreview(URL.createObjectURL(file));
    setGraph(null);
    setPhase("empty");
    const gen = loadGen.current;
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("storeyHeight", String(storeyHeight >= 2.4 ? storeyHeight : 3));
      if (metersPerPixel) form.set("metersPerPixel", metersPerPixel);
      if (file.name.toLowerCase().endsWith(".pdf")) form.set("allPages", String(allPages));
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      const data = await res.json();
      if (gen !== loadGen.current) return;
      if (!res.ok) throw new Error(data.error ?? "Analyze failed");
      if (typeof data.png === "string" && data.png.startsWith("data:")) {
        showPreview(data.png);
      }
      const analyzedGraph = enrichGraph(data.graph);
      debugOpenings("AFTER ANALYZE", analyzedGraph);

      setGraph(analyzedGraph);
      setStoreyHeightM(Number(data.graph?.storeyHeight) > 2.3 ? data.graph.storeyHeight : 3);
      setPhase("confirm");
      setReport(data.report ?? null);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof Error ? e.message : "Convert failed");
    } finally {
      if (gen === loadGen.current) setBusy(false);
    }
  }

  async function onJsonFile(file: File) {
    setBusy(true);
    beginNewSource();
    forgetPreview();
    setGraph(null);
    const gen = loadGen.current;
    try {
      const parsed = JSON.parse(await file.text()) as BuildingGraph;
      if (gen !== loadGen.current) return;
      setGraph(enrichGraph(parsed));
      setPhase("confirm");
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(e instanceof Error ? e.message : "Invalid BIM JSON");
    } finally {
      if (gen === loadGen.current) setBusy(false);
    }
  }

  async function solve() {
    if (!graph) return;
    setBusy(true);
    setError("");
    try {
      const prepared = withStoreyHeight(graph, storeyHeight);
      const res = await fetch("/api/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepared),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("Solve failed");
      setGraph(enrichGraph(data.graph));
      setIfc(data.ifc);
      setReport(data.report ?? null);
      setPhase("solved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Solve failed");
    } finally {
      setBusy(false);
    }
  }

  function applyKnownLength() {
    if (!graph || !selectedId) return;
    const wall = graph.walls.find((w) => w.id === selectedId);
    const target = Number(knownLength);
    const current = wall?.length ?? 0;
    if (!wall || !current || !Number.isFinite(target) || target <= 0) return;
    setGraph(rescaleGraph(graph, target / current));
  }

  function downloadJson() {
    if (!graph) return;
    const blob = new Blob([JSON.stringify(enrichGraph(graph), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${graph.name.replace(/\s+/g, "-")}.bim.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadCurrentIfc() {
    if (!graph) return;
    const enriched = enrichGraph(graph);
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });
    if (!res.ok) throw new Error("IFC export from JSON failed");
    const text = await res.text();
    setIfc(text);
    const blob = new Blob([text], { type: "application/x-step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${enriched.name.replace(/\s+/g, "-")}.ifc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="shell">
      <div className="kicker">BuildFlow assignment · TypeScript</div>
      <h1>2D plan → IFC4</h1>
      <p className="lede">
        A flat drawing goes in. Geometry comes from pixels and topology, not
        from an LLM. You confirm scale and room names, then we write real IFC
        objects — IfcWall, IfcDoor, IfcWindow, IfcSpace — not a mesh.
      </p>
      <ol className="pipe">
        {[
          ["01", "Input"],
          ["02", "Calibrate"],
          ["03", "Walls"],
          ["04", "Topology"],
          ["05", "Openings"],
          ["06", "Rooms"],
          ["07", "Confirm"],
          ["08", "3D"],
          ["09", "IFC"],
          ["10", "Validate"],
        ].map(([n, label], i) => {
          const on =
            phase === "empty"
              ? i === 0
              : phase === "confirm"
                ? i <= 6
                : true;
          return (
            <li key={n} className={on ? "on" : ""}>
              <b>{n}</b> {label}
            </li>
          );
        })}
      </ol>

      <div className="row">
        <aside className="panel">
                      <label className="field-row" style={{ marginTop: 8 }}>
              <input type="checkbox" checked={allPages} onChange={e => setAllPages(e.target.checked)} />
              <span>PDF: process all pages as storeys</span>
            </label>
<label htmlFor="height">Storey height (m)</label>
          <input
            id="height"
            type="number"
            step="0.1"
            min={2.4}
            max={6}
            value={storeyHeight}
            onChange={(e) => {
              const n = Number(e.target.value);
              setStoreyHeightM(Number.isFinite(n) && n >= 2.4 ? n : 3);
            }}
          />
          <label htmlFor="scale">Meters per pixel (optional)</label>
          <input
            id="scale"
            type="number"
            step="0.0001"
            placeholder="auto"
            value={metersPerPixel}
            onChange={(e) => setMetersPerPixel(e.target.value)}
          />
          <label htmlFor="file">Floor plan image</label>
          <input
            id="file"
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onUpload(f);
            }}
          />
          <div className="actions">
            {phase === "confirm" ? (
              <button type="button" onClick={() => void solve()} disabled={busy || !graph}>
                Confirm & write IFC
              </button>
            ) : null}
            <button
              type="button"
              className="secondary"
              onClick={downloadJson}
              disabled={!graph}
            >
              Save BIM JSON
            </button>
            <button
              type="button"
              className="secondary"
              onClick={downloadCurrentIfc}
              disabled={!ifc}
            >
              Export IFC
            </button>
          </div>
          {error ? <p className="warn">{error}</p> : null}
          {graph?.warnings.map((w) => (
            <p key={w} className="warn">
              {w}
            </p>
          ))}
          {phase === "confirm" && graph ? (
            <div className="hitl">
              <p className="hitl-title">07 · Confirm gate</p>
              <p className="hint-inline">
                Fix scale and labels here. IFC is not written until you confirm.
              </p>
              <label htmlFor="known">Selected wall true length (m)</label>
              <input
                id="known"
                type="number"
                step="0.01"
                placeholder="e.g. 11.4"
                value={knownLength}
                onChange={(e) => setKnownLength(e.target.value)}
              />
              <button
                type="button"
                className="secondary"
                onClick={applyKnownLength}
                disabled={!selectedId || !knownLength}
              >
                Apply length to whole plan
              </button>
              {graph.spaces.map((s) => (
                <label key={s.id} className="space-edit">
                  {s.id}
                  <input
                    value={s.name}
                    onChange={(e) =>
                      setGraph({
                        ...graph,
                        spaces: graph.spaces.map((x) =>
                          x.id === s.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
              ))}
              {graph.walls
                .filter((w) => w.confidence < 0.55)
                .map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className="secondary"
                    onClick={() => setGraph(excludeWall(graph, w.id))}
                  >
                    Remove uncertain {w.id}
                  </button>
                ))}
            </div>
          ) : null}
          {report ? (
            <ul className="checks">
              {report.checks.map((c) => (
                <li key={c.id} className={c.pass ? "pass" : "fail"}>
                  <b>{c.pass ? "Pass" : "Fail"}</b> {c.label}
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {stats ? (
            <div className="stats">
              <span>
                <b>{stats.walls}</b> walls
              </span>
              <span>
                <b>{stats.openings}</b> openings
              </span>
              <span>
                <b>{stats.doors}</b> doors
              </span>
              <span>
                <b>{stats.windows}</b> windows
              </span>
              <span>
                <b>{stats.spaces}</b> spaces
              </span>
              <span>
                <b>{stats.area.toFixed(1)}</b> m²
              </span>
            </div>
          ) : null}
          {selected ? (
            <div className="inspector">
              <div className="ifc-tag">{selected.ifcClass}</div>
              <h2>{selected.name}</h2>
              <table>
                <tbody>
                  {selected.properties.map((p) => (
                    <tr key={p.label}>
                      <th>{p.label}</th>
                      <td>{p.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : graph ? (
            <p className="hint-inline">Click a wall or window in 3D, or a row below.</p>
          ) : null}
          {catalog.length > 0 ? (
            <ul className="ifc-list">
              {catalog.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={e.id === selectedId ? "on" : ""}
                    onClick={() => setSelectedId(e.id)}
                  >
                    <span>{e.ifcClass}</span>
                    {e.name}
                    {e.properties[0] ? ` · ${e.properties[0].value}` : ""}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </aside>

        <section className="canvas-wrap">
          {graph || preview ? (
            <>
              <div className="view-toggle">
                <button
                  type="button"
                  className={view === "3d" ? "on" : ""}
                  onClick={() => setView("3d")}
                >
                  3D BIM
                </button>
                <button
                  type="button"
                  className={view === "2d" ? "on" : ""}
                  onClick={() => setView("2d")}
                >
                  2D plan
                </button>
              </div>
              {view === "3d" ? (
                <div className="stage">
                  {preview ? (
                    <div className="plan-source">
                      {graph ? (
                        <PlanTrace graph={graph} src={preview} />
                      ) : (
                        <img key={sourceKey} src={preview} alt="Source floor plan" />
                      )}
                      <span>Drawing + detected walls</span>
                    </div>
                  ) : null}
                  <div className="stage-3d">
                    {graph ? (
                      <BuildingViewer
                        key={sourceKey}
                        graph={graph}
                        planImage={preview}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    ) : (
                      <p className="lede" style={{ padding: 24 }}>
                        Reading the new drawing…
                      </p>
                    )}
                    <p className="hint">
                      Top view is aligned to the drawing. Drag to tilt into 3D.
                    </p>
                  </div>
                </div>
              ) : graph ? (
                <PlanSvg graph={graph} backdrop={preview} />
              ) : (
                <p className="lede" style={{ padding: 24 }}>
                  Reading the new drawing…
                </p>
              )}
            </>
          ) : (
            <p className="lede" style={{ padding: 24 }}>
              Upload a 2 BHK brochure scan or load the sample. Analysis stops at
              the confirm gate so you can fix scale and names before IFC.
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function PlanTrace({ graph, src }: { graph: BuildingGraph; src: string }) {
  const w = graph.imageWidth;
  const h = graph.imageHeight;
  if (!w || !h || !graph.metersPerPixel) {
    return <img src={src} alt="Source floor plan" />;
  }
  return (
    <div className="plan-trace">
      <img src={src} alt="Source floor plan" />
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {graph.walls.map((wall) => {
          const { ux, uy } = wallFrame(wall);
          return wallPlanRuns(wall, graph.openings).map((run, i) => {
            const a = worldToPixel(
              graph,
              wall.start[0] + ux * run.x0,
              wall.start[1] + uy * run.x0,
            );
            const b = worldToPixel(
              graph,
              wall.start[0] + ux * run.x1,
              wall.start[1] + uy * run.x1,
            );
            return (
              <line
                key={`${wall.id}-${i}`}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                stroke={wall.kind === "external" ? "#c45c26" : "#d4a056"}
                strokeWidth={3}
                strokeLinecap="square"
              />
            );
          });
        })}
        {graph.openings.map((o) => {
          const wall = graph.walls.find((w) => w.id === o.wallId);
          if (!wall) return null;
          const { ux, uy } = wallFrame(wall);
          const x0 = wall.start[0] + ux * o.offset;
          const y0 = wall.start[1] + uy * o.offset;
          const x1 = wall.start[0] + ux * (o.offset + o.width);
          const y1 = wall.start[1] + uy * (o.offset + o.width);
          const nx = -uy;
          const ny = ux;
          const a = worldToPixel(graph, x0, y0);
          const b = worldToPixel(graph, x1, y1);
          if (o.type === "window") {
            const o1 = worldToPixel(graph, x0 + nx * 0.14, y0 + ny * 0.14);
            const o2 = worldToPixel(graph, x1 + nx * 0.14, y1 + ny * 0.14);
            const i1 = worldToPixel(graph, x0 - nx * 0.14, y0 - ny * 0.14);
            const i2 = worldToPixel(graph, x1 - nx * 0.14, y1 - ny * 0.14);
            return (
              <g key={o.id}>
                <line x1={o1[0]} y1={o1[1]} x2={o2[0]} y2={o2[1]} stroke="#2a8a9a" strokeWidth={3} />
                <line x1={i1[0]} y1={i1[1]} x2={i2[0]} y2={i2[1]} stroke="#2a8a9a" strokeWidth={3} />
              </g>
            );
          }
          const hinge = worldToPixel(graph, ...doorHingePoint(o, wall));
          const strike = worldToPixel(graph, ...doorStrikePoint(o, wall));
          const leaf = worldToPixel(graph, ...doorLeafEnd(o, wall));
          const r = Math.hypot(strike[0] - hinge[0], strike[1] - hinge[1]);
          const cross =
            (strike[0] - hinge[0]) * (leaf[1] - hinge[1]) -
            (strike[1] - hinge[1]) * (leaf[0] - hinge[0]);
          const sweep = cross < 0 ? 1 : 0;
          return (
            <g key={o.id}>
              <path
                d={`M ${strike[0]} ${strike[1]} A ${r} ${r} 0 0 ${sweep} ${leaf[0]} ${leaf[1]}`}
                fill="none"
                stroke="#6b3f24"
                strokeWidth={1.5}
              />
              <line
                x1={hinge[0]}
                y1={hinge[1]}
                x2={leaf[0]}
                y2={leaf[1]}
                stroke="#6b3f24"
                strokeWidth={3}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function PlanSvg({
  graph,
  backdrop,
}: {
  graph: BuildingGraph;
  backdrop: string;
}) {
  const xs = graph.walls.flatMap((w) => [w.start[0], w.end[0]]);
  const ys = graph.walls.flatMap((w) => [w.start[1], w.end[1]]);
  const mpp = graph.metersPerPixel;
  const wM =
    graph.imageWidth && mpp ? graph.imageWidth * mpp : Math.max(...xs, 1) + 1;
  const hM =
    graph.imageHeight && mpp ? graph.imageHeight * mpp : Math.max(...ys, 1) + 1;
  const ox = graph.imageOffsetX ?? 0;
  const oy = graph.imageOffsetY ?? 0;
  const minX = Math.min(...xs, -ox) - 0.5;
  const minY = Math.min(...ys, -oy) - 0.5;
  const maxX = Math.max(...xs, wM - ox) + 0.5;
  const maxY = Math.max(...ys, hM - oy) + 0.5;
  const vb = `${minX} ${-maxY} ${maxX - minX} ${maxY - minY}`;

  return (
    <svg className="plan" viewBox={vb}>
      {backdrop && graph.imageWidth && mpp ? (
        <image
          href={backdrop}
          x={-ox}
          y={-(hM - oy)}
          width={wM}
          height={hM}
          preserveAspectRatio="none"
          opacity={0.92}
        />
      ) : null}
      <g transform="scale(1,-1)">
        {graph.spaces.map((s) => (
          <polygon
            key={s.id}
            points={s.polygon.map((p) => p.join(",")).join(" ")}
            fill="#3d5a45"
            fillOpacity={0.25}
            stroke="none"
          />
        ))}
        {graph.walls.map((w) => {
          const { ux, uy } = wallFrame(w);
          return wallPlanRuns(w, graph.openings).map((run, i) => (
            <line
              key={`${w.id}-${i}`}
              x1={w.start[0] + ux * run.x0}
              y1={w.start[1] + uy * run.x0}
              x2={w.start[0] + ux * run.x1}
              y2={w.start[1] + uy * run.x1}
              stroke={w.kind === "external" ? "#e8e2d2" : "#b7b19f"}
              strokeWidth={w.thickness}
              strokeLinecap="square"
            />
          ));
        })}
        {graph.openings.map((o) => {
          const wall = graph.walls.find((w) => w.id === o.wallId);
          if (!wall) return null;
          const { ux, uy } = wallFrame(wall);
          const x = wall.start[0] + ux * (o.offset + o.width / 2);
          const y = wall.start[1] + uy * (o.offset + o.width / 2);
          const nx = -uy * (wall.thickness * 0.9);
          const ny = ux * (wall.thickness * 0.9);
          return (
            <line
              key={o.id}
              x1={x - nx}
              y1={y - ny}
              x2={x + nx}
              y2={y + ny}
              stroke={o.type === "door" ? "#6b3f24" : "#8fd4ea"}
              strokeWidth={o.width}
              strokeLinecap="butt"
            />
          );
        })}
      </g>
    </svg>
  );
}
