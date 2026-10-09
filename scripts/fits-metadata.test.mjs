import test from "node:test";
import assert from "node:assert/strict";
import { inspectFits } from "../src/app/components/fits-metadata.ts";

function header(cards) {
  const values = cards.map(([key, value]) => `${key.padEnd(8)}= ${typeof value === "boolean" ? (value ? "T" : "F") : typeof value === "string" ? `'${value}'` : value}`.padEnd(80));
  values.push("END".padEnd(80));
  return values.join("").padEnd(Math.ceil(values.length * 80 / 2880) * 2880);
}
const primary = header([["SIMPLE", true], ["BITPIX", 8], ["NAXIS", 0]]);
const image = (extra = []) => header([["XTENSION", "IMAGE"], ["EXTNAME", "IMAGE"], ["BITPIX", -32], ["NAXIS", 2], ["NAXIS1", 2], ["NAXIS2", 1], ["CTYPE1", "RA---TAN"], ["CTYPE2", "DEC--TAN"], ["CRVAL1", 127.69444], ["CRVAL2", -39.1776], ["DETECTOR", 1], ["DATE-OBS", "2025-05-03T01:27:11.698"], ["BUNIT", "MJy/sr"], ...extra]);

test("FITS inspection reads a science extension without reading its pixels", async () => {
  const result = await inspectFits(new File([primary, image(), new Uint8Array(2880)], "sample.fits"));
  assert.equal(result.detector, 1);
  assert.equal(result.date, "2025-05-03T01:27:11.698");
  assert.deepEqual(result.center, { raDeg: 127.69444, decDeg: -39.1776 });
  assert.equal(result.width, 2);
  assert.equal(result.unit, "MJy/sr");
});

test("FITS inspection rejects non-FITS, truncated images, and invalid coordinates", async () => {
  await assert.rejects(inspectFits(new File(["hello"], "bad.fits")), /Incomplete/);
  await assert.rejects(inspectFits(new File([primary, image()], "short.fits")), /truncated IMAGE/);
  await assert.rejects(inspectFits(new File([primary, image([["CRVAL2", 91]]), new Uint8Array(2880)], "bad-coordinate.fits")), /coordinates/);
  await assert.rejects(inspectFits(new File([primary], "no-image.fits")), /No SPHEREx IMAGE/);
});

test("FITS inspection safely skips binary tables before the science extension", async () => {
  const table = header([["XTENSION", "BINTABLE"], ["BITPIX", 8], ["NAXIS", 2], ["NAXIS1", 8], ["NAXIS2", 2], ["PCOUNT", 4], ["GCOUNT", 1]]);
  const result = await inspectFits(new File([primary, table, new Uint8Array(2880), image(), new Uint8Array(2880)], "table-first.fits"));
  assert.equal(result.detector, 1);
});
