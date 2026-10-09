"use client";

import { useState } from "react";
import Image from "next/image";
import type { SkyCoordinate } from "./sky-types";
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
  const [earlier, later] = SPHEREX_DEMO_OBSERVATIONS;

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

      <figure className={styles.figure}>
        <div
          className={styles.frame}
          role="img"
          aria-label={`Aligned SPHEREx D1 intensity images from ${earlier.date} and ${later.date}. Move the comparison control to reveal each observation.`}
        >
          <Image
            className={styles.image}
            src={earlier.image}
            alt=""
            fill
            sizes="(max-width: 760px) calc(100vw - 60px), 328px"
            draggable={false}
          />
          <Image
            className={`${styles.image} ${styles.laterImage}`}
            src={later.image}
            alt=""
            fill
            sizes="(max-width: 760px) calc(100vw - 60px), 328px"
            draggable={false}
            aria-hidden="true"
            style={{ clipPath: `inset(0 0 0 ${split}%)` }}
          />
          <span
            className={styles.divider}
            aria-hidden="true"
            style={{ left: `${split}%` }}
          >
            <span className={styles.dividerHandle} />
          </span>
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

      <p className={styles.note}>MJy/sr · shared display stretch</p>
    </section>
  );
}
