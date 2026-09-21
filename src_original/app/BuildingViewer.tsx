"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BuildingGraph, Opening, Wall } from "@/lib/models";
import { wallFrame } from "@/lib/geometry/frame";
import { wallBoxes } from "@/lib/geometry/wallBoxes";
import { overlayCenter } from "@/lib/geometry/imageMap";

export function BuildingViewer({
  graph,
  planImage,
  selectedId,
  onSelect,
}: {
  graph: BuildingGraph;
  planImage?: string;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0d0b);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    THREE.Cache.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff2d6, 1.05);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9bb7ff, 0.35);
    fill.position.set(-6, 6, -8);
    scene.add(fill);
    scene.add(new THREE.HemisphereLight(0xdde7ff, 0x3a3228, 0.35));

    const wallMatExt = new THREE.MeshStandardMaterial({
      color: 0xd8d0c0,
      roughness: 0.82,
      metalness: 0.02,
      transparent: true,
      opacity: 0.9,
    });
    const wallMatInt = new THREE.MeshStandardMaterial({
      color: 0xb7ae9c,
      roughness: 0.86,
      transparent: true,
      opacity: 0.9,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x6b3f24,
      roughness: 0.55,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x3f3a34,
      roughness: 0.5,
    });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x7ec8dc,
      transparent: true,
      opacity: 0.55,
      roughness: 0.08,
      metalness: 0.15,
      emissive: 0x1a4450,
      side: THREE.DoubleSide,
    });
    const slabMat = new THREE.MeshStandardMaterial({
      color: 0x2c332c,
      roughness: 0.95,
    });

    const root = new THREE.Group();
    scene.add(root);

    const xs = graph.walls.flatMap((w) => [w.start[0], w.end[0]]);
    const ys = graph.walls.flatMap((w) => [w.start[1], w.end[1]]);
    const minX = Math.min(...xs, 0);
    const maxX = Math.max(...xs, 1);
    const minY = Math.min(...ys, 0);
    const maxY = Math.max(...ys, 1);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(maxX - minX + 6, maxY - minY + 6),
      new THREE.MeshStandardMaterial({ color: 0x161714, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.02, -cy);
    root.add(ground);

    const grid = new THREE.GridHelper(
      Math.max(maxX - minX, maxY - minY) + 4,
      20,
      0x3a3c34,
      0x242620,
    );
    grid.position.set(cx, 0, -cy);
    root.add(grid);

    if (
      planImage &&
      graph.metersPerPixel &&
      graph.imageWidth &&
      graph.imageHeight
    ) {
      const pose = overlayCenter(graph);
      const tex = new THREE.TextureLoader().load(planImage);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const overlay = new THREE.Mesh(
        new THREE.PlaneGeometry(pose.wM, pose.hM),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        }),
      );
      overlay.rotation.x = -Math.PI / 2;
      overlay.position.set(pose.x, pose.y, pose.z);
      overlay.renderOrder = -1;
      root.add(overlay);
    }

    if (!planImage) {
      for (const space of graph.spaces) {
        if (space.polygon.length < 3) continue;
        const shape = new THREE.Shape();
        space.polygon.forEach((p, i) => {
          if (i === 0) shape.moveTo(p[0], p[1]);
          else shape.lineTo(p[0], p[1]);
        });
        const geom = new THREE.ExtrudeGeometry(shape, {
          depth: 0.06,
          bevelEnabled: false,
        });
        geom.rotateX(-Math.PI / 2);
        root.add(new THREE.Mesh(geom, slabMat));
      }
      for (const space of graph.spaces) {
        const cxr =
          space.polygon.reduce((s, p) => s + p[0], 0) / space.polygon.length;
        const cyr =
          space.polygon.reduce((s, p) => s + p[1], 0) / space.polygon.length;
        const sprite = makeLabel(space.name);
        sprite.position.set(cxr, 0.35, -cyr);
        root.add(sprite);
      }
    }

    for (const wall of graph.walls) {
      root.add(
        wallGroup(wall, graph, {
          wall: wall.kind === "external" ? wallMatExt : wallMatInt,
          door: doorMat,
          frame: frameMat,
          glass: glassMat,
        }, selectedId ?? null),
      );
    }

    const target = new THREE.Vector3(cx, graph.storeyHeight * 0.2, -cy);
    const span = Math.max(maxX - minX, maxY - minY, 8);
    if (planImage) {
      camera.position.set(cx + span * 0.08, span * 0.95, -cy + span * 0.7);
    } else {
      camera.position.set(cx, span * 0.85, span * 0.55);
    }
    camera.lookAt(target);
    const orbit = bindOrbit(camera, renderer.domElement, target, (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(root, true);
      const hit = hits.find((h) => h.object.userData.entityId);
      onSelect?.(hit ? String(hit.object.userData.entityId) : null);
    });

    const resize = () => {
      const w = host.clientWidth || 640;
      const h = host.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
        }
      });
    };
  }, [graph, planImage, selectedId, onSelect]);

  return <div className="viewer3d" ref={hostRef} />;
}

