import { searchIrsa } from "../../../lib/irsa";
import type { ArchiveMode, SkyRegion } from "../../../lib/archive-types";

function isRegion(value: unknown): value is SkyRegion {
  if (!value || typeof value !== "object") return false;
  const region = value as Partial<SkyRegion>;
  return typeof region.id === "string" &&
    Array.isArray(region.vertices) &&
    region.vertices.length >= 3 &&
    region.vertices.length <= 16 &&
    region.vertices.every((point) =>
      point &&
      Number.isFinite(point.raDeg) &&
      point.raDeg >= 0 &&
      point.raDeg < 360 &&
      Number.isFinite(point.decDeg) &&
      point.decDeg >= -90 &&
      point.decDeg <= 90,
    );
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { mode?: unknown; region?: unknown };
    const mode = body.mode;
    if (mode !== "spherex" && mode !== "planetx") {
      return Response.json({ error: "Choose SPHEREx or Planet X mode." }, { status: 400 });
    }
    if (!isRegion(body.region)) {
      return Response.json({ error: "Draw a valid sky area first." }, { status: 400 });
    }

    const observations = await searchIrsa(mode as ArchiveMode, body.region);
    return Response.json({
      observations,
      source: "archive",
      message: observations.length ? undefined : "IRSA returned no overlapping observations for this area.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Archive request failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
