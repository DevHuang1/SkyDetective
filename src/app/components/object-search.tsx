"use client";

import { useEffect, useRef, useState } from "react";
import type { SkyCoordinate } from "./sky-types";
import styles from "./sky-viewport.module.css";

export default function ObjectSearch({ disabled, onVisit, onClose }: {
  disabled: boolean;
  onVisit: (center: SkyCoordinate) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ name: string; center: SkyCoordinate } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function search() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch(`/api/object-search?q=${encodeURIComponent(query.trim())}`, { signal: active.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Search failed. Try again.");
      if (!Number.isFinite(data.center?.raDeg) || !Number.isFinite(data.center?.decDeg)) throw new Error("Search returned an invalid position.");
      if (!active.signal.aborted) setResult(data);
    } catch (cause) {
      if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed. Try again.");
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }

  return <section id="object-search" className={styles.navigator} aria-label="Search celestial objects">
    <div className={styles.navigatorHeading}><h2>Find an object</h2><button type="button" aria-label="Close object search" onClick={onClose}>×</button></div>
    <p>Find stars, galaxies, and nebulae by name. Try Andromeda, M42, or Sirius. Solar System objects are not supported.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (query.trim() && !busy) void search(); }}>
      <label>Object name<input autoFocus required maxLength={100} value={query} placeholder="Andromeda or M42" disabled={busy} onChange={(event) => { setQuery(event.target.value); setResult(null); setError(""); }} /></label>
      <button type="submit" className={styles.navigatorSubmit} disabled={busy || !query.trim()}>{busy ? "Searching…" : "Search"}</button>
    </form>
    <p role="status">{busy ? "Resolving object coordinates…" : error}</p>
    {result && <div className={styles.searchResult}>
      <strong>{result.name}</strong>
      <p>RA {result.center.raDeg.toFixed(4)}° · Dec {result.center.decDeg.toFixed(4)}°</p>
      <button type="button" className={styles.navigatorSubmit} disabled={disabled} onClick={() => onVisit(result.center)}>Go to object ↗</button>
    </div>}
    {disabled && <p>Return to the live atlas to visit a search result.</p>}
    <p>Coordinates by <a href="https://vizier.cds.unistra.fr/vizier/doc/sesame.htx" target="_blank" rel="noreferrer">CDS Sesame</a>.</p>
  </section>;
}