function bindOrbit(
  camera: THREE.PerspectiveCamera,
  el: HTMLElement,
  target: THREE.Vector3,
  onPick?: (event: PointerEvent) => void,
) {
  const offset = camera.position.clone().sub(target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;

  const apply = () => {
    camera.position.setFromSpherical(spherical).add(target);
    camera.lookAt(target);
  };

  const onDown = (e: PointerEvent) => {
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    spherical.theta -= (e.clientX - lastX) * 0.005;
    spherical.phi = Math.max(
      0.08,
      Math.min(Math.PI / 2 - 0.04, spherical.phi - (e.clientY - lastY) * 0.005),
    );
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  };
  const onUp = (e: PointerEvent) => {
    if (dragging && moved < 5) onPick?.(e);
    dragging = false;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    spherical.radius = Math.max(2, Math.min(70, spherical.radius + e.deltaY * 0.012));
    apply();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointerleave", onUp);
  el.addEventListener("wheel", onWheel, { passive: false });

  return {
    dispose() {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointerleave", onUp);
      el.removeEventListener("wheel", onWheel);
    },
  };
}

function wallGroup(
  wall: Wall,
  graph: BuildingGraph,
  mats: {
    wall: THREE.MeshStandardMaterial;
    door: THREE.MeshStandardMaterial;
    frame: THREE.MeshStandardMaterial;
    glass: THREE.MeshStandardMaterial;
  },
  selectedId: string | null,
) {
  const { ux, uy } = wallFrame(wall);
  const group = new THREE.Group();
  group.position.set(wall.start[0], 0, -wall.start[1]);
  group.rotation.y = Math.atan2(uy, ux);

  for (const box of wallBoxes(wall, graph.openings)) {
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (w < 0.02 || h < 0.02) continue;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, wall.thickness),
      pickMat(mats.wall, wall.id, selectedId),
    );
    mesh.position.set((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2, 0);
    mesh.userData.entityId = wall.id;
    group.add(mesh);
  }

  for (const opening of graph.openings.filter((o) => o.wallId === wall.id)) {
    const cx = opening.offset + opening.width / 2;
    const frameT = 0.05;
    const jambH = opening.height;
    const left = new THREE.Mesh(
      new THREE.BoxGeometry(frameT, jambH, wall.thickness + 0.04),
      pickMat(mats.frame, opening.id, selectedId),
    );
    left.position.set(opening.offset + frameT / 2, opening.sill + jambH / 2, 0);
    left.userData.entityId = opening.id;
    const right = left.clone();
    right.position.set(
      opening.offset + opening.width - frameT / 2,
      opening.sill + jambH / 2,
      0,
    );
    right.userData.entityId = opening.id;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(opening.width, frameT, wall.thickness + 0.04),
      pickMat(mats.frame, opening.id, selectedId),
    );
    head.position.set(cx, opening.sill + opening.height - frameT / 2, 0);
    head.userData.entityId = opening.id;
    group.add(left, right, head);

    if (opening.type === "door") {
      const leafW = Math.min(
        0.95,
        Math.max(0.55, opening.width - 0.06),
      );
    
      const leafH = Math.max(
        0.2,
        opening.height - 0.08,
      );
    
      const hingeAtEnd = opening.hinge === "end";
      const swing = opening.swing === -1 ? -1 : 1;
    
      const hingeX = hingeAtEnd
        ? opening.offset + opening.width - 0.04
        : opening.offset + 0.04;
    
      const pivot = new THREE.Group();
    
      pivot.position.set(
        hingeX,
        opening.sill + leafH / 2,
        0,
      );
    
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(
          leafW,
          leafH,
          0.045,
        ),
        pickMat(
          mats.door,
          opening.id,
          selectedId,
        ),
      );
    
      leaf.position.x = hingeAtEnd
        ? -leafW / 2
        : leafW / 2;
    
      leaf.userData.entityId = opening.id;
    
      /*
       * Wall local X = along the wall.
       * Wall local Z = perpendicular to the wall.
       *
       * Because the wall group is already rotated to wall direction,
       * rotate the door around its hinge in local coordinates.
       */
      const direction = hingeAtEnd ? -1 : 1;
    
      pivot.rotation.y =
        direction *
        swing *
        (Math.PI / 2);
    
      pivot.add(leaf);
      group.add(pivot);
    
      // Draw the door swing arc.
      const arc = doorSwingArc(
        opening,
        hingeX,
        leafH / 2,
        leafW,
        hingeAtEnd,
        swing,
        mats.frame,
      );
    
      arc.userData.entityId = opening.id;
      group.add(arc);

    } else {
      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(opening.width - 0.08, opening.height - 0.08, 0.04),
        pickMat(mats.glass, opening.id, selectedId),
      );
      glass.position.set(cx, opening.sill + opening.height / 2, 0);
      glass.userData.entityId = opening.id;
      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(opening.width, 0.06, wall.thickness + 0.12),
        pickMat(mats.frame, opening.id, selectedId),
      );
      sill.position.set(cx, opening.sill + 0.03, 0);
      sill.userData.entityId = opening.id;
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(opening.width, 0.05, wall.thickness + 0.22),
        pickMat(mats.glass, opening.id, selectedId),
      );
      plate.position.set(cx, 0.04, 0);
      plate.userData.entityId = opening.id;
      group.add(glass, sill, plate);
    }
  }

  return group;
}

