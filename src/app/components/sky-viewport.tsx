"use client";

import Script from "next/script";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ArchiveExplorer from "./archive-explorer";
import {
  DEMO_CENTER,
  DEMO_FOOTPRINT,
  DEMO_FIELD_OF_VIEW_DEG,
  DEMO_FOOTPRINT_ID,
  DEMO_FOOTPRINTS,
  SPHEREX_DEMO_OBSERVATIONS,
} from "./spherex-demo";
import type { SkyCoordinate, SkyFootprint, SkyViewState } from "./sky-types";
import type { ArchiveMode, KnownObjectCheck, SavedCandidate, SkyObservation, SkyRegion } from "../lib/archive-types";
import { regionAsFootprint } from "../lib/archive-types";
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
const CANDIDATE_STORAGE_KEY = "skydetective.candidates.v1";

const LOCAL_DEMO_OBSERVATIONS: SkyObservation[] = SPHEREX_DEMO_OBSERVATIONS.map((observation) => ({
  id: observation.id,
  survey: "SPHEREx QR2",
  date: observation.date,
  dateLabel: observation.dateLabel,
  band: "D1",
  bandLabel: "D1 · 0.75–1.09 μm",
  productName: observation.id,
  footprint: { ...DEMO_FOOTPRINT, id: "obs:" + observation.id, kind: "demo" },
  previewUrl: observation.image,
  accessUrl: null,
  source: "demo",
}));

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

function sphericalCenter(vertices: readonly SkyCoordinate[]): SkyCoordinate {
  const vector = vertices.reduce(
    (sum, point) => {
      const ra = (point.raDeg * Math.PI) / 180;
      const dec = (point.decDeg * Math.PI) / 180;
      sum[0] += Math.cos(dec) * Math.cos(ra);
      sum[1] += Math.cos(dec) * Math.sin(ra);
      sum[2] += Math.sin(dec);
      return sum;
    },
    [0, 0, 0],
  );
  return normalizeCoordinate({
    raDeg: (Math.atan2(vector[1], vector[0]) * 180) / Math.PI,
    decDeg: (Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) * 180) / Math.PI,
  });
}

function regionDimensions(vertices: readonly SkyCoordinate[], center: SkyCoordinate) {
  const decRadians = (center.decDeg * Math.PI) / 180;
  let halfWidth = 0;
  let halfHeight = 0;
  for (const point of vertices) {
    const deltaRa = ((((point.raDeg - center.raDeg) % 360) + 540) % 360) - 180;
    halfWidth = Math.max(halfWidth, Math.abs(deltaRa * Math.cos(decRadians)));
    halfHeight = Math.max(halfHeight, Math.abs(point.decDeg - center.decDeg));
  }
  return { widthDeg: Math.max(0.01, halfWidth * 2), heightDeg: Math.max(0.01, halfHeight * 2) };
}

