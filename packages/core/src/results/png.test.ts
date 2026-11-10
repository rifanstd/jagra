import { crc32, deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { isBlackScreenshot } from "./png.js";

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}

interface Options {
  type?: number;
  depth?: number;
  interlace?: number;
  palette?: number[];
  /** The filter byte for each row. */
  filter?: (y: number) => number;
}

/** A PNG whose pixel at (x, y) has the given channel values, before filtering. */
function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number[],
  options: Options = {},
): Buffer {
  const { type = 6, depth = 8, interlace = 0 } = options;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = type;
  header[12] = interlace;
  const bytes = depth / 8;
  const rows: Buffer[] = [];
  let previous: Buffer | undefined;
  for (let y = 0; y < height; y++) {
    const samples = Buffer.from(
      Array.from({ length: width }, (_, x) => pixel(x, y)).flatMap((channels) =>
        channels.flatMap((c) => (bytes === 2 ? [c, 0] : [c])),
      ),
    );
    const filter = options.filter?.(y) ?? 0;
    const pixelBytes = samples.length / width;
    const filtered = Buffer.alloc(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const left = i >= pixelBytes ? (samples[i - pixelBytes] ?? 0) : 0;
      const up = previous?.[i] ?? 0;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : 0;
      filtered[i] = ((samples[i] ?? 0) - predicted) & 0xff;
    }
    rows.push(Buffer.from([filter]), filtered);
    previous = samples;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    ...(options.palette ? [chunk("PLTE", Buffer.from(options.palette))] : []),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("isBlackScreenshot (RES-5)", () => {
  it("finds a black screen, as FLAG_SECURE gives", () => {
    expect(isBlackScreenshot(png(108, 240, () => [0, 0, 0, 255]))).toBe(true);
  });

  it("passes a normal screen", () => {
    expect(isBlackScreenshot(png(108, 240, () => [238, 240, 243, 255]))).toBe(
      false,
    );
  });

  it("calls a screen black when only a sliver is lit", () => {
    // A thin bright line, 1% of the screen.
    const sliver = png(100, 200, (_, y) =>
      y < 2 ? [255, 255, 255, 255] : [5, 5, 5, 255],
    );
    expect(isBlackScreenshot(sliver)).toBe(true);
  });

  it("does not call a dark app screen with content black", () => {
    const darkTheme = png(100, 200, (x, y) =>
      (x + y) % 4 === 0 ? [235, 235, 235, 255] : [38, 38, 38, 255],
    );
    expect(isBlackScreenshot(darkTheme)).toBe(false);
  });

  it("undoes every row filter", () => {
    const image = (filter: number) =>
      png(60, 60, (x, y) => [(x * 4) % 256, (y * 4) % 256, 200, 255], {
        filter: () => filter,
      });
    for (const filter of [0, 1, 2, 3])
      expect(isBlackScreenshot(image(filter))).toBe(false);
    const black = png(60, 60, () => [0, 0, 0, 255], { filter: (y) => y % 4 });
    expect(isBlackScreenshot(black)).toBe(true);
  });

  it("reads RGB, grayscale, 16 bit and palette images", () => {
    expect(isBlackScreenshot(png(40, 40, () => [0, 0, 0], { type: 2 }))).toBe(
      true,
    );
    expect(isBlackScreenshot(png(40, 40, () => [255], { type: 0 }))).toBe(
      false,
    );
    expect(
      isBlackScreenshot(png(40, 40, () => [0, 0, 0, 255], { depth: 16 })),
    ).toBe(true);
    expect(
      isBlackScreenshot(
        png(40, 40, () => [1], { type: 3, palette: [0, 0, 0, 250, 250, 250] }),
      ),
    ).toBe(false);
  });

  it("gives up on what it cannot read", () => {
    expect(isBlackScreenshot(Buffer.from("not a png"))).toBeUndefined();
    expect(
      isBlackScreenshot(png(10, 10, () => [0, 0, 0, 255], { interlace: 1 })),
    ).toBeUndefined();
  });
});
