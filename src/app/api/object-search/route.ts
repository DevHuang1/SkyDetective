export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 100 || /[\r\n\x00-\x1f]/.test(query)) {
    return Response.json({ error: "Enter an object name of up to 100 characters." }, { status: 400 });
  }
  // CDS Sesame resolves names through SIMBAD, NED, and VizieR.
  const name = /^andromeda(?: galaxy)?$/i.test(query) ? "M31" : query;
  try {
    const response = await fetch(`https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(12000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Resolver unavailable");
    const xml = await response.text();
    const resolvers = xml.match(/<Resolver\b[^>]*>[\s\S]*?<\/Resolver>/g) ?? [];
    for (const resolver of resolvers) {
      const raText = resolver.match(/<jradeg>\s*([^<]+)<\/jradeg>/)?.[1];
      const decText = resolver.match(/<jdedeg>\s*([^<]+)<\/jdedeg>/)?.[1];
      if (!raText || !decText) continue;
      const raDeg = Number(raText);
      const decDeg = Number(decText);
      if (!Number.isFinite(raDeg) || !Number.isFinite(decDeg) || raDeg < 0 || raDeg >= 360 || Math.abs(decDeg) > 90) continue;
      return Response.json({ name: query, center: { raDeg, decDeg } });
    }
    return Response.json({ error: "Object not found. Try a catalog name such as M31, M42, or NGC 224." }, { status: 404 });
  } catch {
    return Response.json({ error: "Object search is unavailable right now. Please try again." }, { status: 503 });
  }
}