function doorSwingArc(
  opening: Opening,
  hingeX: number,
  y: number,
  radius: number,
  hingeAtEnd: boolean,
  swing: number,
  material: THREE.Material,
): THREE.Line {
  const points: THREE.Vector3[] = [];

  const segments = 24;

  /*
   * Door starts along the wall.
   *
   * For hinge at start:
   *   leaf points +X
   *
   * For hinge at end:
   *   leaf points -X
   */
  const baseAngle = hingeAtEnd
    ? Math.PI
    : 0;

  /*
   * Three.js local Y rotation:
   * X -> Z depending on the rotation direction.
   *
   * Use opposite sign because plan Y is represented by -Z.
   */
  const direction = swing === -1 ? -1 : 1;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;

    const angle =
      baseAngle +
      direction * t * (Math.PI / 2);

    points.push(
      new THREE.Vector3(
        hingeX + Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius,
      ),
    );
  }

  const geometry =
    new THREE.BufferGeometry().setFromPoints(points);

  return new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0xd6b36a,
      linewidth: 2,
    }),
  );
}

function pickMat(
  base: THREE.MeshStandardMaterial,
  id: string,
  selectedId: string | null,
): THREE.MeshStandardMaterial {
  const mat = base.clone();
  if (selectedId === id) mat.emissive.setHex(0x6b4a18);
  return mat;
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(16,17,15,0.72)";
    ctx.fillRect(20, 32, 472, 64);
    ctx.fillStyle = "#ece8dc";
    ctx.font = "28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 64);
  }
  const map = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map, transparent: true }),
  );
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}
