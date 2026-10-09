"use client";

import { useEffect, useRef, useState } from "react";
import type { SkyViewState } from "./sky-types";
import { archiveUrl, EXTRA_AREAS, FEATURED_AREAS } from "./sky-data";
import styles from "./sky-viewport.module.css";

const AREAS = [
  ...FEATURED_AREAS,
  ...EXTRA_AREAS.map(([name, query]) => ({ name, query, description: "Candidate field · coordinates resolved on selection", center: null, fov: 1.2 })),
  ...Array.from({ length: 110 }, (_, index) => ({ name: `Messier ${index + 1}`, query: `M${index + 1}`, description: "Messier catalog · candidate field", center: null, fov: 1.2 })).filter((area) => !FEATURED_AREAS.some((featured) => featured.query === area.query)),
];

export default function AreaBrowser({ disabled, onVisit, onClose }: {
  disabled: boolean; onVisit: (view: SkyViewState) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<(SkyViewState & { name: string }) | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const matches = AREAS.filter((area) => `${area.name} ${area.query}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function select(area: (typeof AREAS)[number]) {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setError("");
    setSelected(null);
    setBusy(area.name);
    try {
      let center = area.center;
      if (!center) {
        const response = await fetch(`/api/object-search?q=${encodeURIComponent(area.query)}`, { signal: active.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not resolve this area.");
        if (!Number.isFinite(data.center?.raDeg) || !Number.isFinite(data.center?.decDeg) || data.center.raDeg < 0 || data.center.raDeg >= 360 || Math.abs(data.center.decDeg) > 90) throw new Error("The archive returned an invalid position.");
        center = data.center;
      }
      if (!active.signal.aborted && center) setSelected({ name: area.name, center, fieldOfViewDeg: area.fov });
    } catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Area search failed.");
    } finally {
      if (!active.signal.aborted) setBusy("");
    }
  }

  return <section id="area-browser" className={styles.navigator} aria-label="Sky area catalog">
    <div className={styles.navigatorHeading}><h2>Explore sky areas</h2><button type="button" aria-label="Close sky areas" onClick={onClose}>×</button></div>
    <p>{AREAS.length} targets to explore. Only the demo field has local dated images. Archive coverage and matching wavelengths must be checked for other areas.</p>
    <label>Filter areas<input value={query} placeholder="Orion, M31, nebula…" onChange={(event) => setQuery(event.target.value)} /></label>
    <p role="status">{busy ? `Finding ${busy}…` : error || `${matches.length} areas found`}</p>
    {selected && <div className={styles.searchResult}>
      <strong>{selected.name}</strong>
      <p>RA {selected.center.raDeg.toFixed(5)}° · Dec {selected.center.decDeg.toFixed(5)}°</p>
      <button type="button" className={styles.navigatorSubmit} disabled={disabled} onClick={() => onVisit(selected)}>Visit area ↗</button>
      <p><a href={archiveUrl(selected.center)} target="_blank" rel="noreferrer">Find SPHEREx observations ↗</a></p>
      {disabled && <p>The live atlas is unavailable. You can still search the archive.</p>}
    </div>}
    <ul className={styles.savedList}>{matches.map((area) => <li key={`${area.name}-${area.query}`}>
      <button type="button" className={styles.savedVisit} aria-pressed={selected?.name === area.name} onClick={() => void select(area)}><strong>{area.name}{area.query && ` · ${area.query}`}</strong><small>{area.description}</small></button>
    </li>)}</ul>
    <p>M102 has an ambiguous historical identification; verify the resolved object before use. Named coordinates: CDS Sesame.</p>
  </section>;
}
