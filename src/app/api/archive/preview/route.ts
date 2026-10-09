import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SkyCoordinate } from "../../../components/sky-types";

export const maxDuration = 60;

const MAX_FITS_BYTES = 80 * 1024 * 1024;

function parseRegion(value: string | null): SkyCoordinate[] | null {
  if (!value) return null;
  try {
    const points = JSON.parse(value) as SkyCoordinate[];
    if (
      !Array.isArray(points) ||
      points.length < 3 ||
      points.length > 16 ||
      !points.every((point) =>
        Number.isFinite(point.raDeg) &&
        point.raDeg >= 0 &&
        point.raDeg < 360 &&
        Number.isFinite(point.decDeg) &&
        point.decDeg >= -90 &&
        point.decDeg <= 90,
      )
    ) return null;
    return points;
  } catch {
    return null;
  }
}

function angularDistance(first: SkyCoordinate, second: SkyCoordinate) {
  const radians = Math.PI / 180;
  const dec1 = first.decDeg * radians;
  const dec2 = second.decDeg * radians;
  const deltaDec = dec2 - dec1;
  const deltaRa = (((second.raDeg - first.raDeg + 540) % 360) - 180) * radians;
  const haversine = Math.sin(deltaDec / 2) ** 2 +
    Math.cos(dec1) * Math.cos(dec2) * Math.sin(deltaRa / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(haversine))) / radians;
}

function centerAndSize(points: SkyCoordinate[]) {
  const radians = Math.PI / 180;
  const vector = points.reduce(
    (sum, point) => {
      const ra = point.raDeg * radians;
      const dec = point.decDeg * radians;
      sum[0] += Math.cos(dec) * Math.cos(ra);
      sum[1] += Math.cos(dec) * Math.sin(ra);
      sum[2] += Math.sin(dec);
      return sum;
    },
    [0, 0, 0],
  );
  const center = {
    raDeg: (Math.atan2(vector[1], vector[0]) / radians + 360) % 360,
    decDeg: Math.atan2(vector[2], Math.hypot(vector[0], vector[1])) / radians,
  };
  const size = Math.max(...points.map((point) => angularDistance(center, point))) * 2.12;
  return { center, size: Math.max(0.03, Math.min(3, size)) };
}

function allowedArchiveUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowedPath =
      url.pathname.startsWith("/ibe/data/spherex/qr2/") ||
      url.pathname.startsWith("/ibe/data/wise/neowiser/") ||
      url.pathname.startsWith("/ibe/data/wise/allsky/");
    return url.protocol === "https:" && url.hostname === "irsa.ipac.caltech.edu" && allowedPath
      ? url
      : null;
  } catch {
    return null;
  }
}

async function readLimited(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FITS_BYTES) {
    throw new Error("The archive cutout is too large to preview.");
  }
  if (!response.body) throw new Error("IRSA returned an empty cutout.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FITS_BYTES) {
      await reader.cancel();
      throw new Error("The archive cutout is too large to preview.");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function renderFits(fitsPath: string, outputPath: string, center: SkyCoordinate, size: number) {
  return new Promise<void>((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "render_spherex_previews.py");
    const child = spawn("python3", [
      scriptPath,
      "--input-fits", fitsPath,
      "--output-file", outputPath,
      "--center-ra", String(center.raDeg),
      "--center-dec", String(center.decDeg),
      "--fov-width", String(size),
      "--width", "640",
      "--height", "480",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    let errorText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { errorText += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorText.trim() || "The FITS preview renderer failed."));
    });
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const archiveUrl = allowedArchiveUrl(requestUrl.searchParams.get("url"));
  const region = parseRegion(requestUrl.searchParams.get("region"));
  if (!archiveUrl || !region) {
    return Response.json({ error: "A valid IRSA observation and selected region are required." }, { status: 400 });
  }

  const { center, size } = centerAndSize(region);
  archiveUrl.searchParams.set("center", center.raDeg.toFixed(7) + "," + center.decDeg.toFixed(7));
  archiveUrl.searchParams.set("size", size.toFixed(5));
  const directory = await mkdtemp(path.join(tmpdir(), "skydetective-preview-"));
  const fitsPath = path.join(directory, "observation.fits");
  const outputPath = path.join(directory, "preview.png");

  try {
    const response = await fetch(archiveUrl, {
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
      headers: { Accept: "application/fits, application/octet-stream, */*" },
    });
    if (!response.ok) throw new Error("IRSA cutout returned HTTP " + response.status + ".");
    const fits = await readLimited(response);
    await writeFile(fitsPath, fits);
    await renderFits(fitsPath, outputPath, center, size);
    const image = await readFile(outputPath);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-SkyDetective-Preview": "fits-reprojected",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview generation failed.";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
