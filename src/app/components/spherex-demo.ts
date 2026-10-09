import type { SkyCoordinate, SkyFootprint } from "./sky-types";

export type SpherexObservation = {
  id: string;
  date: string;
  dateLabel: string;
  image: string;
};

export const DEMO_CENTER: SkyCoordinate = {
  raDeg: 127.69444,
  decDeg: -39.1776,
};

export const DEMO_FIELD_OF_VIEW_DEG = 1.2;
export const DEMO_FOOTPRINT_ID = "spherex-demo-field";
export const DEMO_CUTOUT_WIDTH_DEG = 0.7;
export const DEMO_CUTOUT_HEIGHT_DEG = 0.525;

export const SPHEREX_DEMO_OBSERVATIONS: readonly SpherexObservation[] = [
  {
    id: "spherex-2025-05-03",
    date: "2025-05-03T01:27:11.698Z",
    dateLabel: "May 03, 2025 · 01:27 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-03.png",
  },
  {
    id: "spherex-2025-05-11",
    date: "2025-05-11T05:04:29.525Z",
    dateLabel: "May 11, 2025 · 05:04 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-11.png",
  },
  {
    id: "spherex-2025-05-18",
    date: "2025-05-18T23:04:17.286Z",
    dateLabel: "May 18, 2025 · 23:04 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-18.png",
  },
  {
    id: "spherex-2025-05-22",
    date: "2025-05-22T02:01:03.179Z",
    dateLabel: "May 22, 2025 · 02:01 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-22.png",
  },
  {
    id: "spherex-2025-05-26",
    date: "2025-05-26T07:04:01.145Z",
    dateLabel: "May 26, 2025 · 07:04 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-26.png",
  },
  {
    id: "spherex-2025-11-02",
    date: "2025-11-02T22:57:54.855Z",
    dateLabel: "Nov 02, 2025 · 22:57 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-11-02.png",
  },
  {
    id: "spherex-2025-11-03",
    date: "2025-11-03T15:12:14.244Z",
    dateLabel: "Nov 03, 2025 · 15:12 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-11-03.png",
  },
  {
    id: "spherex-2025-11-03-1514",
    date: "2025-11-03T15:14:23.175Z",
    dateLabel: "Nov 03, 2025 · 15:14 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-11-03-1514.png",
  },
  {
    id: "spherex-2025-11-03-1516",
    date: "2025-11-03T15:16:33.641Z",
    dateLabel: "Nov 03, 2025 · 15:16 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-11-03-1516.png",
  },
  {
    id: "spherex-2025-11-27",
    date: "2025-11-27T17:52:33.964Z",
    dateLabel: "Nov 27, 2025 · 17:52 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-11-27.png",
  },
  {
    id: "spherex-2025-12-03",
    date: "2025-12-03T00:57:12.726Z",
    dateLabel: "Dec 03, 2025 · 00:57 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2025-12-03.png",
  },
  {
    id: "spherex-2026-05-21",
    date: "2026-05-21T03:27:20.505Z",
    dateLabel: "May 21, 2026 · 03:27 UTC",
    image: "/spherex-previews/spherex-qr2-d1-2026-05-21.png",
  },
];

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function tangentPlanePoint(xi: number, eta: number): SkyCoordinate {
  const dec0 = radians(DEMO_CENTER.decDeg);
  const denominator = Math.cos(dec0) - eta * Math.sin(dec0);

  return {
    raDeg:
      (((DEMO_CENTER.raDeg + (Math.atan2(xi, denominator) * 180) / Math.PI) % 360) +
        360) %
      360,
    decDeg:
      (Math.atan2(
        Math.sin(dec0) + eta * Math.cos(dec0),
        Math.sqrt(denominator * denominator + xi * xi),
      ) *
        180) /
      Math.PI,
  };
}

const halfWidth = radians(DEMO_CUTOUT_WIDTH_DEG / 2);
const halfHeight = radians(DEMO_CUTOUT_HEIGHT_DEG / 2);

/** The preview renderer reprojects each local FITS sample into this shared rectangular cutout. */
export const DEMO_FOOTPRINT: SkyFootprint = {
  id: DEMO_FOOTPRINT_ID,
  vertices: [
    tangentPlanePoint(-halfWidth, halfHeight),
    tangentPlanePoint(halfWidth, halfHeight),
    tangentPlanePoint(halfWidth, -halfHeight),
    tangentPlanePoint(-halfWidth, -halfHeight),
  ],
};

export const DEMO_FOOTPRINTS: readonly SkyFootprint[] = [DEMO_FOOTPRINT];