function tangentOffset(center: SkyCoordinate, eastDeg: number, northDeg: number): SkyCoordinate {
  const dec0 = (center.decDeg * Math.PI) / 180;
  const xi = (eastDeg * Math.PI) / 180;
  const eta = (northDeg * Math.PI) / 180;
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0);
  return normalizeCoordinate({
    raDeg: center.raDeg + (Math.atan2(xi, denominator) * 180) / Math.PI,
    decDeg: (Math.atan2(
      Math.sin(dec0) + eta * Math.cos(dec0),
      Math.sqrt(denominator * denominator + xi * xi),
    ) * 180) / Math.PI,
  });
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
    const isRegion = footprint.kind === "region";
    const isObservation = footprint.kind === "observation";
    const color = isRegion ? "#f3bb70" : isObservation ? "#86bfd2" : "#67d9ee";
    const vertices = footprint.vertices.map(
      ({ raDeg, decDeg }) => [raDeg, decDeg] as const,
    );
    const polygon = api.polygon(vertices, {
      color: selected ? "#fff0c8" : color,
      fill: !isObservation || selected,
      fillColor: selected ? "#ffd18a" : color,
      opacity: selected ? 0.11 : isRegion ? 0.04 : 0.025,
      lineWidth: selected || isRegion ? 3 : isObservation ? 1 : 2,
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
  const areaPointerRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onViewSettledRef = useRef(onViewSettled);
  const onFootprintSelectRef = useRef(onFootprintSelect);
  const selectedFootprintIdRef = useRef<string | null>(null);
  const appliedSurveyRef = useRef<SurveyId | null>(null);
  const footprintsRef = useRef(footprints);
  const archiveRequestIdRef = useRef(0);

  const [scriptReady, setScriptReady] = useState(false);
  const [surveyPreferenceReady, setSurveyPreferenceReady] = useState(false);
  const [surveyChoice, setSurveyChoice] = useState<SurveyId>("optical");
  const [showSurveyPicker, setShowSurveyPicker] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [selectedFootprintId, setSelectedFootprintId] = useState<string | null>(null);
  const [gridVisible, setGridVisible] = useState(true);
  const [mode, setMode] = useState<ArchiveMode>("spherex");
  const [isSelectingArea, setIsSelectingArea] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<SkyRegion | null>(null);
  const [archiveObservations, setArchiveObservations] = useState<SkyObservation[]>(LOCAL_DEMO_OBSERVATIONS);
  const [activeObservationIndex, setActiveObservationIndex] = useState(LOCAL_DEMO_OBSERVATIONS.length - 1);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState("Local SPHEREx D1 samples are ready. Select an area to search IRSA.");
  const [isArchiveData, setIsArchiveData] = useState(false);
  const [archivePanelOpen, setArchivePanelOpen] = useState(false);
  const [candidatePosition, setCandidatePosition] = useState<SkyCoordinate>(requestedCenter);
  const [candidates, setCandidates] = useState<SavedCandidate[]>([]);
  const [candidateStoreReady, setCandidateStoreReady] = useState(false);
  const [view, setView] = useState<SkyViewState>(() => ({
    center: requestedCenter,
    fieldOfViewDeg: requestedFov,
  }));
  const hasControlledCenter = viewCenter !== undefined;
  const displayFootprints = useMemo(() => {
    const regionFootprints = selectedRegion ? [regionAsFootprint(selectedRegion)] : [];
    const observationFootprints = archiveObservations
      .filter((observation) => observation.source === "archive")
      .map((observation) => observation.footprint);
    return [...footprints, ...regionFootprints, ...observationFootprints];
  }, [archiveObservations, footprints, selectedRegion]);
  const visibleSelectedFootprintId = displayFootprints.some(
    (footprint) => footprint.id === selectedFootprintId,
  )
    ? selectedFootprintId
    : null;
  const mapControlsDisabled = mapStatus !== "ready";

  useEffect(() => {
    onViewSettledRef.current = onViewSettled;
    onFootprintSelectRef.current = onFootprintSelect;
  }, [onFootprintSelect, onViewSettled]);

  useEffect(() => {
    footprintsRef.current = displayFootprints;
  }, [displayFootprints]);

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
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CANDIDATE_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as SavedCandidate[];
          if (Array.isArray(parsed)) setCandidates(parsed);
        }
      } catch {
        // Candidate review remains available for this session without browser storage.
      }
      setCandidateStoreReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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

  const searchArchive = useCallback(async (searchMode: ArchiveMode, region: SkyRegion) => {
    const requestId = ++archiveRequestIdRef.current;
    setArchivePanelOpen(true);
    setArchiveBusy(true);
    setArchiveObservations(LOCAL_DEMO_OBSERVATIONS);
    setActiveObservationIndex(LOCAL_DEMO_OBSERVATIONS.length - 1);
    setIsArchiveData(false);
    setArchiveMessage("Searching IRSA for overlapping observations…");
    try {
      const response = await fetch("/api/archive/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: searchMode, region }),
      });
      const payload = await response.json() as {
        observations?: SkyObservation[];
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "IRSA archive search failed.");
      if (requestId !== archiveRequestIdRef.current) return;
      const results = Array.isArray(payload.observations) ? payload.observations : [];
      if (results.length) {
        setArchiveObservations(results);
        setActiveObservationIndex(results.length - 1);
        setIsArchiveData(true);
        setArchiveMessage("Loaded " + results.length + " overlapping " + (searchMode === "spherex" ? "SPHEREx D1" : "NEOWISE") + " archive observations.");
      } else {
        setArchiveObservations(LOCAL_DEMO_OBSERVATIONS);
        setActiveObservationIndex(LOCAL_DEMO_OBSERVATIONS.length - 1);
        setIsArchiveData(false);
        setArchiveMessage((payload.message || "No archive observations cover this area.") + " Showing the local visual sample for exploration.");
      }
    } catch (error) {
      if (requestId !== archiveRequestIdRef.current) return;
      setArchiveObservations(LOCAL_DEMO_OBSERVATIONS);
      setActiveObservationIndex(LOCAL_DEMO_OBSERVATIONS.length - 1);
      setIsArchiveData(false);
      setArchiveMessage((error instanceof Error ? error.message : "Archive request failed.") + " Showing the local visual sample; it is not archive data.");
    } finally {
      if (requestId === archiveRequestIdRef.current) setArchiveBusy(false);
    }
  }, []);

  const changeMode = useCallback((nextMode: ArchiveMode) => {
    setMode(nextMode);
    setArchivePanelOpen(true);
    if (selectedRegion) {
      void searchArchive(nextMode, selectedRegion);
    } else {
      setArchiveObservations(LOCAL_DEMO_OBSERVATIONS);
      setActiveObservationIndex(LOCAL_DEMO_OBSERVATIONS.length - 1);
      setIsArchiveData(false);
      setArchiveBusy(false);
      setArchiveMessage(nextMode === "spherex"
        ? "Local SPHEREx D1 samples are ready. Select an area to search IRSA."
        : "Local SPHEREx images show the comparison controls only; draw an area to search NEOWISE.");
    }
  }, [searchArchive, selectedRegion]);

  const saveCandidate = useCallback((knownObjectCheck: KnownObjectCheck, observationIds: string[]) => {
    if (!selectedRegion || !candidateStoreReady) return;
    const candidate: SavedCandidate = {
      id: typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "candidate-" + Date.now(),
      createdAt: new Date().toISOString(),
      mode: "planetx",
      coordinate: normalizeCoordinate(candidatePosition),
      region: selectedRegion,
      observationIds,
      note: "",
      knownObjectCheck,
    };
    setCandidates((current) => {
      const next = [candidate, ...current];
      try {
        window.localStorage.setItem(CANDIDATE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Keep the saved flag in memory if browser storage is full or unavailable.
      }
      return next;
    });
  }, [candidatePosition, candidateStoreReady, selectedRegion]);

  const exportCandidates = useCallback(() => {
    if (!candidates.length) return;
    const columns = ["created_at_utc", "ra_deg", "dec_deg", "known_object_status", "known_object_matches", "observation_ids", "region_vertices"];
    const escapeCell = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const rows = candidates.map((candidate) => [
      candidate.createdAt,
      candidate.coordinate.raDeg.toFixed(7),
      candidate.coordinate.decDeg.toFixed(7),
      candidate.knownObjectCheck.status,
      candidate.knownObjectCheck.matches.map((match) => match.designation).join("; "),
      candidate.observationIds.join("; "),
      JSON.stringify(candidate.region.vertices),
    ].map(escapeCell).join(","));
    const blob = new Blob([columns.join(",") + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "skydetective-candidates.csv";
    link.click();
    URL.revokeObjectURL(objectUrl);
  }, [candidates]);

  const checkKnownObjects = useCallback(async (observationId: string): Promise<KnownObjectCheck> => {
    if (!selectedRegion || !archiveObservations.length || !isArchiveData) {
      return { status: "unavailable", matches: [], message: "Load a real archive observation before checking known objects." };
    }
    const center = sphericalCenter(selectedRegion.vertices);
    const dimensions = regionDimensions(selectedRegion.vertices, center);
    const observation = archiveObservations.find((entry) => entry.id === observationId);
    if (!observation) {
      return { status: "unavailable", matches: [], message: "The selected observation is no longer available." };
    }
    try {
      const response = await fetch("/api/archive/known-objects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ center, date: observation.date, ...dimensions }),
      });
      const result = await response.json() as KnownObjectCheck;
      return result.status ? result : {
        status: "unavailable",
        matches: [],
        message: "JPL returned an unreadable response. This is not a no-match result.",
      };
    } catch {
      return {
        status: "unavailable",
        matches: [],
        message: "JPL cross-check is unavailable. This is not a no-match result.",
      };
    }
  }, [archiveObservations, isArchiveData, selectedRegion]);

  const selectFootprint = useCallback((id: string) => {
    selectedFootprintIdRef.current = id;
    setSelectedFootprintId(id);
    if (id === DEMO_FOOTPRINT_ID || id.startsWith("obs:") || id === selectedRegion?.id) {
      setArchivePanelOpen(true);
    }
    const observationIndex = archiveObservations.findIndex((observation) => "obs:" + observation.id === id);
    if (observationIndex >= 0) setActiveObservationIndex(observationIndex);
    onFootprintSelectRef.current?.(id);
  }, [archiveObservations, selectedRegion]);

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

        activeMap = api.aladin(mapHost, {
          target: `${requestedCenter.raDeg} ${requestedCenter.decDeg}`,
          survey: SURVEYS[surveyChoice].id,
          cooFrame: "ICRSd",
          projection: "TAN",
          fov: requestedFov,
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
    overlayRef.current = createFootprintOverlay(api, map, displayFootprints, visibleSelectedFootprintId);

    return () => {
      if (overlayRef.current) map.removeOverlay(overlayRef.current);
      overlayRef.current = null;
    };
  }, [displayFootprints, mapStatus, visibleSelectedFootprintId]);

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

  const selectCurrentView = useCallback(() => {
    const center = view.center;
    const halfWidth = Math.min(view.fieldOfViewDeg * 0.25, 4);
    const halfHeight = halfWidth * 0.75;
    const region: SkyRegion = {
      id: "selected-area",
      vertices: [
        tangentOffset(center, -halfWidth, halfHeight),
        tangentOffset(center, halfWidth, halfHeight),
        tangentOffset(center, halfWidth, -halfHeight),
        tangentOffset(center, -halfWidth, -halfHeight),
      ],
    };
    setSelectedRegion(region);
    setCandidatePosition(sphericalCenter(region.vertices));
    setSelectedFootprintId(region.id);
    selectedFootprintIdRef.current = region.id;
    setArchivePanelOpen(true);
    setIsSelectingArea(false);
    setSelectionBox(null);
    void searchArchive(mode, region);
  }, [mode, searchArchive, view.center, view.fieldOfViewDeg]);

  const updateCandidatePosition = useCallback((position: SkyCoordinate) => {
    setCandidatePosition({
      raDeg: Number.isFinite(position.raDeg) ? ((position.raDeg % 360) + 360) % 360 : 0,
      decDeg: Number.isFinite(position.decDeg) ? Math.max(-90, Math.min(90, position.decDeg)) : 0,
    });
  }, []);

  const closeArchivePanel = useCallback(() => {
    setArchivePanelOpen(false);
    selectedFootprintIdRef.current = null;
    setSelectedFootprintId(null);
  }, []);

  const selectFootprintAt = useCallback(
    (coordinate: SkyCoordinate) => {
      const match = displayFootprints.find((footprint) =>
        pointInSphericalPolygon(coordinate, footprint.vertices),
      );
      if (match) selectFootprint(match.id);
    },
    [displayFootprints, selectFootprint],
  );

  const handleMapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (isSelectingArea && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      areaPointerRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      const bounds = event.currentTarget.getBoundingClientRect();
      setSelectionBox({
        left: event.clientX - bounds.left,
        top: event.clientY - bounds.top,
        width: 0,
        height: 0,
      });
      pointerStartRef.current = null;
      return;
    }
    if (event.button !== 0 || event.target instanceof Element && event.target.closest(".aladin-status-bar")) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
  }, [isSelectingArea]);

  const handleMapPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const start = areaPointerRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const left = Math.min(start.x, event.clientX) - bounds.left;
    const top = Math.min(start.y, event.clientY) - bounds.top;
    setSelectionBox({
      left,
      top,
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    });
  }, []);

  const handleMapPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const areaStart = areaPointerRef.current;
      if (areaStart && areaStart.pointerId === event.pointerId) {
        event.preventDefault();
        event.stopPropagation();
        areaPointerRef.current = null;
        pointerStartRef.current = null;
        const map = mapRef.current;
        const host = mapHostRef.current;
        const bounds = event.currentTarget.getBoundingClientRect();
        const left = Math.min(areaStart.x, event.clientX);
        const right = Math.max(areaStart.x, event.clientX);
        const top = Math.min(areaStart.y, event.clientY);
        const bottom = Math.max(areaStart.y, event.clientY);
        setSelectionBox(null);
        setIsSelectingArea(false);
        if (!map || !host || right - left < 12 || bottom - top < 12) return;
        const positions = [
          map.pix2world(left - bounds.left, top - bounds.top, "ICRS"),
          map.pix2world(right - bounds.left, top - bounds.top, "ICRS"),
          map.pix2world(right - bounds.left, bottom - bounds.top, "ICRS"),
          map.pix2world(left - bounds.left, bottom - bounds.top, "ICRS"),
        ];
        const vertices = positions.map(([raDeg, decDeg]) => normalizeCoordinate({ raDeg, decDeg }));
        if (vertices.some((point) => !Number.isFinite(point.raDeg) || !Number.isFinite(point.decDeg))) return;
        const region: SkyRegion = { id: "selected-area", vertices };
        const center = sphericalCenter(vertices);
        setSelectedRegion(region);
        setCandidatePosition(center);
        setSelectedFootprintId(region.id);
        selectedFootprintIdRef.current = region.id;
        setArchivePanelOpen(true);
        void searchArchive(mode, region);
        return;
      }
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
    [mode, searchArchive, selectFootprintAt],
  );

  const handleMapKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && isSelectingArea) {
        event.preventDefault();
        areaPointerRef.current = null;
        setIsSelectingArea(false);
        setSelectionBox(null);
        return;
      }
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
    [isSelectingArea, resetView, scheduleViewSettled, selectFootprintAt],
  );

  const activeFootprintIsDemo = visibleSelectedFootprintId === DEMO_FOOTPRINT_ID;
  const showArchiveExplorer = archivePanelOpen || activeFootprintIsDemo;

  return (
    <main className={styles.cockpit}>
      <Script
        id="aladin-lite-v3"
        src={ALADIN_SCRIPT}
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
        onError={() => setMapStatus("fallback")}
      />

      <section className={styles.viewport} aria-label="Interactive sky atlas for SPHEREx and Planet X candidate review">
        <div className={styles.starfieldFallback} aria-hidden="true" />
        <div
          className={`${styles.mapHost} ${mapStatus === "fallback" ? styles.mapHidden : ""}`}
          ref={mapHostRef}
          role="application"
          tabIndex={0}
          aria-label={isSelectingArea
            ? "Draw a rectangle on the sky map to choose the exact search area. Press Escape to cancel."
            : "Interactive sky map. Drag or swipe to pan, scroll or pinch to zoom, use the arrow keys to navigate, plus and minus to zoom, and Home to return to the demo field."}
          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Home Enter Escape"
          onKeyDown={handleMapKeyDown}
          onPointerDownCapture={handleMapPointerDown}
          onPointerMoveCapture={handleMapPointerMove}
          onPointerUpCapture={handleMapPointerUp}
          onPointerCancelCapture={() => {
            areaPointerRef.current = null;
            pointerStartRef.current = null;
            setSelectionBox(null);
          }}
        />
        {selectionBox && (
          <div
            className={styles.selectionBox}
            aria-hidden="true"
            style={{
              left: selectionBox.left,
              top: selectionBox.top,
              width: selectionBox.width,
              height: selectionBox.height,
            }}
          />
        )}
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
              <p className={styles.kicker}>FLIGHT DECK · DEEP SKY</p>
              <h1>SkyDetective</h1>
            </div>
          </div>

          <div className={styles.topActions}>
            <div className={styles.modeSwitch} role="group" aria-label="Choose research mode">
              <button
                type="button"
                className={mode === "spherex" ? styles.modeActive : ""}
                aria-pressed={mode === "spherex"}
                onClick={() => changeMode("spherex")}
              >SPHEREx</button>
              <button
                type="button"
                className={mode === "planetx" ? styles.modeActive : ""}
                aria-pressed={mode === "planetx"}
                onClick={() => changeMode("planetx")}
              >Planet X</button>
            </div>
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
              className={isSelectingArea ? styles.selectAreaActive : styles.selectAreaButton}
              type="button"
              aria-pressed={isSelectingArea}
              onClick={() => {
                const nextSelection = !isSelectingArea;
                setIsSelectingArea(nextSelection);
                setSelectionBox(null);
                setArchivePanelOpen(false);
                if (nextSelection) mapHostRef.current?.focus();
              }}
              disabled={mapStatus !== "ready"}
            >
              {isSelectingArea ? "Cancel area" : "Select area"}
            </button>
            <button
              className={styles.compareButton}
              type="button"
              onClick={() => {
                const demoFootprint = displayFootprints.find((footprint) => footprint.id === DEMO_FOOTPRINT_ID);
                if (demoFootprint) selectFootprint(demoFootprint.id);
              }}
              disabled={!displayFootprints.some((footprint) => footprint.id === DEMO_FOOTPRINT_ID)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M3 4.5h14M3 10h14M3 15.5h14M7 2v16m6-16v16" />
              </svg>
              Demo
            </button>
          </div>
        </header>

        {isSelectingArea && (
          <div className={styles.selectionHint} role="status">
            <strong>SELECT A SKY AREA</strong>
            <span>Drag a rectangle across the map. Touch works too.</span>
            <button type="button" onClick={selectCurrentView}>Use current view</button>
          </div>
        )}

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
          <button type="button" aria-label="Return to the demo field" title="Return to demo field" onClick={resetView}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10a6 6 0 1 0 1.7-4.2L4 7.5M4 4v3.5h3.5" /></svg>
          </button>
        </nav>

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

        {mapStatus === "loading" && (
          <div className={styles.mapStatus} role="status" aria-live="polite">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Opening the sky atlas…</span>
          </div>
        )}
        {mapStatus !== "loading" && showArchiveExplorer && (
          <ArchiveExplorer
            key={mode + ":" + archiveObservations.map((observation) => observation.id).join("|")}
            mode={mode}
            region={selectedRegion}
            observations={archiveObservations}
            activeIndex={activeObservationIndex}
            onActiveIndexChange={setActiveObservationIndex}
            busy={archiveBusy}
            statusMessage={archiveMessage}
            isArchiveData={isArchiveData}
            candidates={candidates}
            candidateStoreReady={candidateStoreReady}
            candidatePosition={candidatePosition}
            currentCenter={view.center}
            onCandidatePositionChange={updateCandidatePosition}
            onUseCurrentCenter={() => updateCandidatePosition(view.center)}
            onCheckKnownObjects={checkKnownObjects}
            onSaveCandidate={saveCandidate}
            onExportCandidates={exportCandidates}
            onSearch={() => selectedRegion && void searchArchive(mode, selectedRegion)}
            onClose={closeArchivePanel}
          />
        )}

        <span className={styles.srOnly} role="status">
          {mapStatus === "loading" ? "Loading the Aladin sky atlas" : mapStatus === "ready" ? "Sky atlas ready" : "Sky atlas unavailable; local comparison remains available"}
        </span>
      </section>
    </main>
  );
}
