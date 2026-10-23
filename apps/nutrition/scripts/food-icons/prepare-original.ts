import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";

// Keep the same optical footprint as the existing 1.3× icon renderers.
const [input, output] = Bun.argv.slice(2);
if (!input || !output) {
  throw new Error(
    "Usage: bun scripts/food-icons/prepare-original.ts INPUT OUTPUT",
  );
}

const source = sharp(resolve(input));
const metadata = await source.metadata();
if (!metadata.hasAlpha || (await source.stats()).channels[3]?.min !== 0) {
  throw new Error("Original icon must have a transparent background");
}

await mkdir(dirname(resolve(output)), { recursive: true });
await source
  .trim({ threshold: 8 })
  .resize(95, 95, { fit: "inside" })
  .png()
  .toBuffer()
  .then((buffer) =>
    sharp(buffer)
      .resize(128, 128, {
        fit: "contain",
        withoutEnlargement: true,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toFile(resolve(output)),
  );
