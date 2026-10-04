import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { foodIcons } from "../src/db/schema";

interface IconManifestEntry {
  key: string;
  foodGroup: string;
  file: string;
}

interface IconManifest {
  icons: IconManifestEntry[];
}

const readOption = (name: string, fallback: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? fallback : (Bun.argv[index + 1] ?? fallback);
};

const mediaTypes: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const manifestPath = resolve(
  readOption("--manifest", "assets/food-icons/icons.json"),
);
const databaseUrl = Bun.env.DATABASE_URL;

if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

try {
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as IconManifest;

  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    throw new Error("Icon manifest does not contain any icons");
  }

  if (!manifest.icons.some((icon) => icon.key === "other-001")) {
    throw new Error("Icon manifest must contain the default icon other-001");
  }

  for (const icon of manifest.icons) {
    const filePath = resolve(dirname(manifestPath), icon.file);
    const mediaType = mediaTypes[extname(filePath).toLowerCase()];

    if (!mediaType) {
      throw new Error(`Unsupported icon format: ${filePath}`);
    }

    const imageBase64 = Buffer.from(await readFile(filePath)).toString(
      "base64",
    );

    await db
      .insert(foodIcons)
      .values({
        key: icon.key,
        foodGroup: icon.foodGroup,
        mediaType,
        imageBase64,
      })
      .onConflictDoUpdate({
        target: foodIcons.key,
        set: {
          foodGroup: icon.foodGroup,
          mediaType,
          imageBase64,
          updatedAt: new Date(),
        },
      });
  }

  console.log(`Imported ${manifest.icons.length} food icons`);
} finally {
  await pool.end();
}
