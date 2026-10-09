"use client";

import Script from "next/script";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import SpherexComparison from "./spherex-comparison";
import SavedPositions from "./saved-positions";
import ObjectSearch from "./object-search";
import AreaBrowser from "./area-browser";
import ResearchTools from "./research-tools";
import { parseSharedView } from "./sky-data";
import {
  DEMO_CENTER,
  DEMO_FIELD_OF_VIEW_DEG,
  DEMO_FOOTPRINT_ID,
  DEMO_FOOTPRINTS,
} from "./spherex-demo";
import type { SkyCoordinate, SkyFootprint, SkyViewState } from "./sky-types";
import styles from "./sky-viewport.module.css";

export type { SkyCoordinate, SkyFootprint, SkyViewState } from "./sky-types";

type SkyViewportProps = {
  viewCenter?: SkyCoordinate;
  fieldOfViewDeg?: number;
  footprints?: readonly SkyFootprint[];
  onViewSettled?: (view: SkyViewState) => void;
  onFootprintSelect?: (id: string) => void;
};

type SurveyId = "optical" | "infrared";

type AladinOverlay = {
  addFootprints: (footprints: unknown | readonly unknown[]) => void;
};

type AladinInstance = {
  addOverlay: (overlay: AladinOverlay) => void;
  decreaseZoom: () => void;
  getFoV: () => number[];
  getRaDec: () => number[];
  gotoRaDec: (ra: number, dec: number) => void;
  increaseZoom: () => void;
  off?: (event: string) => void;
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  pix2world: (x: number, y: number, frame?: string) => number[];
  removeOverlay: (overlay: AladinOverlay) => void;
  setBaseImageLayer: (surveyId: string) => void;
  setCooGrid: (options: { enabled: boolean; color?: string; opacity?: number; thickness?: number; labelSize?: number }) => void;
  setDefaultColor: (color: string) => void;
  setFoV: (fov: number) => void;
  setFoVRange: (minFoV: number, maxFoV: number) => void;
  showReticle: (show: boolean) => void;
  destroy?: () => void;
};

type AladinGlobal = {
  init: Promise<void>;
  aladin: (element: HTMLElement, options: Record<string, unknown>) => AladinInstance;
  graphicOverlay: (options: Record<string, unknown>) => AladinOverlay;
  footprint: (shapes: readonly unknown[], source?: unknown) => unknown;
  polygon: (radec: readonly (readonly [number, number])[], options: Record<string, unknown>) => unknown;
  source: (ra: number, dec: number, data?: Record<string, unknown>) => unknown;
};

declare global {
  interface Window {
    A?: AladinGlobal;
  }
}

const SURVEYS: Record<SurveyId, { id: string; label: string; detail: string }> = {
  optical: {
    id: "P/DSS2/color",
    label: "Optical color",
    detail: "DSS2 · visible light",
  },
  infrared: {
    id: "P/2MASS/color",
    label: "Near-infrared",
    detail: "2MASS · infrared",
  },
};

const SURVEY_STORAGE_KEY = "skydetective.base-survey";
const ALADIN_SCRIPT = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
const MIN_FIELD_OF_VIEW = 0.03;
const MAX_FIELD_OF_VIEW = 120;

function normalizeCoordinate(coordinate: SkyCoordinate): SkyCoordinate {
  const ra = Number.isFinite(coordinate.raDeg) ? coordinate.raDeg : 0;
  const dec = Number.isFinite(coordinate.decDeg) ? coordinate.decDeg : 0;
  return {
    raDeg: ((ra % 360) + 360) % 360,
    decDeg: Math.max(-90, Math.min(90, dec)),
  };
}

function normalizeFieldOfView(value: number) {
  return Math.max(MIN_FIELD_OF_VIEW, Math.min(MAX_FIELD_OF_VIEW, value));
}

