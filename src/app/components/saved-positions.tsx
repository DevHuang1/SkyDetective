"use client";

import { useEffect, useState } from "react";
import { downloadJson, isSavedPosition, parseBookmarkBackup, type SavedPosition } from "./sky-data";
import type { SkyViewState } from "./sky-types";
import styles from "./sky-viewport.module.css";

const STORAGE_KEY = "skydetective.saved-positions";

export default function SavedPositions({ getView, survey, disabled, onVisit, onClose }: {
  getView: () => SkyViewState;
  survey: SavedPosition["survey"];
  disabled: boolean;
  onVisit: (position: SavedPosition) => void;
  onClose: () => void;
}) {
  const [positions, setPositions] = useState<SavedPosition[]>([]);
  const [name, setName] = useState("");
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
        if (Array.isArray(stored)) {
          const ids = new Set<string>();
          setPositions(stored.filter(isSavedPosition).filter((position) => {
            if (ids.has(position.id)) return false;
            ids.add(position.id);
            return true;
          }).slice(0, 50));
        }
      } catch {
        setMessage("Saved positions could not be loaded. New positions can still be saved for this session.");
      }
      setReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  function save(next: SavedPosition[], success: string) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setMessage(success);
    } catch {
      setMessage("Browser storage is unavailable. Changes will last while this panel stays open.");
    }
    setPositions(next);
  }

  return (
    <section id="saved-positions" className={styles.navigator} aria-label="Saved sky positions">
      <div className={styles.navigatorHeading}>
        <h2>Saved positions</h2>
        <button type="button" aria-label="Close saved positions" onClick={onClose}>×</button>
      </div>
      <p>Keep sky coordinates, zoom, and survey in this browser.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!ready || disabled || !name.trim() || positions.length >= 50) return;
        const position = { ...getView(), id: crypto.randomUUID(), name: name.trim(), survey };
        if (!isSavedPosition(position)) return;
        save([...positions, position], `Saved ${position.name}.`);
        setName("");
      }}>
        <label>Position name
          <input required maxLength={60} value={name} placeholder="My observing field" onChange={(event) => setName(event.target.value)} />
        </label>
        <button className={styles.navigatorSubmit} type="submit" disabled={!ready || disabled || !name.trim() || positions.length >= 50}>Save current position</button>
      </form>
      {disabled && <p>Return to the live atlas to save or visit a position.</p>}
      {positions.length >= 50 && <p>50 positions saved. Remove one to add another.</p>}
      <p role="status">{message || (ready && positions.length === 0 ? "No saved positions yet." : "")}</p>
      <div className={styles.toolButtons}>
        <button type="button" className={styles.navigatorSubmit} disabled={!ready || positions.length === 0} onClick={() => downloadJson("skydetective-bookmarks.json", { version: 1, positions })}>Export bookmarks</button>
        <label className={styles.importLabel}>Import bookmarks
          <input type="file" accept=".json,application/json" disabled={!ready} onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            if (file.size > 256_000) { setMessage("Choose a bookmark file smaller than 256 KB."); return; }
            try {
              const data: unknown = JSON.parse(await file.text());
              const imported = parseBookmarkBackup(data);
              if (!imported) throw new Error("Invalid bookmarks");
              // Merge by identity and never overwrite an existing bookmark.
              const incoming = imported.filter((item) => !positions.some((existing) => existing.id === item.id));
              if (positions.length + incoming.length > 50) { setMessage("Import would exceed 50 bookmarks. Remove some first."); return; }
              save([...positions, ...incoming], `Imported ${incoming.length} bookmarks.`);
            } catch { setMessage("Invalid bookmark file. Use a SkyDetective bookmark export."); }
          }} />
        </label>
      </div>
      <ul className={styles.savedList}>
        {positions.map((position) => (
          <li key={position.id}>
            <button className={styles.savedVisit} type="button" disabled={disabled} onClick={() => onVisit(position)}>
              <strong>{position.name}</strong>
              <small>RA {position.center.raDeg.toFixed(3)}° · Dec {position.center.decDeg.toFixed(3)}°</small>
              <small>{position.fieldOfViewDeg.toFixed(2)}° · {position.survey === "optical" ? "Optical" : "Near-infrared"}</small>
            </button>
            <button className={styles.savedRemove} type="button" aria-label={`Remove ${position.name}`} onClick={() => save(positions.filter((item) => item.id !== position.id), `Removed ${position.name}.`)}>×</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
