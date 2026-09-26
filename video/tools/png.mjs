// Minimal PNG codec for the renderer: decodes 8-bit RGB/RGBA, non-interlaced
// (what Chromium's Page.captureScreenshot produces) to packed RGB, and encodes
// solid RGBA images for the self-test.
import { crc32, deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Decodes to packed RGB, into `out` (Uint8Array of w*h*3) when given. */
export function decodePng(buf, out) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  let off = 8;
  let width = 0, height = 0, colorType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const depth = data[8];
      colorType = data[9];
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) throw new Error(`unsupported PNG (depth ${depth}, type ${colorType}, interlace ${data[12]})`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(idat.length === 1 ? idat[0] : Buffer.concat(idat));
  const rgb = out ?? new Uint8Array(width * height * 3);
  let prev = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    const line = raw.subarray(base + 1, base + 1 + stride);
    switch (filter) {
      case 0:
        row.set(line);
        break;
      case 1:
        for (let i = 0; i < stride; i++) row[i] = line[i] + (i >= bpp ? row[i - bpp] : 0);
        break;
      case 2:
        for (let i = 0; i < stride; i++) row[i] = line[i] + prev[i];
        break;
      case 3:
        for (let i = 0; i < stride; i++) row[i] = line[i] + (((i >= bpp ? row[i - bpp] : 0) + prev[i]) >> 1);
        break;
      case 4:
        for (let i = 0; i < stride; i++) {
          const a = i >= bpp ? row[i - bpp] : 0;
          const b = prev[i];
          const c = i >= bpp ? prev[i - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          row[i] = line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        break;
      default:
        throw new Error(`bad PNG filter ${filter}`);
    }
    const o = y * width * 3;
    if (bpp === 3) rgb.set(row, o);
    else for (let x = 0; x < width; x++) {
      rgb[o + x * 3] = row[x * 4];
      rgb[o + x * 3 + 1] = row[x * 4 + 1];
      rgb[o + x * 3 + 2] = row[x * 4 + 2];
    }
    [prev, row] = [row, prev];
  }
  return { width, height, data: rgb };
}

export function solidPng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) rows.set([r, g, b, 255], y * (1 + w * 4) + 1 + x * 4);
  }
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
