import { inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Channels per pixel for each PNG color type. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** A pixel this dark or darker counts as black (0 to 255). */
const DARK = 16;
/** "Entirely or almost entirely black" (RES-5). */
const BLACK_SHARE = 0.98;

/**
 * Whether a screenshot is entirely or almost entirely black, which is what Android gives for a
 * screen with `FLAG_SECURE` (RES-5). Reads just enough of the PNG format for that: 8 and 16 bit,
 * every color type, no interlacing. Returns undefined for anything it cannot read (D-52).
 */
export function isBlackScreenshot(png: Buffer): boolean | undefined {
  const image = decode(png);
  if (image === undefined) return undefined;
  const { width, height, pixel } = image;
  // Every pixel of a phone screenshot is several million; a grid of about 40,000 is enough.
  const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 40_000)));
  let dark = 0;
  let total = 0;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      total++;
      if (pixel(x, y) <= DARK) dark++;
    }
  }
  return total > 0 && dark / total >= BLACK_SHARE;
}

interface Image {
  width: number;
  height: number;
  /** Brightness of a pixel, 0 to 255. */
  pixel: (x: number, y: number) => number;
}

function decode(png: Buffer): Image | undefined {
  if (png.length < 33 || !png.subarray(0, 8).equals(SIGNATURE))
    return undefined;
  let offset = 8;
  let header:
    { width: number; height: number; depth: number; type: number } | undefined;
  let palette: Buffer | undefined;
  const data: Buffer[] = [];
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("latin1", offset + 4, offset + 8);
    const body = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      if (body.length < 13 || body[12] !== 0) return undefined; // interlaced
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8] ?? 0,
        type: body[9] ?? 0,
      };
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (header === undefined || data.length === 0) return undefined;
  const { width, height, depth, type } = header;
  const channels = CHANNELS[type];
  if (channels === undefined || (depth !== 8 && depth !== 16)) return undefined;
  if (type === 3 && (palette === undefined || depth !== 8)) return undefined;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(data));
  } catch {
    return undefined;
  }
  const bytes = depth / 8;
  const pixelBytes = channels * bytes;
  const rowBytes = width * pixelBytes;
  if (raw.length < height * (rowBytes + 1)) return undefined;
  const rows = unfilter(raw, width, height, pixelBytes);
  if (rows === undefined) return undefined;

  // The high byte of each 16 bit sample is enough for brightness.
  const sample = (x: number, y: number, channel: number) =>
    rows[y * rowBytes + x * pixelBytes + channel * bytes] ?? 0;
  const pixel = (x: number, y: number): number => {
    if (type === 0 || type === 4) return sample(x, y, 0);
    if (type === 3) {
      const index = sample(x, y, 0) * 3;
      return luminance(
        palette?.[index] ?? 0,
        palette?.[index + 1] ?? 0,
        palette?.[index + 2] ?? 0,
      );
    }
    return luminance(sample(x, y, 0), sample(x, y, 1), sample(x, y, 2));
  };
  return { width, height, pixel };
}

/** Undoes PNG's per-row filters (PNG specification, section 9). */
function unfilter(
  raw: Buffer,
  width: number,
  height: number,
  pixelBytes: number,
): Buffer | undefined {
  const rowBytes = width * pixelBytes;
  const out = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const source = y * (rowBytes + 1) + 1;
    const row = y * rowBytes;
    const above = row - rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const value = raw[source + i] ?? 0;
      const left = i >= pixelBytes ? (out[row + i - pixelBytes] ?? 0) : 0;
      const up = y > 0 ? (out[above + i] ?? 0) : 0;
      const upLeft =
        y > 0 && i >= pixelBytes ? (out[above + i - pixelBytes] ?? 0) : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = (left + up) >> 1;
          break;
        case 4:
          predicted = paeth(left, up, upLeft);
          break;
        default:
          return undefined;
      }
      out[row + i] = (value + predicted) & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
