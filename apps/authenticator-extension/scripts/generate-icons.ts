/**
 * Renders the toolbar icon set into public/icons.
 *
 * The icon is drawn analytically (rounded square + keyhole) and encoded to PNG
 * here rather than checked in as binary blobs, so the palette stays tied to the
 * design tokens and the sizes can be regenerated with `bun run icons`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUTPUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public/icons",
);
const SIZES = [16, 32, 48, 128];
/** Samples per axis inside a pixel; the icon has curves and no other AA. */
const SUBSAMPLES = 4;

/** --accent from @repo/ui/theme.css: legible against light and dark toolbars. */
const BACKGROUND: Rgb = [0xa1, 0xbc, 0x98];
/** --accent-strong. */
const GLYPH: Rgb = [0x30, 0x36, 0x30];

type Rgb = [number, number, number];

/** Signed distance to a rounded box centred on (0.5, 0.5), in unit coordinates. */
function roundedBoxDistance(
  x: number,
  y: number,
  half: number,
  radius: number,
) {
  const dx = Math.abs(x - 0.5) - (half - radius);
  const dy = Math.abs(y - 0.5) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - radius;
}

function insideKeyhole(x: number, y: number) {
  const headRadius = 0.15;
  const headCenterY = 0.42;
  if (Math.hypot(x - 0.5, y - headCenterY) <= headRadius) return true;

  const stemTop = headCenterY;
  const stemBottom = 0.74;
  if (y < stemTop || y > stemBottom) return false;

  const progress = (y - stemTop) / (stemBottom - stemTop);
  const halfWidth = 0.055 + progress * 0.055;
  return Math.abs(x - 0.5) <= halfWidth;
}

function renderPixels(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const step = 1 / (size * SUBSAMPLES);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let coverage = 0;
      let glyphCoverage = 0;

      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const x = (px * SUBSAMPLES + sx + 0.5) * step;
          const y = (py * SUBSAMPLES + sy + 0.5) * step;

          if (roundedBoxDistance(x, y, 0.5, 0.22) > 0) continue;
          coverage++;
          if (insideKeyhole(x, y)) glyphCoverage++;
        }
      }

      const samples = SUBSAMPLES * SUBSAMPLES;
      const alpha = coverage / samples;
      const glyphMix = coverage === 0 ? 0 : glyphCoverage / coverage;
      const offset = (py * size + px) * 4;

      for (let channel = 0; channel < 3; channel++) {
        const base = BACKGROUND[channel] as number;
        const glyph = GLYPH[channel] as number;
        pixels[offset + channel] = Math.round(base + (glyph - base) * glyphMix);
      }
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = ((CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(size: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0; // filter type: none
    Buffer.from(pixels.buffer, row * stride, stride).copy(
      raw,
      row * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function generateIcons() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const size of SIZES) {
    const png = encodePng(size, renderPixels(size));
    writeFileSync(resolve(OUTPUT_DIR, `icon-${size}.png`), png);
  }
  return SIZES.map((size) => `icons/icon-${size}.png`);
}

if (import.meta.main) {
  const written = generateIcons();
  console.log(`Wrote ${written.length} icons to ${OUTPUT_DIR}`);
}
