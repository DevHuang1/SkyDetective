import type { ArchiveMode, SkyObservation, SkyRegion } from "./archive-types";

const IRSA_SIA_URL = "https://irsa.ipac.caltech.edu/SIA";
const RESULT_LIMIT = 36;

function parseCsv(text: string) {
  text = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  const headers = rows.shift()?.map((header) => header.trim().toLowerCase()) ?? [];
  return rows
    .filter((cells) => cells.some((cell) => cell.trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

function field(record: Record<string, string>, ...names: string[]) {
  for (const name of names) {
    const value = record[name.toLowerCase()];
    if (value?.trim()) return value.trim();
  }
  return "";
}

function parsePolygon(value: string) {
  const numbers = value
    .replace(/^\s*(polygon|pos)\s+(icrs|fk5|j2000)?\s*/i, "")
    .match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)
    ?.map(Number) ?? [];
  const vertices = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    if (Math.abs(numbers[index + 1]) <= 90) {
      vertices.push({
        raDeg: ((numbers[index] % 360) + 360) % 360,
        decDeg: numbers[index + 1],
      });
    }
  }
  return vertices.length >= 3 ? vertices : null;
}

function fallbackFootprint(record: Record<string, string>, id: string) {
  const ra = Number(field(record, "s_ra", "ra", "center_ra"));
  const dec = Number(field(record, "s_dec", "dec", "center_dec"));
  const size = Number(field(record, "s_fov", "fov", "width")) || 0.12;
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  const half = Math.max(0.005, Math.min(2, size / 2));
  const raHalf = half / Math.max(0.12, Math.cos((dec * Math.PI) / 180));
  return {
    id,
    vertices: [
      { raDeg: (ra - raHalf + 360) % 360, decDeg: Math.max(-90, dec + half) },
      { raDeg: (ra + raHalf) % 360, decDeg: Math.max(-90, dec + half) },
      { raDeg: (ra + raHalf) % 360, decDeg: Math.min(90, dec - half) },
      { raDeg: (ra - raHalf + 360) % 360, decDeg: Math.min(90, dec - half) },
    ],
    kind: "observation" as const,
  };
}

function parseMjd(value: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 30000 || number > 100000) return null;
  return new Date((number - 40587) * 86400000).toISOString();
}

function dateFor(record: Record<string, string>) {
  const value = field(record, "time_coverage_start", "date_obs", "obs_time", "date", "mjd_obs", "mjd", "t_min");
  if (!value) return "";
  const mjd = parseMjd(value);
  if (mjd) return mjd;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function compactProductName(record: Record<string, string>, accessUrl: string) {
  const name = field(record, "obs_id", "obsid", "filename", "productfilename", "granule_uid");
  if (name) return name.split("/").at(-1) ?? name;
  try {
    return new URL(accessUrl).pathname.split("/").at(-1) ?? accessUrl;
  } catch {
    return "Archive image";
  }
}

function makePreviewUrl(accessUrl: string, region: SkyRegion) {
  const params = new URLSearchParams({
    url: accessUrl,
    region: JSON.stringify(region.vertices),
  });
  return "/api/archive/preview?" + params.toString();
}

function normalizeRecord(record: Record<string, string>, mode: ArchiveMode, region: SkyRegion, index: number): SkyObservation | null {
  const accessUrl = field(record, "access_url", "accessurl");
  if (!accessUrl) return null;
  const rawId = field(record, "obs_id", "obsid", "obs_publisher_did", "granule_uid") || accessUrl.slice(-20);
  const date = dateFor(record);
  const bandName = field(record, "energy_bandpassname", "band", "bandpass", "filter", "instrume");
  const filename = compactProductName(record, accessUrl);
  const band = mode === "spherex"
    ? "D1"
    : (/w2|4\.6|4p6/i.test(bandName + " " + filename) ? "W2" : "W1");
  const id = rawId + "-" + band + "-" + index;
  const polygon = parsePolygon(field(record, "s_region", "sregion"));
  const footprint = polygon
    ? { id: "obs:" + id, vertices: polygon, kind: "observation" as const }
    : fallbackFootprint(record, "obs:" + id);

  if (!date || !footprint) return null;
  return {
    id,
    survey: mode === "spherex" ? "SPHEREx QR2" : "NEOWISE",
    date,
    dateLabel: new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(date)),
    band,
    bandLabel: mode === "spherex" ? "D1 · 0.75–1.09 μm" : band === "W1" ? "W1 · 3.4 μm" : "W2 · 4.6 μm",
    productName: filename,
    footprint,
    previewUrl: makePreviewUrl(accessUrl, region),
    accessUrl,
    source: "archive",
  };
}

function regionQuery(region: SkyRegion) {
  return "POLYGON " + region.vertices.map(({ raDeg, decDeg }) => raDeg.toFixed(7) + " " + decDeg.toFixed(7)).join(" ");
}

export async function searchIrsa(mode: ArchiveMode, region: SkyRegion): Promise<SkyObservation[]> {
  const url = new URL(IRSA_SIA_URL);
  url.searchParams.set("COLLECTION", mode === "spherex" ? "spherex_qr2" : "neowiser");
  url.searchParams.set("POS", regionQuery(region));
  if (mode === "spherex") url.searchParams.set("BAND", "1.0e-6");
  url.searchParams.set("MAXREC", "100");
  url.searchParams.set("RESPONSEFORMAT", "CSV");

  const response = await fetch(url, {
    headers: { Accept: "text/csv, text/plain;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("IRSA returned HTTP " + response.status);

  const text = await response.text();
  const records = parseCsv(text)
    .map((record, index) => normalizeRecord(record, mode, region, index))
    .filter((record): record is SkyObservation => record !== null)
    .sort((first, second) => first.date.localeCompare(second.date));
  const unique = new Map<string, SkyObservation>();
  for (const record of records) {
    if (record.accessUrl && !unique.has(record.accessUrl)) unique.set(record.accessUrl, record);
  }
  return Array.from(unique.values()).slice(0, RESULT_LIMIT);
}
