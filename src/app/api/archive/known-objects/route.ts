import type { SkyCoordinate } from "../../../components/sky-types";
import type { KnownObjectCheck } from "../../../lib/archive-types";

function unavailable(message: string): KnownObjectCheck {
  return { status: "unavailable", matches: [], message };
}

function sexagesimal(value: number, isRa: boolean) {
  const positive = isRa ? ((value % 360) + 360) % 360 : Math.abs(value);
  const totalSeconds = isRa ? (positive / 15) * 3600 : positive * 3600;
  const first = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds - first * 3600) / 60);
  const seconds = totalSeconds - first * 3600 - minutes * 60;
  const sign = !isRa && value < 0 ? "M" : "";
  return sign + String(first).padStart(2, "0") + "-" +
    String(minutes).padStart(2, "0") + "-" + seconds.toFixed(2).padStart(5, "0");
}

function degreesFromSexagesimal(value: string, isRa: boolean) {
  const negative = /^\s*-/.test(value);
  const parts = value.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const degrees = Math.abs(parts[0]) + parts[1] / 60 + parts[2] / 3600;
  return isRa ? degrees * 15 : negative ? -degrees : degrees;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      center?: SkyCoordinate;
      date?: string;
      widthDeg?: number;
      heightDeg?: number;
    };
    const { center, date } = body;
    const width = Number(body.widthDeg);
    const height = Number(body.heightDeg);
    if (
      !center ||
      !Number.isFinite(center.raDeg) ||
      !Number.isFinite(center.decDeg) ||
      !Number.isFinite(Date.parse(date ?? "")) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      return Response.json(unavailable("The observation time or sky area is incomplete."), { status: 400 });
    }

    const url = new URL("https://ssd-api.jpl.nasa.gov/sb_ident.api");
    url.searchParams.set("obs-time", new Date(date!).toISOString().replace("T", "_").slice(0, 19));
    url.searchParams.set("fov-ra-center", sexagesimal(center.raDeg, true));
    url.searchParams.set("fov-dec-center", sexagesimal(center.decDeg, false));
    url.searchParams.set("fov-ra-hwidth", String(Math.min(10, width / 2)));
    url.searchParams.set("fov-dec-hwidth", String(Math.min(10, height / 2)));
    // Archive rows do not expose the spacecraft state needed for a precise observer location.
    url.searchParams.set("mpc-code", "568");
    url.searchParams.set("vmag-lim", "25");
    url.searchParams.set("two-pass", "true");
    url.searchParams.set("suppress-first-pass", "true");
    url.searchParams.set("mag-required", "true");

    const response = await fetch(url, { signal: AbortSignal.timeout(12000), cache: "no-store" });
    if (!response.ok) {
      return Response.json(unavailable("JPL cross-check returned HTTP " + response.status + "."));
    }
    const payload = await response.json() as {
      error?: string;
      fields_second?: string[];
      data_second_pass?: string[][];
    };
    if (payload.error) return Response.json(unavailable("JPL cross-check failed: " + payload.error));
    if (!Array.isArray(payload.fields_second) || !Array.isArray(payload.data_second_pass)) {
      return Response.json(unavailable("JPL returned no match table. This is not a no-match result."));
    }
    const fields = payload.fields_second ?? [];
    const rows = payload.data_second_pass ?? [];
    const column = (prefix: string) => fields.findIndex((name) => name.toLowerCase().startsWith(prefix));
    const matches = rows.map((row) => {
      const rawName = row[column("object name")] ?? "Unknown object";
      const objectNumber = rawName.match(/^\(?\d+\)?/);
      const ra = row[column("astrometric ra")] ?? "";
      const dec = row[column("astrometric dec")] ?? "";
      const magnitude = Number(row[column("visual magnitude")] ?? "");
      return {
        designation: objectNumber?.[0] ?? rawName,
        name: rawName,
        raDeg: degreesFromSexagesimal(ra, true),
        decDeg: degreesFromSexagesimal(dec, false),
        magnitude: Number.isFinite(magnitude) ? magnitude : null,
      };
    });
    return Response.json({
      status: matches.length ? "matches" : "none",
      matches,
      message: matches.length
        ? "Known-object check used an Earth-site proxy; review matches against the observation before interpreting them."
        : "JPL returned no known-object matches for this field and time. The Earth-site proxy is approximate.",
    } satisfies KnownObjectCheck);
  } catch {
    return Response.json(unavailable("JPL cross-check is unavailable. This is not a no-match result."));
  }
}
