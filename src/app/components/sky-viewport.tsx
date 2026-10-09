"use client";

import type {
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./sky-viewport.module.css";

export type SkyCoordinate = {
  raDeg: number;
  decDeg: number;
};

export type SkyFootprint = {
  id: string;
  vertices: readonly SkyCoordinate[];
  selected?: boolean;
};

export type SkyViewState = {
  center: SkyCoordinate;
  /** Horizontal field of view, in degrees. */
  fieldOfViewDeg: number;
};

type SkyViewportProps = {
  viewCenter?: SkyCoordinate;
  fieldOfViewDeg?: number;
  footprints?: readonly SkyFootprint[];
  onViewSettled?: (view: SkyViewState) => void;
  onFootprintSelect?: (id: string) => void;
};

type ThreeModule = typeof import("three");

type ViewportRuntime = {
  THREE: ThreeModule;
  camera: PerspectiveCamera;
  footprintGroup: Group;
  renderer: WebGLRenderer;
  scene: Scene;
  resizeObserver: ResizeObserver;
};

const EMPTY_FOOTPRINTS: readonly SkyFootprint[] = [];
const INITIAL_CENTER: SkyCoordinate = { raDeg: 0, decDeg: 0 };
const INITIAL_FOV = 70;
const MIN_FOV = 24;
const MAX_FOV = 110;

function normalizeRa(raDeg: number) {
  return ((raDeg % 360) + 360) % 360;
}

function normalizeCoordinate(coordinate: SkyCoordinate): SkyCoordinate {
  return {
    raDeg: normalizeRa(Number.isFinite(coordinate.raDeg) ? coordinate.raDeg : 0),
    decDeg: Math.max(-90, Math.min(90, Number.isFinite(coordinate.decDeg) ? coordinate.decDeg : 0)),
  };
}

function formatCoordinate(value: number, suffix: string) {
  const sign = suffix === "DEC" && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}°`;
}

function coordinateFromDirection(direction: import("three").Vector3): SkyCoordinate {
  const normalized = direction.clone().normalize();
  return {
    raDeg: normalizeRa((Math.atan2(-normalized.z, normalized.x) * 180) / Math.PI),
    decDeg: (Math.asin(Math.max(-1, Math.min(1, normalized.y))) * 180) / Math.PI,
  };
}

function coordinateVector(
  THREE: ThreeModule,
  coordinate: SkyCoordinate,
  radius: number,
) {
  const ra = (normalizeRa(coordinate.raDeg) * Math.PI) / 180;
  const dec = (Math.max(-90, Math.min(90, coordinate.decDeg)) * Math.PI) / 180;
  return new THREE.Vector3(
    Math.cos(dec) * Math.cos(ra),
    Math.sin(dec),
    -Math.cos(dec) * Math.sin(ra),
  ).multiplyScalar(radius);
}

function setCameraCenter(
  THREE: ThreeModule,
  camera: PerspectiveCamera,
  coordinate: SkyCoordinate,
) {
  const safeCoordinate = normalizeCoordinate(coordinate);
  const ra = (safeCoordinate.raDeg * Math.PI) / 180;
  const dec = (safeCoordinate.decDeg * Math.PI) / 180;
  const direction = coordinateVector(THREE, safeCoordinate, 1);
  const north = new THREE.Vector3(
    -Math.sin(dec) * Math.cos(ra),
    Math.cos(dec),
    Math.sin(dec) * Math.sin(ra),
  );

  camera.up.copy(north);
  camera.position.set(0, 0, 0);
  camera.lookAt(direction);
  camera.updateMatrixWorld();
}

function setHorizontalFieldOfView(
  camera: PerspectiveCamera,
  horizontalFovDeg: number,
  aspect: number,
) {
  const horizontalRadians = (Math.max(MIN_FOV, Math.min(MAX_FOV, horizontalFovDeg)) * Math.PI) / 180;
  const verticalRadians = 2 * Math.atan(Math.tan(horizontalRadians / 2) / Math.max(aspect, 0.1));
  camera.fov = (verticalRadians * 180) / Math.PI;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

function getHorizontalFieldOfView(camera: PerspectiveCamera) {
  const verticalRadians = (camera.fov * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(verticalRadians / 2) * camera.aspect) * 180) / Math.PI;
}

function createStarfieldTexture(THREE: ThreeModule) {
  const canvas = document.createElement("canvas");
  canvas.width = 2048;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const { width, height } = canvas;
  const base = context.createLinearGradient(0, 0, width, height);
  base.addColorStop(0, "#020610");
  base.addColorStop(0.52, "#071222");
  base.addColorStop(1, "#030711");
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);

  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(-0.31);
  context.scale(1, 0.72);
  const galaxy = context.createLinearGradient(-width / 2, 0, width / 2, 0);
  galaxy.addColorStop(0, "rgba(40, 95, 150, 0.02)");
  galaxy.addColorStop(0.2, "rgba(88, 106, 190, 0.16)");
  galaxy.addColorStop(0.43, "rgba(202, 148, 188, 0.2)");
  galaxy.addColorStop(0.56, "rgba(246, 189, 144, 0.18)");
  galaxy.addColorStop(0.75, "rgba(98, 104, 190, 0.17)");
  galaxy.addColorStop(1, "rgba(43, 95, 150, 0.02)");
  context.filter = "blur(78px)";
  context.fillStyle = galaxy;
  context.beginPath();
  context.ellipse(0, 0, width * 0.64, 105, 0, 0, Math.PI * 2);
  context.fill();
  context.filter = "blur(32px)";
  context.fillStyle = "rgba(122, 125, 214, 0.11)";
  context.beginPath();
  context.ellipse(0, -10, width * 0.55, 46, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
  context.filter = "none";

  let seed = 240719;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const starColors = ["#d8e7ff", "#91caff", "#ffffff", "#ffd7b5"];

  for (let index = 0; index < 3200; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const size = Math.pow(random(), 3) * 1.7 + 0.18;
    const alpha = 0.25 + random() * 0.7;
    context.globalAlpha = alpha;
    context.fillStyle = starColors[Math.floor(random() * starColors.length)];
    context.beginPath();
    context.arc(x, y, size, 0, Math.PI * 2);
    context.fill();

    if (size > 1.35) {
      const glow = context.createRadialGradient(x, y, 0, x, y, size * 8);
      glow.addColorStop(0, "rgba(182, 220, 255, 0.55)");
      glow.addColorStop(1, "rgba(123, 180, 255, 0)");
      context.globalAlpha = 0.55;
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, size * 8, 0, Math.PI * 2);
      context.fill();
    }
  }
  context.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createCoordinateGrid(THREE: ThreeModule) {
  const group = new THREE.Group();
  const radius = 99.55;
  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x4da9ca,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  const majorMaterial = new THREE.LineBasicMaterial({
    color: 0x75c4de,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
  });

  for (let raDeg = 0; raDeg < 360; raDeg += 15) {
    const points: import("three").Vector3[] = [];
    for (let index = 0; index <= 120; index += 1) {
      const decDeg = -90 + (180 * index) / 120;
      points.push(coordinateVector(THREE, { raDeg, decDeg }, radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(geometry, raDeg % 30 === 0 ? majorMaterial : lineMaterial));
  }

  for (let decDeg = -75; decDeg <= 75; decDeg += 15) {
    const points: import("three").Vector3[] = [];
    for (let index = 0; index <= 240; index += 1) {
      const raDeg = (360 * index) / 240;
      points.push(coordinateVector(THREE, { raDeg, decDeg }, radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(geometry, decDeg % 30 === 0 ? majorMaterial : lineMaterial));
  }

  const addLabel = (text: string, coordinate: SkyCoordinate) => {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 48;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.font = "24px monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(166, 221, 238, 0.9)";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    });
    const label = new THREE.Sprite(material);
    label.position.copy(coordinateVector(THREE, coordinate, 99.1));
    label.scale.set(4.6, 1.8, 1);
    group.add(label);
  };
  for (let raDeg = 0; raDeg < 360; raDeg += 30) {
    addLabel(`${String(Math.round(raDeg / 15)).padStart(2, "0")}h`, {
      raDeg,
      decDeg: 2,
    });
  }
  for (let decDeg = -60; decDeg <= 60; decDeg += 30) {
    addLabel(`${decDeg > 0 ? "+" : ""}${decDeg}°`, {
      raDeg: 2,
      decDeg,
    });
  }

  return group;
}

function createFootprintGroup(THREE: ThreeModule, footprints: readonly SkyFootprint[]) {
  const group = new THREE.Group();

  for (const footprint of footprints) {
    const vertices = footprint.vertices
      .filter(
        (vertex) =>
          Number.isFinite(vertex.raDeg) &&
          Number.isFinite(vertex.decDeg) &&
          vertex.decDeg >= -90 &&
          vertex.decDeg <= 90,
      )
      .map((vertex) => coordinateVector(THREE, vertex, 99.25));

    if (vertices.length < 3) continue;

    const selected = Boolean(footprint.selected);
    const color = selected ? 0xffbd68 : 0x47d9ff;
    const centroid = vertices
      .reduce((sum, vertex) => sum.add(vertex.clone().normalize()), new THREE.Vector3())
      .normalize()
      .multiplyScalar(99.25);

    const fillValues: number[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
      for (const vertex of [centroid, vertices[index], vertices[(index + 1) % vertices.length]]) {
        fillValues.push(vertex.x, vertex.y, vertex.z);
      }
    }
    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.Float32BufferAttribute(fillValues, 3));
    const fillMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: selected ? 0.2 : 0.1,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.userData.footprintId = footprint.id;
    group.add(fillMesh);

    const outline: import("three").Vector3[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
      const start = vertices[index].clone().normalize();
      const end = vertices[(index + 1) % vertices.length].clone().normalize();
      const angle = start.angleTo(end);
      const sinAngle = Math.sin(angle);
      const steps = Math.max(6, Math.ceil((angle * 180) / Math.PI / 1.5));
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const point =
          Math.abs(sinAngle) < 1e-6
            ? start.clone().lerp(end, t).normalize()
            : start
                .clone()
                .multiplyScalar(Math.sin((1 - t) * angle) / sinAngle)
                .add(end.clone().multiplyScalar(Math.sin(t * angle) / sinAngle))
                .normalize();
        outline.push(point.multiplyScalar(99.05));
      }
    }
    outline.push(outline[0].clone());
    const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outline);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: selected ? 1 : 0.82,
      depthWrite: false,
    });
    const outlineLine = new THREE.Line(outlineGeometry, outlineMaterial);
    outlineLine.userData.footprintId = footprint.id;
    group.add(outlineLine);
  }

  return group;
}

function disposeObject(object: import("three").Object3D) {
  const candidate = object as import("three").Object3D & {
    geometry?: import("three").BufferGeometry;
    material?: import("three").Material | import("three").Material[];
  };
  candidate.geometry?.dispose();
  const materials = Array.isArray(candidate.material)
    ? candidate.material
    : candidate.material
      ? [candidate.material]
      : [];
  for (const material of materials) {
    const mappedMaterial = material as import("three").Material & { map?: import("three").Texture };
    mappedMaterial.map?.dispose();
    material.dispose();
  }
}

export default function SkyViewport({
  viewCenter,
  fieldOfViewDeg,
  footprints = EMPTY_FOOTPRINTS,
  onViewSettled,
  onFootprintSelect,
}: SkyViewportProps) {
  const safeFootprints = footprints;
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<ViewportRuntime | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewSettledRef = useRef(onViewSettled);
  const onFootprintSelectRef = useRef(onFootprintSelect);
  const footprintsRef = useRef(safeFootprints);
  const requestedRa = viewCenter?.raDeg ?? INITIAL_CENTER.raDeg;
  const requestedDec = viewCenter?.decDeg ?? INITIAL_CENTER.decDeg;
  const requestedCenter = useMemo(
    () => normalizeCoordinate({ raDeg: requestedRa, decDeg: requestedDec }),
    [requestedRa, requestedDec],
  );
  const requestedFov = useMemo(
    () => Math.max(MIN_FOV, Math.min(MAX_FOV, fieldOfViewDeg ?? INITIAL_FOV)),
    [fieldOfViewDeg],
  );
  const desiredViewRef = useRef<SkyViewState>({
    center: requestedCenter,
    fieldOfViewDeg: requestedFov,
  });
  const [view, setView] = useState<SkyViewState>(() => ({
    center: requestedCenter,
    fieldOfViewDeg: requestedFov,
  }));
  const [viewportStatus, setViewportStatus] = useState<"loading" | "ready" | "fallback">("loading");

  useEffect(() => {
    onViewSettledRef.current = onViewSettled;
    onFootprintSelectRef.current = onFootprintSelect;
    footprintsRef.current = safeFootprints;
  }, [onFootprintSelect, onViewSettled, safeFootprints]);

  const refreshViewReadout = useCallback((runtime: ViewportRuntime) => {
    const direction = new runtime.THREE.Vector3();
    runtime.camera.getWorldDirection(direction);
    const nextView = {
      center: coordinateFromDirection(direction),
      fieldOfViewDeg: getHorizontalFieldOfView(runtime.camera),
    };
    desiredViewRef.current = nextView;
    setView(nextView);
    return nextView;
  }, []);

  const scheduleViewSettled = useCallback(
    (runtime: ViewportRuntime) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const nextView = refreshViewReadout(runtime);
        onViewSettledRef.current?.(nextView);
      }, 280);
    },
    [refreshViewReadout],
  );

  useEffect(() => {
    let disposed = false;
    let runtime: ViewportRuntime | null = null;
    let partialRenderer: WebGLRenderer | null = null;
    const container = containerRef.current;
    if (!container) return undefined;

    void import("three")
      .then((THREE) => {
        if (disposed || !containerRef.current) return;

        try {
          const renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            powerPreference: "high-performance",
          });
          partialRenderer = renderer;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
          renderer.setClearColor(0x020611, 1);
          renderer.domElement.className = styles.canvas;
          renderer.domElement.tabIndex = 0;
          renderer.domElement.setAttribute(
            "aria-label",
            "Interactive celestial viewport. Drag to look around, use the arrow keys to pan, and use plus or minus to zoom.",
          );
          renderer.domElement.setAttribute("role", "application");
          container.appendChild(renderer.domElement);

          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
          const texture = createStarfieldTexture(THREE);
          const skyMaterial = new THREE.MeshBasicMaterial({
            color: texture ? 0xffffff : 0x07111f,
            map: texture ?? undefined,
            side: THREE.BackSide,
            depthWrite: false,
          });
          const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 72, 48), skyMaterial);
          scene.add(sky);
          scene.add(createCoordinateGrid(THREE));

          const footprintGroup = createFootprintGroup(THREE, footprintsRef.current);
          scene.add(footprintGroup);

          const resizeObserver = new ResizeObserver(() => {
            const { width, height } = container.getBoundingClientRect();
            if (!width || !height) return;
            renderer.setSize(width, height, false);
            setHorizontalFieldOfView(
              camera,
              desiredViewRef.current.fieldOfViewDeg,
              width / height,
            );
            renderer.render(scene, camera);
          });
          resizeObserver.observe(container);

          const firstRect = container.getBoundingClientRect();
          const aspect = firstRect.width && firstRect.height ? firstRect.width / firstRect.height : 1;
          setHorizontalFieldOfView(camera, desiredViewRef.current.fieldOfViewDeg, aspect);
          setCameraCenter(THREE, camera, desiredViewRef.current.center);
          renderer.setSize(Math.max(firstRect.width, 1), Math.max(firstRect.height, 1), false);
          renderer.render(scene, camera);

          runtime = { THREE, camera, footprintGroup, renderer, scene, resizeObserver };
          runtimeRef.current = runtime;
          setViewportStatus("ready");
          setView({
            center: desiredViewRef.current.center,
            fieldOfViewDeg: desiredViewRef.current.fieldOfViewDeg,
          });

          const raycaster = new THREE.Raycaster();
          const pointer = new THREE.Vector2();
          let pointerStart = { x: 0, y: 0 };
          let pointerLast = { x: 0, y: 0 };
          let isPointerDown = false;
          let hasDragged = false;

          const render = () => {
            if (!disposed) renderer.render(scene, camera);
          };

          const zoomBy = (factor: number) => {
            const aspectNow = camera.aspect || 1;
            const nextHorizontalFov = Math.max(
              MIN_FOV,
              Math.min(MAX_FOV, getHorizontalFieldOfView(camera) * factor),
            );
            setHorizontalFieldOfView(camera, nextHorizontalFov, aspectNow);
            render();
            const nextView = refreshViewReadout(runtime!);
            scheduleViewSettled(runtime!);
            return nextView;
          };

          const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            isPointerDown = true;
            hasDragged = false;
            pointerStart = { x: event.clientX, y: event.clientY };
            pointerLast = pointerStart;
            renderer.domElement.setPointerCapture(event.pointerId);
            renderer.domElement.style.cursor = "grabbing";
          };

          const onPointerMove = (event: PointerEvent) => {
            if (!isPointerDown) return;
            const rect = renderer.domElement.getBoundingClientRect();
            const deltaX = event.clientX - pointerLast.x;
            const deltaY = event.clientY - pointerLast.y;
            pointerLast = { x: event.clientX, y: event.clientY };
            if (
              Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5
            ) {
              hasDragged = true;
            }
            if (!hasDragged || !rect.width || !rect.height) return;

            const horizontalRadians = (getHorizontalFieldOfView(camera) * Math.PI) / 180;
            const verticalRadians = (camera.fov * Math.PI) / 180;
            const yaw = new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
              (-deltaX / rect.width) * horizontalRadians,
            );
            camera.quaternion.premultiply(yaw);
            const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const pitch = new THREE.Quaternion().setFromAxisAngle(
              cameraRight,
              (deltaY / rect.height) * verticalRadians,
            );
            camera.quaternion.premultiply(pitch);
            camera.updateMatrixWorld();
            render();
            refreshViewReadout(runtime!);
            scheduleViewSettled(runtime!);
          };

          const onPointerUp = (event: PointerEvent) => {
            if (!isPointerDown) return;
            isPointerDown = false;
            renderer.domElement.style.cursor = "grab";
            if (!hasDragged) {
              const rect = renderer.domElement.getBoundingClientRect();
              pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
              pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
              raycaster.setFromCamera(pointer, camera);
              const intersections = raycaster.intersectObjects(
                runtime!.footprintGroup.children,
                true,
              );
              const selectedObject = intersections.find(
                (intersection) => typeof intersection.object.userData.footprintId === "string",
              );
              const selectedId = selectedObject?.object.userData.footprintId;
              if (typeof selectedId === "string") onFootprintSelectRef.current?.(selectedId);
            }
            if (hasDragged) scheduleViewSettled(runtime!);
          };

          const onPointerCancel = () => {
            isPointerDown = false;
            renderer.domElement.style.cursor = "grab";
          };

          const onWheel = (event: WheelEvent) => {
            event.preventDefault();
            zoomBy(Math.exp(event.deltaY * 0.001));
          };

          const onKeyDown = (event: KeyboardEvent) => {
            const key = event.key;
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "Home"].includes(key)) {
              return;
            }
            event.preventDefault();
            if (key === "+" || key === "=") {
              zoomBy(0.84);
              return;
            }
            if (key === "-") {
              zoomBy(1.19);
              return;
            }
            if (key === "Home") {
              setHorizontalFieldOfView(camera, INITIAL_FOV, camera.aspect || 1);
              setCameraCenter(THREE, camera, INITIAL_CENTER);
              render();
              refreshViewReadout(runtime!);
              scheduleViewSettled(runtime!);
              return;
            }

            const horizontalStep = (getHorizontalFieldOfView(camera) * Math.PI) / 180 / 14;
            const verticalStep = (camera.fov * Math.PI) / 180 / 14;
            const direction = key === "ArrowLeft" || key === "ArrowUp" ? 1 : -1;
            const axis =
              key === "ArrowLeft" || key === "ArrowRight"
                ? new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
                : new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            const amount =
              key === "ArrowLeft" || key === "ArrowRight" ? horizontalStep : verticalStep;
            camera.quaternion.premultiply(
              new THREE.Quaternion().setFromAxisAngle(axis, direction * amount),
            );
            camera.updateMatrixWorld();
            render();
            refreshViewReadout(runtime!);
            scheduleViewSettled(runtime!);
          };

          renderer.domElement.addEventListener("pointerdown", onPointerDown);
          renderer.domElement.addEventListener("pointermove", onPointerMove);
          renderer.domElement.addEventListener("pointerup", onPointerUp);
          renderer.domElement.addEventListener("pointercancel", onPointerCancel);
          renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
          renderer.domElement.addEventListener("keydown", onKeyDown);

          const removeInteractionListeners = () => {
            renderer.domElement.removeEventListener("pointerdown", onPointerDown);
            renderer.domElement.removeEventListener("pointermove", onPointerMove);
            renderer.domElement.removeEventListener("pointerup", onPointerUp);
            renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
            renderer.domElement.removeEventListener("wheel", onWheel);
            renderer.domElement.removeEventListener("keydown", onKeyDown);
          };
          (runtime as ViewportRuntime & { removeInteractionListeners?: () => void }).removeInteractionListeners =
            removeInteractionListeners;
        } catch {
          partialRenderer?.dispose();
          partialRenderer?.domElement.remove();
          setViewportStatus("fallback");
        }
      })
      .catch(() => setViewportStatus("fallback"));

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      runtime?.resizeObserver.disconnect();
      if (runtime) {
        (runtime as ViewportRuntime & { removeInteractionListeners?: () => void })
          .removeInteractionListeners?.();
        runtime.scene.traverse(disposeObject);
        runtime.renderer.dispose();
        runtime.renderer.domElement.remove();
      } else {
        partialRenderer?.dispose();
        partialRenderer?.domElement.remove();
      }
      runtimeRef.current = null;
    };
  }, [refreshViewReadout, scheduleViewSettled]);

  useEffect(() => {
    desiredViewRef.current = {
      center: requestedCenter,
      fieldOfViewDeg: requestedFov,
    };
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setCameraCenter(runtime.THREE, runtime.camera, requestedCenter);
    setHorizontalFieldOfView(
      runtime.camera,
      requestedFov,
      runtime.camera.aspect || 1,
    );
    runtime.renderer.render(runtime.scene, runtime.camera);
    setView({ center: requestedCenter, fieldOfViewDeg: requestedFov });
  }, [requestedCenter, requestedFov]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;

    const nextGroup = createFootprintGroup(runtime.THREE, safeFootprints);
    runtime.footprintGroup.traverse(disposeObject);
    runtime.scene.remove(runtime.footprintGroup);
    runtime.scene.add(nextGroup);
    runtime.footprintGroup = nextGroup;
    runtime.renderer.render(runtime.scene, runtime.camera);
  }, [safeFootprints]);

  const zoomIn = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const nextFov = Math.max(MIN_FOV, getHorizontalFieldOfView(runtime.camera) * 0.84);
    setHorizontalFieldOfView(runtime.camera, nextFov, runtime.camera.aspect || 1);
    runtime.renderer.render(runtime.scene, runtime.camera);
    refreshViewReadout(runtime);
    scheduleViewSettled(runtime);
  };

  const zoomOut = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const nextFov = Math.min(MAX_FOV, getHorizontalFieldOfView(runtime.camera) * 1.19);
    setHorizontalFieldOfView(runtime.camera, nextFov, runtime.camera.aspect || 1);
    runtime.renderer.render(runtime.scene, runtime.camera);
    refreshViewReadout(runtime);
    scheduleViewSettled(runtime);
  };

  const resetView = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setCameraCenter(runtime.THREE, runtime.camera, INITIAL_CENTER);
    setHorizontalFieldOfView(runtime.camera, INITIAL_FOV, runtime.camera.aspect || 1);
    runtime.renderer.render(runtime.scene, runtime.camera);
    refreshViewReadout(runtime);
    scheduleViewSettled(runtime);
  };

  return (
    <main className={styles.cockpit} aria-label="SkyDetective celestial cockpit">
      <div className={styles.viewport} ref={containerRef}>
        {viewportStatus === "fallback" && (
          <div className={styles.fallback} role="status">
            <div className={styles.fallbackStars} aria-hidden="true" />
            <div className={styles.fallbackMessage}>
              <span className={styles.fallbackEyebrow}>VIEWPORT SYSTEM</span>
              <strong>3D sky view unavailable</strong>
              <span>Enable WebGL or open SkyDetective in a supported browser.</span>
            </div>
          </div>
        )}

        <div className={styles.canopy} aria-hidden="true" />
        <div className={styles.reticle} aria-hidden="true">
          <span className={styles.reticleRing} />
          <span className={styles.reticleHorizontal} />
          <span className={styles.reticleVertical} />
          <span className={styles.reticleDot} />
        </div>

        <header className={styles.topHud}>
          <div className={styles.brand}>
            <div className={styles.brandMark} aria-hidden="true">
              <span />
            </div>
            <div>
              <p className={styles.kicker}>FLIGHT DECK · DEEP SKY</p>
              <h1>SkyDetective</h1>
            </div>
          </div>
          <div className={styles.systemStatus}>
            <span className={styles.statusDot} />
            <div>
              <strong>CELESTIAL VIEWPORT</strong>
              <span>INSIDE-OUT NAVIGATION</span>
            </div>
          </div>
        </header>

        <section className={styles.coordinatePanel} aria-live="polite" aria-label="View center coordinates">
          <div className={styles.panelTitle}>
            <span className={styles.panelGlyph}>◉</span>
            <span>RETICLE COORDINATES</span>
          </div>
          <div className={styles.coordinateRow}>
            <span>RA</span>
            <strong>{formatCoordinate(view.center.raDeg, "RA")}</strong>
          </div>
          <div className={styles.coordinateRow}>
            <span>DEC</span>
            <strong>{formatCoordinate(view.center.decDeg, "DEC")}</strong>
          </div>
          <div className={styles.readoutDivider} />
          <div className={styles.coordinateRow}>
            <span>FIELD</span>
            <strong>{view.fieldOfViewDeg.toFixed(1)}°</strong>
          </div>
        </section>

        <section className={styles.layerPanel} aria-label="Viewport layers">
          <div className={styles.panelTitle}>
            <span className={styles.layerGlyph} />
            <span>SKY LAYERS</span>
          </div>
          <div className={styles.layerRow}>
            <span className={styles.layerSwatch} />
            <span>Illustrative starfield</span>
            <span className={styles.layerState}>VISUAL</span>
          </div>
          <div className={styles.layerRow}>
            <span className={`${styles.layerSwatch} ${styles.footprintSwatch}`} />
            <span>Observation footprints</span>
            <span className={styles.layerState}>{safeFootprints.length}</span>
          </div>
          <p className={styles.layerNote}>Archive footprints appear when supplied by the parent view.</p>
        </section>

        <nav className={styles.navControls} aria-label="Sky navigation controls">
          <span className={styles.controlLabel}>VIEW CONTROLS</span>
          <button type="button" onClick={zoomIn} aria-label="Zoom in" title="Zoom in">
            <span aria-hidden="true">+</span>
          </button>
          <button type="button" onClick={zoomOut} aria-label="Zoom out" title="Zoom out">
            <span aria-hidden="true">−</span>
          </button>
          <button type="button" onClick={resetView} aria-label="Reset sky view" title="Reset sky view">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 11.8a8 8 0 1 1 2.2 5.5M4 6.2v5.6h5.6" />
            </svg>
          </button>
        </nav>

        <footer className={styles.bottomConsole}>
          <div className={styles.consoleEdge} aria-hidden="true" />
          <div className={styles.consoleHint}>
            <span className={styles.inputGlyph} aria-hidden="true">⌖</span>
            <span><strong>DRAG</strong> to look around</span>
          </div>
          <span className={styles.consoleDivider} aria-hidden="true" />
          <div className={styles.consoleHint}>
            <span className={styles.wheelGlyph} aria-hidden="true">↕</span>
            <span><strong>SCROLL</strong> to adjust field</span>
          </div>
          <span className={styles.consoleDivider} aria-hidden="true" />
          <div className={styles.consoleHint}>
            <span className={styles.centerGlyph} aria-hidden="true">◎</span>
            <span>Crosshair stays centered</span>
          </div>
          <span className={styles.consoleTip}>ARROWS TO PAN · +/- TO ZOOM · HOME TO RESET</span>
        </footer>

        <div className={styles.ambientLabel} aria-hidden="true">
          <span>VIEWPORT</span>
          <span className={styles.ambientLine} />
          <span>360° CELESTIAL SPHERE</span>
        </div>
      </div>
      <span className={styles.srOnly} role="status">
        {viewportStatus === "loading" ? "Loading 3D sky viewport" : "3D sky viewport ready"}
      </span>
    </main>
  );
}