function skyVector(coordinate: SkyCoordinate): [number, number, number] {
  const ra = (coordinate.raDeg * Math.PI) / 180;
  const dec = (coordinate.decDeg * Math.PI) / 180;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

function dot(a: readonly number[], b: readonly number[]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function subtract(a: readonly number[], b: readonly number[], scale: number): [number, number, number] {
  return [a[0] - b[0] * scale, a[1] - b[1] * scale, a[2] - b[2] * scale];
}

function pointInSphericalPolygon(point: SkyCoordinate, vertices: readonly SkyCoordinate[]) {
  if (vertices.length < 3) return false;

  const p = skyVector(point);
  let winding = 0;

  for (let index = 0; index < vertices.length; index += 1) {
    const first = skyVector(vertices[index]);
    const second = skyVector(vertices[(index + 1) % vertices.length]);
    const a = subtract(first, p, dot(first, p));
    const b = subtract(second, p, dot(second, p));
    const aLength = Math.hypot(a[0], a[1], a[2]);
    const bLength = Math.hypot(b[0], b[1], b[2]);

    if (aLength < 1e-10 || bLength < 1e-10) return true;

    winding += Math.atan2(dot(p, cross(a, b)), dot(a, b));
  }

  return Math.abs(winding) > Math.PI;
}

function footprintFromEvent(args: readonly unknown[]) {
  for (const value of args) {
    if (!value || typeof value !== "object") continue;
    const object = value as {
      data?: { id?: unknown };
      source?: { data?: { id?: unknown } };
    };
    const id = object.source?.data?.id ?? object.data?.id;
    if (typeof id === "string") return id;
  }
  return null;
}

function formatCoordinate(value: number, kind: "RA" | "DEC") {
  const sign = kind === "DEC" && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}°`;
}

function createFootprintOverlay(
  api: AladinGlobal,
  map: AladinInstance,
  footprints: readonly SkyFootprint[],
  selectedId: string | null,
) {
  const overlay = api.graphicOverlay({
    name: "SPHEREx observation footprints",
    color: "#55d8ec",
    lineWidth: 2,
  });

  for (const footprint of footprints) {
    if (footprint.vertices.length < 3) continue;
    const selected = footprint.id === selectedId;
    const vertices = footprint.vertices.map(
      ({ raDeg, decDeg }) => [raDeg, decDeg] as const,
    );
    const polygon = api.polygon(vertices, {
      color: selected ? "#ffd18a" : "#67d9ee",
      fill: true,
      fillColor: selected ? "#ffd18a" : "#67d9ee",
      opacity: selected ? 0.14 : 0.07,
      lineWidth: selected ? 3 : 2,
      selectionColor: "#fff0cc",
      hoverColor: "#ffffff",
    });
    const anchor = footprint.vertices[0];
    const source = api.source(anchor.raDeg, anchor.decDeg, { id: footprint.id });
    const shape = api.footprint([polygon], source);
    overlay.addFootprints(shape);
  }

  map.addOverlay(overlay);
  return overlay;
}

export default function SkyViewport({
  viewCenter,
  fieldOfViewDeg,
  footprints = DEMO_FOOTPRINTS,
  onViewSettled,
  onFootprintSelect,
}: SkyViewportProps) {
  const requestedCenter = normalizeCoordinate(viewCenter ?? DEMO_CENTER);
  const requestedFov = normalizeFieldOfView(fieldOfViewDeg ?? DEMO_FIELD_OF_VIEW_DEG);
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AladinInstance | null>(null);
  const apiRef = useRef<AladinGlobal | null>(null);
  const overlayRef = useRef<AladinOverlay | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewSettledRef = useRef(onViewSettled);
  const onFootprintSelectRef = useRef(onFootprintSelect);
  const selectedFootprintIdRef = useRef<string | null>(null);
  const appliedSurveyRef = useRef<SurveyId | null>(null);
  const footprintsRef = useRef(footprints);

  const [scriptReady, setScriptReady] = useState(false);
  const [surveyPreferenceReady, setSurveyPreferenceReady] = useState(false);
  const [surveyChoice, setSurveyChoice] = useState<SurveyId>("optical");
  const [showSurveyPicker, setShowSurveyPicker] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [localStarfieldRequested, setLocalStarfieldRequested] = useState(false);
  const [selectedFootprintId, setSelectedFootprintId] = useState<string | null>(null);
  const [gridVisible, setGridVisible] = useState(true);
  const [showNavigator, setShowNavigator] = useState(false);
  const [showSavedPositions, setShowSavedPositions] = useState(false);
  const [showObjectSearch, setShowObjectSearch] = useState(false);
  const [showAreas, setShowAreas] = useState(false);
  const [showResearch, setShowResearch] = useState(false);
  const initialSharedViewRef = useRef<ReturnType<typeof parseSharedView>>(null);
  const [navigationError, setNavigationError] = useState("");
  const [navigationTarget, setNavigationTarget] = useState({ ra: "", dec: "", fov: "" });
  const [view, setView] = useState<SkyViewState>(() => ({
    center: requestedCenter,
    fieldOfViewDeg: requestedFov,
  }));
  const hasControlledCenter = viewCenter !== undefined;
  const visibleSelectedFootprintId = footprints.some(
    (footprint) => footprint.id === selectedFootprintId,
  )
    ? selectedFootprintId
    : null;
  const showLocalStarfield = localStarfieldRequested || mapStatus === "fallback";
  const mapControlsDisabled = mapStatus !== "ready" || showLocalStarfield;

  useEffect(() => {
    onViewSettledRef.current = onViewSettled;
    onFootprintSelectRef.current = onFootprintSelect;
  }, [onFootprintSelect, onViewSettled]);

  useEffect(() => {
    footprintsRef.current = footprints;
  }, [footprints]);

  useEffect(() => {
    let cancelled = false;
    const restorePreference = async () => {
      // Read browser-only storage after hydration, before creating the survey view.
      await Promise.resolve();
      let savedSurvey: string | null = null;
      try {
        savedSurvey = window.localStorage.getItem(SURVEY_STORAGE_KEY);
      } catch {
        // Storage can be unavailable in private browsing contexts.
      }
      if (cancelled) return;
      const sharedView = parseSharedView(window.location.search);
      initialSharedViewRef.current = sharedView;
      if (sharedView && !hasControlledCenter) {
        setView(sharedView);
        savedSurvey = sharedView.survey;
      }

      if (savedSurvey === "optical" || savedSurvey === "infrared") {
        setSurveyChoice(savedSurvey);
        setShowSurveyPicker(false);
      } else {
        setShowSurveyPicker(true);
      }
      setSurveyPreferenceReady(true);
    };

    void restorePreference();
    return () => {
      cancelled = true;
    };
  }, [hasControlledCenter]);

  useEffect(() => {
    if (mapStatus !== "loading") return;
    const timer = setTimeout(() => setMapStatus((status) => status === "loading" ? "fallback" : status), 20000);
    return () => clearTimeout(timer);
  }, [mapStatus]);

  const updateViewFromMap = useCallback((map: AladinInstance) => {
    const [raDeg, decDeg] = map.getRaDec();
    const [mapFov] = map.getFoV();
    const nextView = {
      center: normalizeCoordinate({ raDeg, decDeg }),
      fieldOfViewDeg: normalizeFieldOfView(mapFov),
    };
    setView(nextView);
    return nextView;
  }, []);

  const scheduleViewSettled = useCallback(
    (map: AladinInstance) => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        onViewSettledRef.current?.(updateViewFromMap(map));
      }, 280);
    },
    [updateViewFromMap],
  );

  const selectFootprint = useCallback((id: string) => {
    if (selectedFootprintIdRef.current === id) return;
    selectedFootprintIdRef.current = id;
    setSelectedFootprintId(id);
    onFootprintSelectRef.current?.(id);
  }, []);

  useEffect(() => {
    const mapHost = mapHostRef.current;
    if (!scriptReady || !surveyPreferenceReady || !mapHost) return undefined;

    let cancelled = false;
    let activeMap: AladinInstance | null = null;

    const initializeMap = async () => {
      try {
        const api = window.A;
        if (!api) throw new Error("Aladin Lite did not load");

        await api.init;
        if (cancelled) return;

        const sharedView = !hasControlledCenter ? initialSharedViewRef.current : null;
        const initialCenter = sharedView?.center ?? requestedCenter;
        activeMap = api.aladin(mapHost, {
          target: `${initialCenter.raDeg} ${initialCenter.decDeg}`,
          survey: SURVEYS[surveyChoice].id,
          cooFrame: "ICRSd",
          projection: "TAN",
          fov: fieldOfViewDeg === undefined ? sharedView?.fieldOfViewDeg ?? requestedFov : requestedFov,
          mode: "dark",
          inertia: true,
          showZoomControl: false,
          showLayersControl: false,
          showFullscreenControl: false,
          showSimbadPointerControl: false,
          showCooGridControl: false,
          showSettingsControl: false,
          showColorPickerControl: false,
          showShareControl: false,
          showProjectionControl: false,
          showStatusBar: true,
          showFrame: false,
          showFov: false,
          showCooLocation: false,
          showReticle: false,
          showCooGrid: true,
          gridColor: "#83c6d8",
          gridOpacity: 0.34,
          gridOptions: {
            color: "#83c6d8",
            opacity: 0.34,
            thickness: 1,
            labelSize: 11,
            showLabels: true,
          },
        });
        if (cancelled) {
          activeMap.destroy?.();
          return;
        }

        apiRef.current = api;
        mapRef.current = activeMap;
        appliedSurveyRef.current = surveyChoice;
        activeMap.setDefaultColor("#78d9ed");
        activeMap.setFoVRange(MIN_FIELD_OF_VIEW, MAX_FIELD_OF_VIEW);
        activeMap.setCooGrid({
          enabled: true,
          color: "#83c6d8",
          opacity: 0.34,
          thickness: 1,
          labelSize: 11,
        });

        activeMap.on("positionChanged", (...args) => {
          const event = (args[0] ?? {}) as { dragging?: boolean };
          updateViewFromMap(activeMap!);
          if (!event.dragging) scheduleViewSettled(activeMap!);
        });
        activeMap.on("zoomChanged", () => {
          updateViewFromMap(activeMap!);
          scheduleViewSettled(activeMap!);
        });
        activeMap.on("footprintClicked", (...args) => {
          const id = footprintFromEvent(args);
          if (id && footprintsRef.current.some((footprint) => footprint.id === id)) {
            selectFootprint(id);
          }
        });

        setMapStatus("ready");
        updateViewFromMap(activeMap);
      } catch {
        if (!cancelled) setMapStatus("fallback");
      }
    };

    void initializeMap();

    return () => {
      cancelled = true;
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
      if (activeMap) {
        activeMap.off?.("positionChanged");
        activeMap.off?.("zoomChanged");
        activeMap.off?.("footprintClicked");
        activeMap.destroy?.();
      }
      if (mapRef.current === activeMap) mapRef.current = null;
      if (apiRef.current === window.A) apiRef.current = null;
      overlayRef.current = null;
      mapHost.replaceChildren();
    };
    // The map is created once from the restored survey preference; later survey changes use setBaseImageLayer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptReady, surveyPreferenceReady]);

  useEffect(() => {
    const map = mapRef.current;
    const api = apiRef.current;
    if (!map || !api || mapStatus !== "ready") return;

    if (overlayRef.current) map.removeOverlay(overlayRef.current);
    overlayRef.current = createFootprintOverlay(api, map, footprints, visibleSelectedFootprintId);

    return () => {
      if (overlayRef.current) map.removeOverlay(overlayRef.current);
      overlayRef.current = null;
    };
  }, [footprints, mapStatus, visibleSelectedFootprintId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    if (appliedSurveyRef.current === surveyChoice) return;
    map.setBaseImageLayer(SURVEYS[surveyChoice].id);
    appliedSurveyRef.current = surveyChoice;
    try {
      window.localStorage.setItem(SURVEY_STORAGE_KEY, surveyChoice);
    } catch {
      // The selected survey still works for this session if storage is unavailable.
    }
  }, [mapStatus, surveyChoice]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || mapStatus !== "ready") return;
    if (hasControlledCenter) map.gotoRaDec(requestedCenter.raDeg, requestedCenter.decDeg);
    if (fieldOfViewDeg !== undefined) map.setFoV(requestedFov);
  }, [fieldOfViewDeg, hasControlledCenter, mapStatus, requestedCenter.decDeg, requestedCenter.raDeg, requestedFov]);

  useEffect(() => {
    const closePanels = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowNavigator(false); setShowSavedPositions(false); setShowObjectSearch(false); setShowAreas(false); setShowResearch(false); setShowSurveyPicker(false);
      selectedFootprintIdRef.current = null;
      setSelectedFootprintId(null);
    };
    window.addEventListener("keydown", closePanels);
    return () => window.removeEventListener("keydown", closePanels);
  }, []);

  const handleSurveyChange = useCallback((nextSurvey: SurveyId) => {
    setSurveyChoice(nextSurvey);
    setShowSurveyPicker(false);
    try {
      window.localStorage.setItem(SURVEY_STORAGE_KEY, nextSurvey);
    } catch {
      // The in-memory selection remains active for this session.
    }
  }, []);

  const resetView = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      map.gotoRaDec(requestedCenter.raDeg, requestedCenter.decDeg);
      map.setFoV(requestedFov);
    }
    setView({ center: requestedCenter, fieldOfViewDeg: requestedFov });
  }, [requestedCenter, requestedFov]);

  const selectFootprintAt = useCallback(
    (coordinate: SkyCoordinate) => {
      const match = footprints.find((footprint) =>
        pointInSphericalPolygon(coordinate, footprint.vertices),
      );
      if (match) selectFootprint(match.id);
    },
    [footprints, selectFootprint],
  );

  const handleMapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.target instanceof Element && event.target.closest(".aladin-status-bar")) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handleMapPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      const map = mapRef.current;
      const host = mapHostRef.current;
      if (!start || !map || !host || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) {
        return;
      }
      const bounds = host.getBoundingClientRect();
      const [raDeg, decDeg] = map.pix2world(event.clientX - bounds.left, event.clientY - bounds.top, "ICRS");
      if (Number.isFinite(raDeg) && Number.isFinite(decDeg)) {
        selectFootprintAt({ raDeg, decDeg });
      }
    },
    [selectFootprintAt],
  );

  const handleMapKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const map = mapRef.current;
      if (!map) return;
      const [raDeg, decDeg] = map.getRaDec();
      const [currentFov] = map.getFoV();
      const step = Math.max(currentFov * 0.14, 0.02);
      const decStep = Math.sign(decDeg || 1) * Math.cos((decDeg * Math.PI) / 180);
      const next: SkyCoordinate = { raDeg, decDeg };

      switch (event.key) {
        case "ArrowLeft":
          next.raDeg -= step / Math.max(Math.abs(decStep), 0.12);
          break;
        case "ArrowRight":
          next.raDeg += step / Math.max(Math.abs(decStep), 0.12);
          break;
        case "ArrowUp":
          next.decDeg += step;
          break;
        case "ArrowDown":
          next.decDeg -= step;
          break;
        case "+":
        case "=":
        case "Add":
          event.preventDefault();
          map.setFoV(normalizeFieldOfView(currentFov * 0.82));
          scheduleViewSettled(map);
          return;
        case "-":
        case "Subtract":
          event.preventDefault();
          map.setFoV(normalizeFieldOfView(currentFov / 0.82));
          scheduleViewSettled(map);
          return;
        case "Home":
          event.preventDefault();
          resetView();
          return;
        case "Enter":
        case " ":
          event.preventDefault();
          selectFootprintAt({ raDeg, decDeg });
          return;
        default:
          return;
      }

      event.preventDefault();
      map.gotoRaDec(normalizeCoordinate(next).raDeg, normalizeCoordinate(next).decDeg);
      scheduleViewSettled(map);
    },
    [resetView, scheduleViewSettled, selectFootprintAt],
  );

  const activeFootprintIsDemo = visibleSelectedFootprintId === DEMO_FOOTPRINT_ID;

  return (
    <main className={styles.cockpit}>
      <Script
        id="aladin-lite-v3"
        src={ALADIN_SCRIPT}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setMapStatus("fallback")}
      />

      <section className={styles.viewport} aria-label="Interactive SPHEREx sky atlas">
        <div className={styles.starfieldFallback} aria-hidden="true" />
        <div
          className={`${styles.mapHost} ${showLocalStarfield ? styles.mapHidden : ""}`}
          ref={mapHostRef}
          role="application"
          tabIndex={0}
          aria-label="Interactive sky map. Drag or swipe to pan, scroll or pinch to zoom, use the arrow keys to navigate, plus and minus to zoom, and Home to return to the SPHEREx demo field."
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Home Enter"
          onKeyDown={handleMapKeyDown}
          onPointerDownCapture={handleMapPointerDown}
          onPointerUpCapture={handleMapPointerUp}
          onPointerCancelCapture={() => {
            pointerStartRef.current = null;
          }}
        />
        <div className={styles.viewportShade} aria-hidden="true" />
        <div className={styles.canopy} aria-hidden="true" />

        <div className={styles.reticle} aria-hidden="true">
          <span className={styles.reticleRing} />
          <span className={styles.reticleHorizontal} />
          <span className={styles.reticleVertical} />
          <span className={styles.reticleDot} />
        </div>

        <header className={styles.topBar}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              <span />
            </span>
            <div>
              <p className={styles.kicker}>FLIGHT DECK · SPHEREx ARCHIVE</p>
              <h1>SkyDetective</h1>
            </div>
          </div>

          <div className={styles.topActions}>
            <label className={styles.surveySelect}>
              <span>SKY SURVEY</span>
              <select
                aria-label="Choose sky survey background"
                value={surveyChoice}
                onChange={(event) => handleSurveyChange(event.currentTarget.value as SurveyId)}
                disabled={mapStatus !== "ready"}
              >
                <option value="optical">Optical color · DSS2</option>
                <option value="infrared">Near-infrared · 2MASS</option>
              </select>
            </label>
            <button
              className={styles.compareButton}
              type="button"
              aria-label="Compare demo observations across dates"
              title="Compare demo observations across dates"
              onClick={() => {
                const demoFootprint = footprints.find((footprint) => footprint.id === DEMO_FOOTPRINT_ID);
                if (demoFootprint) {
                  const map = mapRef.current;
                  if (map) {
                    map.gotoRaDec(DEMO_CENTER.raDeg, DEMO_CENTER.decDeg);
                    map.setFoV(DEMO_FIELD_OF_VIEW_DEG);
                    updateViewFromMap(map);
                  }
                  selectFootprint(demoFootprint.id);
                }
              }}
              disabled={!footprints.some((footprint) => footprint.id === DEMO_FOOTPRINT_ID)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 4.5h14M3 10h14M3 15.5h14M7 2v16m6-16v16" />
              </svg>
              Compare dates
            </button>
          </div>
        </header>

        {showSurveyPicker && surveyPreferenceReady && (
          <section className={styles.surveyPicker} aria-label="Choose a sky survey">
            <div className={styles.pickerHeading}>
              <p className={styles.panelEyebrow}>PICK YOUR SKY</p>
              <span>Choose the background atlas</span>
            </div>
            {(Object.entries(SURVEYS) as [SurveyId, (typeof SURVEYS)[SurveyId]][]).map(
              ([id, survey]) => (
                <button
                  className={styles.surveyOption}
                  type="button"
                  key={id}
                  onClick={() => handleSurveyChange(id)}
                >
                  <span className={styles.surveyOptionGlyph} aria-hidden="true">
                    {id === "optical" ? "◉" : "◌"}
                  </span>
                  <span>
                    <strong>{survey.label}</strong>
                    <small>{survey.detail}</small>
                  </span>
                  <span className={styles.optionArrow} aria-hidden="true">↗</span>
                </button>
              ),
            )}
            <p className={styles.pickerNote}>You can switch surveys at any time.</p>
          </section>
        )}

        <nav className={styles.controlDock} aria-label="Sky map controls">
          <span className={styles.controlLabel}>NAVIGATE</span>
          <button
            type="button"
            aria-label="Go to sky coordinates"
            title="Go to sky coordinates"
            aria-expanded={showNavigator}
            aria-controls="coordinate-navigator"
            disabled={mapControlsDisabled}
            onClick={() => {
              setNavigationTarget({ ra: String(view.center.raDeg), dec: String(view.center.decDeg), fov: String(view.fieldOfViewDeg) });
              setNavigationError("");
              setShowNavigator((visible) => !visible);
              setShowSavedPositions(false);
              setShowObjectSearch(false);
          setShowAreas(false);
          setShowResearch(false);
              setShowSurveyPicker(false);
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5" /><path d="M10 2v5m0 6v5M2 10h5m6 0h5" /></svg>
          </button>
          <button type="button" aria-label="Zoom in" title="Zoom in" disabled={mapControlsDisabled} onClick={() => mapRef.current?.increaseZoom()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" disabled={mapControlsDisabled} onClick={() => mapRef.current?.decreaseZoom()}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg>
          </button>
          <span className={styles.dockDivider} aria-hidden="true" />
          <button
            className={gridVisible ? styles.controlActive : ""}
            type="button"
            aria-label={gridVisible ? "Hide coordinate grid" : "Show coordinate grid"}
            aria-pressed={gridVisible}
            title={gridVisible ? "Hide coordinate grid" : "Show coordinate grid"}
            disabled={mapControlsDisabled}
            onClick={() => {
              const nextGridVisible = !gridVisible;
              setGridVisible(nextGridVisible);
              mapRef.current?.setCooGrid({ enabled: nextGridVisible, color: "#83c6d8", opacity: 0.34, thickness: 1, labelSize: 11 });
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.8" /><path d="M3.7 10h12.6M10 3.2v13.6M5.1 5.3c2.9 2 6.9 2 9.8 0M5.1 14.7c2.9-2 6.9-2 9.8 0" /></svg>
          </button>
          <span className={styles.dockDivider} aria-hidden="true" />
          <button
            className={showLocalStarfield ? styles.controlActive : ""}
            type="button"
            aria-label={showLocalStarfield ? "Local starfield active" : "Use local starfield fallback"}
            aria-pressed={showLocalStarfield}
            title={mapStatus === "fallback" ? "Survey atlas unavailable; local starfield active" : showLocalStarfield ? "Return to live sky survey" : "Use local starfield fallback"}
            disabled={mapStatus === "fallback"}
            onClick={() => setLocalStarfieldRequested((isRequested) => !isRequested)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2.8 1.45 4.25 4.25 1.45-4.25 1.45L10 14.2l-1.45-4.25L4.3 8.5l4.25-1.45L10 2.8Z" /><path d="m15.6 12.4.7 2.05 2.05.7-2.05.7-.7 2.05-.7-2.05-2.05-.7 2.05-.7.7-2.05Z" /></svg>
          </button>
          <button type="button" aria-label="Return to SPHEREx demo field" title="Return to demo field" onClick={resetView}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.7-4.2L4 7.5M4 4v3.5h3.5" /></svg>
          </button>
        </nav>

        <div className={styles.exploreActions}>
        <button type="button" aria-expanded={showObjectSearch} aria-controls="object-search" onClick={() => {
          setShowObjectSearch((visible) => !visible);
          setShowAreas(false); setShowResearch(false);
          setShowSavedPositions(false);
          setShowNavigator(false);
          setShowSurveyPicker(false);
        }}>⌕ Find object</button>
        <button type="button" aria-expanded={showSavedPositions} aria-controls="saved-positions" onClick={() => {
          setShowSavedPositions((visible) => !visible);
          setShowAreas(false); setShowResearch(false);
          setShowNavigator(false);
          setShowSurveyPicker(false);
          setShowObjectSearch(false);
        }}>☆ Saved positions</button>
        <button type="button" aria-expanded={showAreas} aria-controls="area-browser" onClick={() => {
          setShowAreas((visible) => !visible);
          setShowResearch(false); setShowNavigator(false); setShowSurveyPicker(false); setShowSavedPositions(false); setShowObjectSearch(false);
        }}>◎ Sky areas</button>
        <button type="button" aria-expanded={showResearch} aria-controls="research-tools" onClick={() => {
          setShowResearch((visible) => !visible);
          setShowAreas(false); setShowNavigator(false); setShowSurveyPicker(false); setShowSavedPositions(false); setShowObjectSearch(false);
        }}>↗ Research & help</button>
        </div>

        {showAreas && <AreaBrowser disabled={mapControlsDisabled} onClose={() => setShowAreas(false)} onVisit={(position) => {
          const map = mapRef.current;
          if (!map || mapControlsDisabled) return;
          map.gotoRaDec(position.center.raDeg, position.center.decDeg);
          map.setFoV(position.fieldOfViewDeg);
          updateViewFromMap(map);
          scheduleViewSettled(map);
          setShowAreas(false);
          selectedFootprintIdRef.current = null;
          setSelectedFootprintId(null);
          mapHostRef.current?.focus();
        }} />}
        {showResearch && <ResearchTools getView={() => view} survey={surveyChoice} disabled={mapControlsDisabled} onClose={() => setShowResearch(false)} />}

        {showObjectSearch && <ObjectSearch disabled={mapControlsDisabled} onClose={() => setShowObjectSearch(false)} onVisit={(center) => {
          const map = mapRef.current;
          if (!map || mapControlsDisabled) return;
          map.gotoRaDec(center.raDeg, center.decDeg);
          map.setFoV(2);
          updateViewFromMap(map);
          scheduleViewSettled(map);
          setShowObjectSearch(false);
          setShowAreas(false);
          setShowResearch(false);
          mapHostRef.current?.focus();
        }} />}

        {showSavedPositions && <SavedPositions
          getView={() => mapRef.current ? updateViewFromMap(mapRef.current) : view}
          survey={surveyChoice}
          disabled={mapControlsDisabled}
          onClose={() => setShowSavedPositions(false)}
          onVisit={(position) => {
            const map = mapRef.current;
            if (!map || mapControlsDisabled) return;
            handleSurveyChange(position.survey);
            map.gotoRaDec(position.center.raDeg, position.center.decDeg);
            map.setFoV(position.fieldOfViewDeg);
            updateViewFromMap(map);
            scheduleViewSettled(map);
            setShowSavedPositions(false);
            mapHostRef.current?.focus();
          }}
        />}

        {showNavigator && (
          <section id="coordinate-navigator" className={styles.navigator} aria-label="Go to sky coordinates">
            <div className={styles.navigatorHeading}>
              <h2>Go to coordinates</h2>
              <button type="button" aria-label="Close coordinate navigator" onClick={() => setShowNavigator(false)}>×</button>
            </div>
            <p>Enter ICRS coordinates in decimal degrees.</p>
            <form onSubmit={(event) => {
              event.preventDefault();
              const ra = Number(navigationTarget.ra);
              const dec = Number(navigationTarget.dec);
              const fov = Number(navigationTarget.fov);
              if (Object.values(navigationTarget).some((value) => !value.trim()) || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(fov) || ra < 0 || ra >= 360 || dec < -90 || dec > 90 || fov < MIN_FIELD_OF_VIEW || fov > MAX_FIELD_OF_VIEW) {
                setNavigationError("Use RA 0–359.999°, Dec −90–90°, and field of view 0.03–120°.");
                return;
              }
              const map = mapRef.current;
              if (!map || mapControlsDisabled) return;
              map.gotoRaDec(ra, dec);
              map.setFoV(fov);
              updateViewFromMap(map);
              scheduleViewSettled(map);
              setShowNavigator(false);
              mapHostRef.current?.focus();
            }}>
              {([
                ["ra", "Right ascension (°)", 0, 359.999999],
                ["dec", "Declination (°)", -90, 90],
                ["fov", "Field of view (°)", MIN_FIELD_OF_VIEW, MAX_FIELD_OF_VIEW],
              ] as const).map(([key, label, min, max]) => (
                <label key={key}>{label}
                  <input type="number" required step="any" min={min} max={max} value={navigationTarget[key]} aria-describedby={navigationError ? "navigation-error" : undefined} onChange={(event) => {
                    setNavigationTarget((target) => ({ ...target, [key]: event.target.value }));
                    setNavigationError("");
                  }} />
                </label>
              ))}
              {navigationError && <p id="navigation-error" role="alert">{navigationError}</p>}
              {mapControlsDisabled && <p role="status">Return to the live atlas to navigate.</p>}
              <button className={styles.navigatorSubmit} type="submit" disabled={mapControlsDisabled}>Go to position ↗</button>
            </form>
          </section>
        )}

        <aside className={styles.coordinateReadout} aria-live="polite" aria-label="Current sky coordinates">
          <div className={styles.readoutHeading}>
            <span className={styles.liveDot} aria-hidden="true" />
            <span>RETICLE COORDINATES</span>
          </div>
          <div className={styles.coordinateRows}>
            <span>RA <strong>{formatCoordinate(view.center.raDeg, "RA")}</strong></span>
            <span>DEC <strong>{formatCoordinate(view.center.decDeg, "DEC")}</strong></span>
            <span>FIELD <strong>{view.fieldOfViewDeg.toFixed(2)}°</strong></span>
          </div>
        </aside>

        <div className={styles.navigationHint}>
          <span className={styles.hintGlyph} aria-hidden="true">⌖</span>
          <span><strong>DRAG</strong> to pan</span>
          <span className={styles.hintSeparator} aria-hidden="true" />
          <span><strong>SCROLL / PINCH</strong> to zoom</span>
          <span className={styles.hintKeyboard}>ARROWS TO NAVIGATE · +/- TO ZOOM · HOME TO RESET</span>
        </div>

        <a
          className={styles.attribution}
          href="https://aladin.cds.unistra.fr/AladinLite/"
          target="_blank"
          rel="noreferrer"
          aria-label="Sky atlas by Aladin Lite, opens in a new tab"
        >
          SKY ATLAS BY <strong>ALADIN LITE</strong>
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 5 7M9 7v3H2V3h3" /></svg>
        </a>

        {mapStatus === "loading" && !showLocalStarfield && (
          <div className={styles.mapStatus} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Opening the sky atlas…</span>
          </div>
        )}
        {showLocalStarfield && (
          <div className={styles.fallbackMessage} role="status">
            <p className={styles.panelEyebrow}>LOCAL SKY VIEW</p>
            <strong>{mapStatus === "fallback" ? "Survey atlas unavailable" : "Local starfield preview"}</strong>
            <span>{mapStatus === "fallback" ? "The live survey could not start. The SPHEREx comparison remains available; reload to try the atlas again." : "Showing the cockpit’s local starfield. Return to the survey map to continue exploring."}</span>
          </div>
        )}

        {activeFootprintIsDemo && visibleSelectedFootprintId && (
          <SpherexComparison center={DEMO_CENTER} onClose={() => {
            selectedFootprintIdRef.current = null;
            setSelectedFootprintId(null);
          }} />
        )}

        <span className={styles.srOnly} role="status">
          {mapStatus === "loading" ? "Loading the Aladin sky atlas" : mapStatus === "ready" ? "Sky atlas ready" : "Sky atlas unavailable; local comparison remains available"}
        </span>
      </section>
    </main>
  );
}
