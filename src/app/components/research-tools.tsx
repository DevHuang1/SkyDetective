"use client";

import { useState } from "react";
import type { SkyViewState } from "./sky-types";
import { archiveUrl, downloadJson, shareUrl } from "./sky-data";
import { inspectFits, type FitsMetadata } from "./fits-metadata";
import styles from "./sky-viewport.module.css";

export default function ResearchTools({ getView, survey, disabled, onClose }: {
  getView: () => SkyViewState; survey: "optical" | "infrared"; disabled: boolean; onClose: () => void;
}) {
  const view = getView();
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [files, setFiles] = useState<FitsMetadata[]>([]);
  const [fileMessage, setFileMessage] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const url = archiveUrl(view.center, view.fieldOfViewDeg / 2);
  return <section id="research-tools" className={styles.navigator} aria-label="Research and sharing tools">
    <div className={styles.navigatorHeading}><h2>Research tools</h2><button type="button" aria-label="Close research tools" onClick={onClose}>×</button></div>
    <p>Current center: RA {view.center.raDeg.toFixed(5)}° · Dec {view.center.decDeg.toFixed(5)}°. Field: {view.fieldOfViewDeg.toFixed(2)}°.</p>
    <p><a href={url} target="_blank" rel="noreferrer">Search SPHEREx observations here ↗</a></p>
    <p>Archive search radius is half the field width, limited to 5°. Confirm image coverage before downloading.</p>
    <div className={styles.toolButtons}>
      <button type="button" className={styles.navigatorSubmit} disabled={disabled} onClick={async () => {
        const next = shareUrl(window.location.href, getView(), survey);
        setLink(next);
        try { await navigator.clipboard.writeText(next); setMessage("Sky-view link copied."); }
        catch { setMessage("Copy the link below to share this position."); }
      }}>Share this sky view</button>
      <button type="button" className={styles.navigatorSubmit} onClick={() => downloadJson("skydetective-field.json", { version: 1, ...getView(), survey, coordinateSystem: "ICRS", archiveUrl: archiveUrl(getView().center, getView().fieldOfViewDeg / 2) })}>Export field details</button>
    </div>
    {link && <label>Share link<input readOnly value={link} onFocus={(event) => event.target.select()} /></label>}
    <p role="status">{message}</p>
    <details><summary>Inspect downloaded FITS files</summary>
      <p>Read dates, detector, and image center from up to 20 local files. Files stay on this computer. This inspects metadata; it does not render or align new frames.</p>
      <label>Choose SPHEREx FITS files<input type="file" accept=".fits,.fit,.fts" multiple disabled={inspecting} onChange={async (event) => {
        const selectedFiles = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        if (!selectedFiles.length) return;
        if (selectedFiles.length > 20) { setFileMessage("Choose up to 20 files at once."); return; }
        setInspecting(true); setFiles([]); setFileMessage("Reading FITS headers…");
        const results = await Promise.allSettled(selectedFiles.map(inspectFits));
        const valid: FitsMetadata[] = [];
        const errors: string[] = [];
        results.forEach((result, index) => {
          if (result.status === "fulfilled") valid.push(result.value);
          else errors.push(`${selectedFiles[index].name}: ${result.reason instanceof Error ? result.reason.message : "Could not read file."}`);
        });
        valid.sort((a, b) => a.date.localeCompare(b.date));
        setFiles(valid); setFileMessage(`${valid.length} files inspected.${errors.length ? ` ${errors.join(" ")}` : ""}`); setInspecting(false);
      }} /></label>
      <p role="status">{fileMessage}</p>
      {files.map((file) => <div className={styles.searchResult} key={file.filename + file.date}>
        <strong>{file.filename}</strong><p>{file.date} · {file.detector ? `D${file.detector}` : "Detector unknown"}<br />{file.width} × {file.height} pixels · {file.unit}<br />RA {file.center.raDeg.toFixed(5)}° · Dec {file.center.decDeg.toFixed(5)}°</p>
        <a href={archiveUrl(file.center)} target="_blank" rel="noreferrer">Search around this image center ↗</a>
      </div>)}
      {files.length > 0 && <button type="button" className={styles.navigatorSubmit} onClick={() => downloadJson("skydetective-fits-metadata.json", { version: 1, files })}>Export FITS metadata</button>}
      <p>Image centers alone do not prove footprint overlap. Check the WCS and wavelength maps before grouping frames.</p>
    </details>
    <details open><summary>Build a reliable timelapse</summary>
      <ol className={styles.guideList}>
        <li>Choose a fixed sky center and crop. Save the position.</li>
        <li>Find observations at that position on different dates.</li>
        <li>Use the same data release and comparable wavelengths. Detector alone does not guarantee a match.</li>
        <li>Align every frame using its FITS sky coordinates, with the same orientation and pixel scale.</li>
        <li>Apply a shared brightness stretch and check masks and uncertainties before interpreting changes.</li>
      </ol>
    </details>
    <p>The optical and near-infrared atlas backgrounds are DSS2 and 2MASS surveys. The dated comparison uses SPHEREx FITS previews for the demo field only.</p>
    <p><a href="https://irsa.ipac.caltech.edu/data/SPHEREx/docs/overview_qr.html" target="_blank" rel="noreferrer">SPHEREx release documentation ↗</a></p>
    <details><summary>Keyboard & privacy</summary><p>Focus the map, then use arrow keys to pan, +/− to zoom, Home to reset, and Enter to select a footprint. Escape closes panels. Bookmarks stay in this browser; export a backup before clearing browser storage. Object searches go to CDS; archive links open IRSA.</p></details>
  </section>;
}
