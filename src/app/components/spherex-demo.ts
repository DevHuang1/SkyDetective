import type { SkyCoordinate, SkyFootprint } from "./sky-types";

export type SpherexObservation = {
  id: string;
  date: string;
  image: string;
  sourceUrl: string;
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
    date: "May 03, 2025",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-03.png",
    sourceUrl: "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W18_2B/l2b-v20-2025-241/1/level2_2025W18_2B_0237_4D1_spx_l2b-v20-2025-241.fits",
  },
  {
    id: "spherex-2025-05-22",
    date: "May 22, 2025",
    image: "/spherex-previews/spherex-qr2-d1-2025-05-22.png",
    sourceUrl: "https://irsa.ipac.caltech.edu/ibe/data/spherex/qr2/level2/2025W21_1B/l2b-v20-2025-248/1/level2_2025W21_1B_0582_2D1_spx_l2b-v20-2025-248.fits",
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

/** The preview renderer reprojects this shared rectangular cutout from both FITS files. */
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
