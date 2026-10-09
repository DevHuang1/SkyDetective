import type { SkyCoordinate, SkyViewState } from "./sky-types";

export function archiveUrl(center: SkyCoordinate, radiusDeg = 0.5) {
  const params = new URLSearchParams({ api: "spectral-images", ra: String(center.raDeg), dec: String(center.decDeg), sr: `${Math.max(0.01, Math.min(5, radiusDeg))}d` });
  return `https://irsa.ipac.caltech.edu/applications/spherex/?${params}`;
}

export function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseSharedView(search: string): (SkyViewState & { survey: "optical" | "infrared" }) | null {
  const params = new URLSearchParams(search);
  if (!["ra", "dec", "fov"].every((key) => params.get(key)?.trim())) return null;
  const raDeg = Number(params.get("ra"));
  const decDeg = Number(params.get("dec"));
  const fieldOfViewDeg = Number(params.get("fov"));
  if (!Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90 || !Number.isFinite(fieldOfViewDeg) || fieldOfViewDeg < 0.03 || fieldOfViewDeg > 120) return null;
  return { center: { raDeg, decDeg }, fieldOfViewDeg, survey: params.get("survey") === "infrared" ? "infrared" : "optical" };
}

export function shareUrl(base: string, view: SkyViewState, survey: string) {
  const url = new URL(base);
  url.search = new URLSearchParams({ ra: view.center.raDeg.toFixed(6), dec: view.center.decDeg.toFixed(6), fov: view.fieldOfViewDeg.toFixed(4), survey }).toString();
  url.hash = "";
  return url.toString();
}

export const FEATURED_AREAS = [
  { name: "SPHEREx demo field", query: "", description: "Two aligned observations · May 3 and 22, 2025", center: { raDeg: 127.69444, decDeg: -39.1776 }, fov: 1.2 },
  { name: "North ecliptic pole", query: "", description: "Candidate for frequent repeat coverage", center: { raDeg: 270, decDeg: 66.56071 }, fov: 2 },
  { name: "Orion Nebula", query: "M42", description: "Nebula field · candidate observations", center: { raDeg: 83.82, decDeg: -5.3875 }, fov: 1.2 },
  { name: "Andromeda galaxy", query: "M31", description: "Galaxy field · candidate observations", center: { raDeg: 10.68471, decDeg: 41.26875 }, fov: 3 },
  { name: "Triangulum galaxy", query: "M33", description: "Galaxy field · candidate observations", center: { raDeg: 23.46207, decDeg: 30.66018 }, fov: 1.5 },
] as const;

export const EXTRA_AREAS = [
  ["Horsehead Nebula", "Barnard 33"], ["Flame Nebula", "NGC 2024"], ["Rosette Nebula", "NGC 2237"],
  ["North America Nebula", "NGC 7000"], ["Pelican Nebula", "IC 5070"], ["California Nebula", "NGC 1499"],
  ["Heart Nebula", "IC 1805"], ["Soul Nebula", "IC 1848"], ["Carina Nebula", "NGC 3372"],
  ["Tarantula Nebula", "NGC 2070"], ["Helix Nebula", "NGC 7293"], ["Veil Nebula", "NGC 6992"],
  ["Sculptor galaxy", "NGC 253"], ["Centaurus A", "NGC 5128"], ["Omega Centauri", "NGC 5139"],
  ["47 Tucanae", "NGC 104"], ["Double Cluster", "NGC 869"], ["Mira", "Mira"],
  ["T Tauri", "T Tauri"], ["R Coronae Borealis", "R CrB"],
] as const;

export type SavedPosition = SkyViewState & { id: string; name: string; survey: "optical" | "infrared" };

export function isSavedPosition(value: unknown): value is SavedPosition {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedPosition>;
  return typeof item.id === "string" && item.id.trim().length > 0 && item.id.length <= 100
    && typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 60
    && (item.survey === "optical" || item.survey === "infrared")
    && typeof item.center?.raDeg === "number" && Number.isFinite(item.center.raDeg) && item.center.raDeg >= 0 && item.center.raDeg < 360
    && typeof item.center?.decDeg === "number" && Number.isFinite(item.center.decDeg) && Math.abs(item.center.decDeg) <= 90
    && typeof item.fieldOfViewDeg === "number" && Number.isFinite(item.fieldOfViewDeg) && item.fieldOfViewDeg >= 0.03 && item.fieldOfViewDeg <= 120;
}

export function parseBookmarkBackup(value: unknown): SavedPosition[] | null {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("positions" in value) || !Array.isArray(value.positions) || value.positions.length > 50 || !value.positions.every(isSavedPosition)) return null;
  const ids = new Set(value.positions.map((item) => item.id));
  return ids.size === value.positions.length ? value.positions : null;
}
