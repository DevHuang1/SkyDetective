"use client";

import { useState } from "react";
import SkyViewport, {
  type SkyFootprint,
  type SkyViewState,
} from "./components/sky-viewport";

const irsaFootprint: SkyFootprint = {
  id: "irsa-spherex-sample",
  vertices: [
    { raDeg: 129.1517381875102, decDeg: -36.28787282445658 },
    { raDeg: 133.04907831094775, decDeg: -37.80919952479405 },
    { raDeg: 131.13137654478913, decDeg: -40.96224550520541 },
    { raDeg: 127.07294872491782, decDeg: -39.36041486302981 },
    { raDeg: 129.1517381875102, decDeg: -36.28787282445658 },
  ],
};

const wrapFootprint: SkyFootprint = {
  id: "ra-wrap-high-declination",
  vertices: [
    { raDeg: 330, decDeg: 80 },
    { raDeg: 30, decDeg: 80 },
    { raDeg: 45, decDeg: 87 },
    { raDeg: 315, decDeg: 87 },
  ],
};

export default function Home() {
  const [scenario, setScenario] = useState<"irsa" | "wrap">("irsa");
  const [view, setView] = useState<SkyViewState>({
    center: { raDeg: 130, decDeg: -39 },
    fieldOfViewDeg: 24,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const footprint = scenario === "irsa" ? irsaFootprint : wrapFootprint;

  return (
    <>
      <SkyViewport
        viewCenter={view.center}
        fieldOfViewDeg={view.fieldOfViewDeg}
        footprints={[{ ...footprint, selected: selectedId === footprint.id }]}
        onViewSettled={setView}
        onFootprintSelect={setSelectedId}
      />
      <aside
        style={{
          position: "fixed",
          zIndex: 20,
          top: 90,
          left: 18,
          display: "flex",
          gap: 8,
          padding: 8,
          color: "white",
          background: "#07111f",
          font: "12px ui-monospace, monospace",
        }}
      >
        <button onClick={() => { setScenario("irsa"); setView({ center: { raDeg: 130, decDeg: -39 }, fieldOfViewDeg: 24 }); setSelectedId(null); }}>
          IRSA polygon
        </button>
        <button onClick={() => { setScenario("wrap"); setView({ center: { raDeg: 359.8, decDeg: 84 }, fieldOfViewDeg: 24 }); setSelectedId(null); }}>
          RA wrap / high Dec
        </button>
        <output>Selected: {selectedId ?? "none"}</output>
      </aside>
    </>
  );
}
