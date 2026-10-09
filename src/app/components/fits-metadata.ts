/** Inspect FITS headers locally; never read or upload the science pixel arrays. */
export type FitsMetadata = {
  filename: string;
  date: string;
  detector: number | null;
  center: { raDeg: number; decDeg: number };
  width: number;
  height: number;
  unit: string;
};

type Header = Record<string, string | number | boolean>;

function valueOf(card: string): string | number | boolean {
  const raw = card.slice(10).trim();
  if (raw.startsWith("'")) {
    const match = raw.match(/^'((?:[^']|'')*)'/);
    return (match?.[1] ?? "").replaceAll("''", "'").trim();
  }
  const token = raw.split("/")[0].trim();
  if (token === "T" || token === "F") return token === "T";
  const numeric = Number(token.replace(/D/gi, "E"));
  return token && Number.isFinite(numeric) ? numeric : token;
}

export async function inspectFits(file: Pick<File, "name" | "size" | "slice">): Promise<FitsMetadata> {
  let offset = 0;
  let primary: Header = {};
  for (let hdu = 0; hdu < 32 && offset < file.size; hdu++) {
    const header: Header = {};
    let ended = false;
    for (let block = 0; block < 128; block++) {
      const bytes = await file.slice(offset, offset + 2880).arrayBuffer();
      if (bytes.byteLength !== 2880) throw new Error("Incomplete FITS header.");
      const text = new TextDecoder("ascii").decode(bytes);
      if (hdu === 0 && block === 0 && !text.startsWith("SIMPLE  =")) throw new Error("This is not a standard FITS image file.");
      offset += 2880;
      for (let index = 0; index < 2880; index += 80) {
        const card = text.slice(index, index + 80);
        const key = card.slice(0, 8).trim();
        if (key === "END") { ended = true; break; }
        if (card.slice(8, 10) === "= ") header[key] = valueOf(card);
      }
      if (ended) break;
    }
    if (!ended) throw new Error("FITS header is too large or missing END.");
    if (hdu === 0) {
      if (header.SIMPLE !== true) throw new Error("This is not a standard FITS image file.");
      primary = header;
    }
    if (header.EXTNAME === "IMAGE" && header.NAXIS === 2) {
      const raDeg = Number(header.CRVAL1);
      const decDeg = Number(header.CRVAL2);
      const width = Number(header.NAXIS1);
      const height = Number(header.NAXIS2);
      if (!String(header.CTYPE1 ?? "").startsWith("RA") || !String(header.CTYPE2 ?? "").startsWith("DEC") || !Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90 || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) throw new Error("The IMAGE extension has no usable equatorial sky coordinates.");
      const bitpix = Number(header.BITPIX);
      const imageBytes = width * height * Math.abs(bitpix) / 8;
      if (![8, 16, 32, 64, -32, -64].includes(bitpix) || !Number.isSafeInteger(imageBytes) || offset + imageBytes > file.size) throw new Error("Invalid or truncated IMAGE data.");
      const detector = Number(header.DETECTOR ?? primary.DETECTOR);
      return { filename: file.name, date: String(header["DATE-OBS"] ?? primary["DATE-OBS"] ?? "Unknown"), detector: Number.isInteger(detector) && detector >= 1 && detector <= 6 ? detector : null, center: { raDeg, decDeg }, width, height, unit: String(header.BUNIT ?? "Unknown") };
    }
    const axes = Number(header.NAXIS ?? 0);
    const bitpix = Number(header.BITPIX ?? 8);
    const groups = Number(header.GCOUNT ?? 1);
    const pcount = Number(header.PCOUNT ?? 0);
    if (!Number.isSafeInteger(axes) || axes < 0 || axes > 9 || ![8, 16, 32, 64, -32, -64].includes(bitpix) || !Number.isSafeInteger(groups) || groups < 1 || !Number.isSafeInteger(pcount) || pcount < 0) throw new Error("Unsupported FITS data layout.");
    let elements = axes === 0 ? 0 : 1;
    for (let axis = 1; axis <= axes; axis++) {
      const size = Number(header[`NAXIS${axis}`]);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid FITS axis size.");
      elements *= size;
    }
    const dataSize = (elements + pcount) * Math.abs(bitpix) / 8 * groups;
    if (!Number.isSafeInteger(dataSize) || dataSize < 0 || offset + dataSize > file.size) throw new Error("Invalid or truncated FITS data.");
    offset += Math.ceil(dataSize / 2880) * 2880;
  }
  throw new Error("No SPHEREx IMAGE extension found. Choose a full Level 2 FITS file.");
}
