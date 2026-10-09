import test from "node:test";
import assert from "node:assert/strict";
import { archiveUrl, parseSharedView, shareUrl, parseBookmarkBackup } from "../src/app/components/sky-data.ts";
import { GET } from "../src/app/api/object-search/route.ts";

const view = { center: { raDeg: 127.69444, decDeg: -39.1776 }, fieldOfViewDeg: 1.2 };
const bookmark = { ...view, id: "example", name: "Demo field", survey: "infrared" };

test("shared links restore coordinates, field width, and survey", () => {
  const url = new URL(shareUrl("https://example.org/?old=1#fragment", view, "infrared"));
  assert.deepEqual(parseSharedView(url.search), { ...view, survey: "infrared" });
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.has("old"), false);
});

test("invalid and incomplete shared positions are ignored", () => {
  for (const query of ["", "?ra=1&dec=2", "?ra=&dec=2&fov=1", "?ra=Infinity&dec=2&fov=1", "?ra=360&dec=2&fov=1", "?ra=-1&dec=2&fov=1", "?ra=1&dec=91&fov=1", "?ra=1&dec=2&fov=0", "?ra=1&dec=2&fov=121"]) assert.equal(parseSharedView(query), null, query);
  assert.equal(parseSharedView("?ra=0&dec=-90&fov=0.03")?.center.decDeg, -90);
});

test("archive searches preserve sky coordinates and bound the search radius", () => {
  const url = new URL(archiveUrl(view.center, 120));
  assert.equal(url.hostname, "irsa.ipac.caltech.edu");
  assert.equal(url.searchParams.get("ra"), "127.69444");
  assert.equal(url.searchParams.get("sr"), "5d");
  assert.equal(new URL(archiveUrl(view.center, 0)).searchParams.get("sr"), "0.01d");
});

test("bookmark backups reject duplicate identities, invalid positions, and unknown versions", () => {
  assert.deepEqual(parseBookmarkBackup({ version: 1, positions: [bookmark] }), [bookmark]);
  assert.equal(parseBookmarkBackup({ version: 2, positions: [bookmark] }), null);
  assert.equal(parseBookmarkBackup({ version: 1, positions: [bookmark, bookmark] }), null);
  assert.equal(parseBookmarkBackup({ version: 1, positions: [{ ...bookmark, center: { raDeg: 1, decDeg: NaN } }] }), null);
  assert.equal(parseBookmarkBackup({ version: 1, positions: [{ ...bookmark, id: "" }] }), null);
  assert.equal(parseBookmarkBackup({ version: 1, positions: Array.from({ length: 51 }, (_, id) => ({ ...bookmark, id: String(id) })) }), null);
});

test("object search validates queries and handles resolver success, absence, and failure", async () => {
  assert.equal((await GET(new Request("http://localhost/api/object-search?q="))).status, 400);
  assert.equal((await GET(new Request("http://localhost/api/object-search?q=%00"))).status, 400);
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      assert.ok(String(url).endsWith("?M31"));
      return new Response('<Resolver><jradeg>999</jradeg><jdedeg>0</jdedeg></Resolver><Resolver><jradeg>10.68471</jradeg><jdedeg>41.26875</jdedeg></Resolver>');
    };
    const resolved = await GET(new Request("http://localhost/api/object-search?q=Andromeda"));
    assert.equal(resolved.status, 200);
    assert.deepEqual((await resolved.json()).center, { raDeg: 10.68471, decDeg: 41.26875 });
    globalThis.fetch = async () => new Response("<Sesame/>");
    assert.equal((await GET(new Request("http://localhost/api/object-search?q=unknown"))).status, 404);
    globalThis.fetch = async () => { throw new Error("offline"); };
    assert.equal((await GET(new Request("http://localhost/api/object-search?q=M31"))).status, 503);
  } finally { globalThis.fetch = previousFetch; }
});
