"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { SkyCoordinate } from "./sky-types";
import { archiveUrl, downloadJson } from "./sky-data";
import { SPHEREX_DEMO_OBSERVATIONS } from "./spherex-demo";
import styles from "./spherex-comparison.module.css";

type SpherexComparisonProps = {
  center: SkyCoordinate;
  onClose: () => void;
};

function formatCoordinate(value: number, kind: "RA" | "DEC") {
  const sign = kind === "DEC" && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(3)}°`;
}

export default function SpherexComparison({
  center,
  onClose,
}: SpherexComparisonProps) {
  const [split, setSplit] = useState(50);
  const [mode, setMode] = useState<"compare" | "timelapse">("compare");
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [intervalMs, setIntervalMs] = useState(1000);
  const [earlier, later] = SPHEREX_DEMO_OBSERVATIONS;

  const currentFrame = SPHEREX_DEMO_OBSERVATIONS[frameIndex];
  useEffect(() => {
    if (!playing || mode !== "timelapse") return;
    const timer = setInterval(() => {
      if (!document.hidden) setFrameIndex((index) => (index + 1) % SPHEREX_DEMO_OBSERVATIONS.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [playing, mode, intervalMs]);

  return (
    <section className={styles.panel} aria-label="SPHEREx observation inspector">
      <div className={styles.heading}>
        <span className={styles.archiveMark} aria-hidden="true" />
        <div className={styles.headingText}>
          <p className={styles.eyebrow}>SPHEREx archive · QR2 L2</p>
          <h2>Same sky, 19 days apart</h2>
        </div>
        <button
          className={styles.closeButton}
          type="button"
          aria-label="Close observation inspector"
          onClick={onClose}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m5 5 10 10M15 5 5 15" />
          </svg>
        </button>
      </div>

      <div className={styles.modeButtons} role="group" aria-label="Observation viewing mode">
        <button type="button" aria-pressed={mode === "compare"} onClick={() => { setMode("compare"); setPlaying(false); }}>Swipe comparison</button>
        <button type="button" aria-pressed={mode === "timelapse"} onClick={() => setMode("timelapse")}>Timelapse</button>
      </div>
      <figure className={styles.figure}>
        <div
          className={styles.frame}
          role="img"
          aria-label={mode === "timelapse" ? `SPHEREx observation from ${currentFrame.date}` : `Aligned SPHEREx D1 intensity images from ${earlier.date} and ${later.date}. Move the comparison control to reveal each observation.`}
        >
          <Image
            className={styles.image}
            src={mode === "timelapse" ? currentFrame.image : earlier.image}
            alt=""
            fill
            sizes="(max-width: 760px) calc(100vw - 60px), 328px"
            draggable={false}
          />
          {mode === "compare" && <Image
            className={`${styles.image} ${styles.laterImage}`}
            src={later.image}
            alt=""
            fill
            sizes="(max-width: 760px) calc(100vw - 60px), 328px"
            draggable={false}
            aria-hidden="true"
            style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          />}
          {mode === "compare" && <span
            className={styles.divider}
            aria-hidden="true"
            style={{ left: `${split}%` }}
          >
            <span className={styles.dividerHandle} />
          </span>}
        </div>
        <figcaption className={styles.dateLabels}>
          <span>{earlier.date}</span>
          <span>{later.date}</span>
        </figcaption>
      </figure>

      <div className={styles.metadata}>
        <span>D1 · 0.75–1.09 μm · false-color intensity</span>
        <span>
          RA {formatCoordinate(center.raDeg, "RA")} · Dec{" "}
          {formatCoordinate(center.decDeg, "DEC")}
        </span>
      </div>

      {mode === "compare" ? <>
      <label className={styles.sliderLabel} htmlFor="spherex-observation-split">
        SWIPE TO COMPARE
        <span>{split}%</span>
      </label>
      <input
        id="spherex-observation-split"
        className={styles.slider}
        type="range"
        min="0"
        max="100"
        value={split}
        aria-label={`Reveal ${later.date} from right to left; ${earlier.date} remains on the left`}
        aria-valuetext={`${split}% of the comparison reveals the ${later.date} observation`}
        onChange={(event) => setSplit(Number(event.currentTarget.value))}
      />

      </> : <div className={styles.playback}>
        <p aria-live={playing ? "off" : "polite"}>{currentFrame.date} · frame {frameIndex + 1}/{SPHEREX_DEMO_OBSERVATIONS.length}</p>
        <div className={styles.modeButtons}>
          <button type="button" aria-label="Previous observation" onClick={() => { setPlaying(false); setFrameIndex((index) => (index + SPHEREX_DEMO_OBSERVATIONS.length - 1) % SPHEREX_DEMO_OBSERVATIONS.length); }}>←</button>
          <button type="button" aria-pressed={playing} onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play timelapse"}</button>
          <button type="button" aria-label="Next observation" onClick={() => { setPlaying(false); setFrameIndex((index) => (index + 1) % SPHEREX_DEMO_OBSERVATIONS.length); }}>→</button>
        </div>
        <label className={styles.sliderLabel} htmlFor="observation-frame">OBSERVATION <span>{frameIndex + 1}</span></label>
        <input id="observation-frame" className={styles.slider} type="range" min="0" max={SPHEREX_DEMO_OBSERVATIONS.length - 1} value={frameIndex} aria-valuetext={currentFrame.date} onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }} />
        <label className={styles.speedLabel}>Time per frame
          <select value={intervalMs} onChange={(event) => setIntervalMs(Number(event.target.value))}>
            <option value={500}>0.5 seconds</option><option value={1000}>1 second</option><option value={2000}>2 seconds</option>
          </select>
        </label>
      </div>}
      <p className={styles.note}>Two real observations; timelapse loops these dates. MJy/sr · shared display stretch. Matching D1 detectors can still sample different wavelengths.</p>
      <details className={styles.sources}>
        <summary>Data sources & downloads</summary>
        {SPHEREX_DEMO_OBSERVATIONS.map((observation) => <p key={observation.id}><a href={observation.sourceUrl} target="_blank" rel="noreferrer">{observation.date} · original FITS ↗</a></p>)}
        <p><a href={currentFrame.image} download>Download current preview PNG</a></p>
        <p><a href={archiveUrl(center)} target="_blank" rel="noreferrer">Find more dates in the archive ↗</a></p>
        <button type="button" onClick={() => downloadJson("skydetective-observations.json", { center, crop: { widthDeg: 0.7, heightDeg: 0.525 }, observations: SPHEREX_DEMO_OBSERVATIONS })}>Export observation details</button>
      </details>
    </section>
  );
}
