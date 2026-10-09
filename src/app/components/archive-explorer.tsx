"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { KnownObjectCheck, SavedCandidate, SkyObservation, SkyRegion } from "../lib/archive-types";
import type { SkyCoordinate } from "./sky-types";
import { SPHEREX_DEMO_OBSERVATIONS } from "./spherex-demo";
import styles from "./archive-explorer.module.css";

type ArchiveExplorerProps = {
  mode: "spherex" | "planetx";
  region: SkyRegion | null;
  observations: readonly SkyObservation[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  busy: boolean;
  statusMessage: string;
  isArchiveData: boolean;
  candidates: readonly SavedCandidate[];
  candidateStoreReady: boolean;
  candidatePosition: SkyCoordinate;
  currentCenter: SkyCoordinate;
  onCandidatePositionChange: (position: SkyCoordinate) => void;
  onUseCurrentCenter: () => void;
  onCheckKnownObjects: (observationId: string) => Promise<KnownObjectCheck>;
  onSaveCandidate: (check: KnownObjectCheck, observationIds: string[]) => void;
  onExportCandidates: () => void;
  onSearch: () => void;
  onClose: () => void;
};

type PreviewImageProps = {
  observation: SkyObservation;
  fallback: string | null;
  clipPath?: string;
  onFailure: (id: string, message: string) => void;
};

function PreviewImage({ observation, fallback, clipPath, onFailure }: PreviewImageProps) {
  const [imageSource, setImageSource] = useState<string | null>(() =>
    observation.source === "demo" ? observation.previewUrl ?? fallback : null,
  );
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (observation.source === "demo" || !observation.previewUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const loadPreview = async () => {
      try {
        const response = await fetch(observation.previewUrl!);
        if (!response.ok) {
          let detail = "Preview request returned HTTP " + response.status + ".";
          try {
            const payload = await response.json() as { error?: string };
            if (payload.error) detail = payload.error;
          } catch {
            // Keep the HTTP response as the useful error detail.
          }
          throw new Error(detail);
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) throw new Error("IRSA preview did not return an image.");
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setImageSource(objectUrl);
      } catch (error) {
        if (cancelled) return;
        setImageSource(fallback);
        setUnavailable(!fallback);
        onFailure(observation.id, error instanceof Error ? error.message : "Preview could not be loaded.");
      }
    };
    void loadPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallback, observation.id, observation.previewUrl, observation.source, onFailure]);

  return imageSource ? (
    <Image
      className={styles.image}
      src={imageSource}
      alt=""
      fill
      sizes="(max-width: 760px) calc(100vw - 40px), 360px"
      unoptimized
      draggable={false}
      style={clipPath ? { clipPath } : undefined}
      onError={() => {
        if (imageSource !== fallback) {
          setImageSource(fallback);
          setUnavailable(!fallback);
          onFailure(observation.id, "The generated image preview could not be displayed.");
        }
      }}
    />
  ) : unavailable ? (
    <div className={styles.imageUnavailable} style={clipPath ? { clipPath } : undefined} role="status">
      Observation preview unavailable
    </div>
  ) : (
    <div className={styles.imageLoading} style={clipPath ? { clipPath } : undefined} role="status">
      <span />
      Loading cutout…
    </div>
  );
}

function coordinateText(value: number, kind: "ra" | "dec") {
  const sign = kind === "dec" && value >= 0 ? "+" : "";
  return sign + value.toFixed(4) + "°";
}

function localPreviewFor(date: string) {
  const targetTime = Date.parse(date);
  return SPHEREX_DEMO_OBSERVATIONS.reduce((closest, observation) => {
    return Math.abs(Date.parse(observation.date) - targetTime) < Math.abs(Date.parse(closest.date) - targetTime)
      ? observation
      : closest;
  }, SPHEREX_DEMO_OBSERVATIONS[0]).image;
}

