export type SkyCoordinate = {
  raDeg: number;
  decDeg: number;
};

export type SkyFootprint = {
  id: string;
  vertices: readonly SkyCoordinate[];
  selected?: boolean;
  kind?: "region" | "observation" | "demo";
};

export type SkyViewState = {
  center: SkyCoordinate;
  /** Horizontal field of view, in degrees. */
  fieldOfViewDeg: number;
};
