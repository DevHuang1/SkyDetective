import type { SkyCoordinate, SkyFootprint } from "../components/sky-types";

export type ArchiveMode = "spherex" | "planetx";

export type SkyRegion = {
  id: string;
  vertices: readonly SkyCoordinate[];
};

export type SkyObservation = {
  id: string;
  survey: "SPHEREx QR2" | "NEOWISE";
  date: string;
  dateLabel: string;
  band: string;
  bandLabel: string;
  productName: string;
  footprint: SkyFootprint;
  previewUrl: string | null;
  accessUrl: string | null;
  source: "archive" | "demo";
};

export type SearchResult = {
  observations: SkyObservation[];
  source: "archive" | "demo";
  message?: string;
};

export type KnownObjectCheck = {
  status: "matches" | "none" | "unavailable";
  matches: Array<{
    designation: string;
    name: string | null;
    raDeg: number | null;
    decDeg: number | null;
    magnitude: number | null;
  }>;
  message?: string;
};

export type SavedCandidate = {
  id: string;
  createdAt: string;
  mode: "planetx";
  coordinate: SkyCoordinate;
  region: SkyRegion;
  observationIds: string[];
  note: string;
  knownObjectCheck: KnownObjectCheck;
};

export function regionAsFootprint(region: SkyRegion): SkyFootprint {
  return { id: region.id, vertices: region.vertices, kind: "region" };
}