export default function ArchiveExplorer({
  mode,
  region,
  observations,
  activeIndex,
  onActiveIndexChange,
  busy,
  statusMessage,
  isArchiveData,
  candidates,
  candidateStoreReady,
  candidatePosition,
  currentCenter,
  onCandidatePositionChange,
  onUseCurrentCenter,
  onCheckKnownObjects,
  onSaveCandidate,
  onExportCandidates,
  onSearch,
  onClose,
}: ArchiveExplorerProps) {
  const [wipe, setWipe] = useState(50);
  const [playing, setPlaying] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<Record<string, string>>({});
  const [checksByObservation, setChecksByObservation] = useState<Record<string, KnownObjectCheck>>({});
  const [checkingObservationId, setCheckingObservationId] = useState<string | null>(null);

  useEffect(() => {
    if (!playing || observations.length < 2) return;
    const timer = window.setInterval(() => {
      onActiveIndexChange(activeIndex >= observations.length - 1 ? 0 : activeIndex + 1);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeIndex, observations.length, onActiveIndexChange, playing]);

  const pair = useMemo(() => {
    const laterIndex = Math.min(activeIndex, observations.length - 1);
    const earlierIndex = Math.max(0, laterIndex - 1);
    return [observations[earlierIndex], observations[laterIndex]] as const;
  }, [activeIndex, observations]);
  const earlier = pair[0];
  const later = pair[1];
  const hasTwoDates = Boolean(earlier && later && earlier.id !== later.id);
  const knownObjectCheck = later ? checksByObservation[later.id] ?? null : null;
  const checkingKnownObjects = later?.id === checkingObservationId;
  const isPlanetX = mode === "planetx";
  const previewFailed = [earlier, later].some((observation) =>
    observation?.source === "archive" && Boolean(previewErrors[observation.id]),
  );
  const previewError = [earlier, later]
    .map((observation) => observation ? previewErrors[observation.id] : undefined)
    .find(Boolean);
  const notePreviewFailure = useCallback((id: string, message: string) => {
    setPreviewErrors((current) => ({ ...current, [id]: message }));
  }, []);
  const requestKnownCheck = async () => {
    if (!later) return;
    setCheckingObservationId(later.id);
    try {
      const result = await onCheckKnownObjects(later.id);
      setChecksByObservation((current) => ({ ...current, [later.id]: result }));
    } catch {
      setChecksByObservation((current) => ({
        ...current,
        [later.id]: {
          status: "unavailable",
          matches: [],
          message: "JPL cross-check is unavailable. This is not a no-match result.",
        },
      }));
    } finally {
      setCheckingObservationId(null);
    }
  };
  const title = isPlanetX ? "Planet X · candidate review" : "SPHEREx · time series";

  return (
    <aside className={styles.panel} aria-label={isPlanetX ? "Planet X candidate review" : "SPHEREx observation explorer"}>
      <header className={styles.header}>
        <div className={styles.headingMark} aria-hidden="true">{isPlanetX ? "◇" : "◈"}</div>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>{isPlanetX ? "WISE / NEOWISE ARCHIVE" : "SPHEREx ARCHIVE · QR2 L2"}</p>
          <h2>{title}</h2>
        </div>
        <button className={styles.close} type="button" aria-label="Close observation panel" onClick={onClose}>×</button>
      </header>

      <div className={styles.context}>
        <span className={isArchiveData ? styles.liveTag : styles.demoTag}>{isArchiveData ? "IRSA RESULTS" : "LOCAL DEMO"}</span>
        <span>{region ? "Selected sky area" : "Sample field"}</span>
        {region && <span>RA {coordinateText(candidatePosition.raDeg, "ra")} · Dec {coordinateText(candidatePosition.decDeg, "dec")}</span>}
      </div>

      {statusMessage && (
        <div className={styles.statusMessage} role="status">
          <span aria-hidden="true">{busy ? "◌" : isArchiveData ? "✓" : "!"}</span>
          <p>{statusMessage}</p>
        </div>
      )}
      {previewFailed && (
        <div className={styles.previewWarning} role="status">
          {isPlanetX
            ? "The IRSA cutout is unavailable; no WISE/NEOWISE preview is shown. "
            : "The IRSA cutout is unavailable; showing a local SPHEREx demo image. "}
          {previewError}
        </div>
      )}

      {observations.length > 0 && earlier && later ? (
        <>
          <div className={styles.imageFrame} aria-label="Two-date observation comparison">
            <PreviewImage
              key={earlier.id}
              observation={earlier}
              fallback={isPlanetX ? null : localPreviewFor(earlier.date)}
              onFailure={notePreviewFailure}
            />
            {hasTwoDates && (
              <>
                <PreviewImage
                  key={"later:" + later.id}
                  observation={later}
                  fallback={isPlanetX ? null : localPreviewFor(later.date)}
                  clipPath={`inset(0 0 0 ${wipe}%)`}
                  onFailure={notePreviewFailure}
                />
                <span className={styles.wipeDivider} style={{ left: wipe + "%" }} aria-hidden="true">
                  <span />
                </span>
              </>
            )}
            <span className={styles.imageBadge}>{hasTwoDates ? earlier.band + " / " + later.band : later.band}</span>
          </div>
          <div className={styles.dateRow}>
            <span>{hasTwoDates ? earlier.dateLabel : "No earlier observation"}</span>
            <span>{later.dateLabel}</span>
          </div>
          {hasTwoDates ? (
            <>
              <label className={styles.wipeLabel} htmlFor="archive-wipe">
                <span>WIPE TO COMPARE</span><span>{wipe}%</span>
              </label>
              <input
                id="archive-wipe"
                className={styles.wipe}
                type="range"
                min="0"
                max="100"
                value={wipe}
                onChange={(event) => setWipe(Number(event.currentTarget.value))}
                aria-label="Wipe between the earlier and later observation"
              />
            </>
          ) : (
            <p className={styles.singleObservation}>This is the first available observation for the selected area.</p>
          )}
          {observations.length > 1 && (
            <div className={styles.timeline}>
              <div className={styles.timelineTop}>
                <span>OBSERVATION TIMELINE</span>
                <button type="button" onClick={() => setPlaying((current) => !current)} aria-pressed={playing}>
                  {playing ? "Pause" : "Play"}
                </button>
              </div>
              <input
                type="range"
                min="0"
                max={observations.length - 1}
                value={activeIndex}
                onChange={(event) => onActiveIndexChange(Number(event.currentTarget.value))}
                aria-label="Select observation date"
              />
              <div className={styles.timelineLabels}>
                <span>{observations[0].dateLabel}</span>
                <span>{observations[observations.length - 1].dateLabel}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyPreview} role="status">
          <span aria-hidden="true">◌</span>
          <strong>No observations in this area</strong>
          <p>{region ? "Try a larger area or another position on the sky." : "Draw a rectangle on the map to search this exact area."}</p>
        </div>
      )}

      <div className={styles.observationList}>
        <div className={styles.sectionTitle}>
          <span>{observations.length} {observations.length === 1 ? "OBSERVATION" : "OBSERVATIONS"}</span>
          {region && <button type="button" onClick={onSearch} disabled={busy}>{busy ? "Searching…" : "Refresh"}</button>}
        </div>
        {observations.slice(0, 8).map((observation, index) => (
          <button
            className={index === activeIndex ? styles.observationActive : styles.observation}
            key={observation.id}
            type="button"
            onClick={() => onActiveIndexChange(index)}
          >
            <span className={styles.observationDate}>{observation.dateLabel}</span>
            <span className={styles.observationBand}>{observation.band}</span>
            <span className={styles.observationName} title={observation.productName}>{observation.productName}</span>
          </button>
        ))}
        {observations.length > 8 && <p className={styles.moreRows}>Showing 8 of {observations.length}; timeline includes every result.</p>}
      </div>

      {isPlanetX && (
        <section className={styles.candidateSection} aria-label="Candidate tools">
          <div className={styles.candidateHeading}>
            <span>MANUAL CANDIDATE REVIEW</span>
            <span>{candidates.length} saved</span>
          </div>
          <p className={styles.candidateNote}>Set a position, compare the dates, then check known objects before saving a possible candidate.</p>
          <button className={styles.centerButton} type="button" onClick={onUseCurrentCenter}>
            Use sky center · RA {coordinateText(currentCenter.raDeg, "ra")} · Dec {coordinateText(currentCenter.decDeg, "dec")}
          </button>
          <div className={styles.coordinateInputs}>
            <label>RA (deg)
              <input
                type="number"
                min="0"
                max="360"
                step="0.0001"
                value={candidatePosition.raDeg.toFixed(4)}
                onChange={(event) => onCandidatePositionChange({ ...candidatePosition, raDeg: Number(event.currentTarget.value) })}
              />
            </label>
            <label>Dec (deg)
              <input
                type="number"
                min="-90"
                max="90"
                step="0.0001"
                value={candidatePosition.decDeg.toFixed(4)}
                onChange={(event) => onCandidatePositionChange({ ...candidatePosition, decDeg: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
          <div className={styles.candidateActions}>
            <button type="button" onClick={() => void requestKnownCheck()} disabled={checkingKnownObjects || !region || !later || !isArchiveData}>
              {checkingKnownObjects ? "Checking…" : "Check known objects"}
            </button>
            <button
              type="button"
              onClick={() => onSaveCandidate(
                knownObjectCheck ?? {
                  status: "unavailable",
                  matches: [],
                  message: "The known-object cross-check has not been run.",
                },
                Array.from(new Set([earlier?.id, later?.id].filter((id): id is string => Boolean(id)))),
              )}
              disabled={!region || !later || !candidateStoreReady}
            >Flag candidate</button>
          </div>
          {knownObjectCheck && (
            <div className={knownObjectCheck.status === "unavailable" ? styles.checkUnavailable : styles.checkResult} role="status">
              <strong>
                {knownObjectCheck.status === "matches"
                  ? knownObjectCheck.matches.length + " known-object match" + (knownObjectCheck.matches.length === 1 ? "" : "es")
                  : knownObjectCheck.status === "none" ? "No known-object match returned" : "Cross-check unavailable"}
              </strong>
              <p>{knownObjectCheck.message}</p>
              {knownObjectCheck.matches.slice(0, 3).map((match) => (
                <span key={match.designation}>{match.name ? match.name + " · " : ""}{match.designation}</span>
              ))}
            </div>
          )}
          <button className={styles.savedToggle} type="button" onClick={() => setShowSaved((shown) => !shown)} aria-expanded={showSaved}>
            {showSaved ? "Hide" : "Review"} saved candidates · {candidates.length}
          </button>
          {showSaved && (
            <div className={styles.savedList}>
              {candidates.length === 0 ? <span>No candidates saved on this device.</span> : candidates.slice(0, 4).map((candidate) => (
                <span key={candidate.id}>
                  RA {coordinateText(candidate.coordinate.raDeg, "ra")} · Dec {coordinateText(candidate.coordinate.decDeg, "dec")} · {candidate.knownObjectCheck.status}
                </span>
              ))}
              <button type="button" onClick={onExportCandidates} disabled={candidates.length === 0}>Export CSV</button>
            </div>
          )}
        </section>
      )}

      <p className={styles.footnote}>
        {isPlanetX
          ? "Candidate review only. A JPL lookup is an Earth-site approximation; it cannot confirm or rule out Planet X."
          : "Only archive results are observations. The local sample is provided for exploring the controls."}
      </p>
    </aside>
  );
}
