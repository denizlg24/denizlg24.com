import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

import {
  classifyFoodIcon,
  compileFoodIconRules,
  type FoodIconRules,
} from "./classifier";

interface IconManifestEntry {
  key: string;
  foodGroup: string;
  file: string;
}

interface IconManifest {
  icons: IconManifestEntry[];
}

const projectRoot = resolve(import.meta.dir, "../../..");
const assetsRoot = resolve(projectRoot, "assets/food-icons");

const readJson = async <Value>(path: string) =>
  JSON.parse(await readFile(path, "utf8")) as Value;

const opaqueBounds = async (path: string) => {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if ((data[(y * info.width + x) * info.channels + 3] ?? 0) === 0) {
        continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    canvasWidth: info.width,
    canvasHeight: info.height,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

describe("food icon assets", () => {
  test("the committed manifest contains every extracted icon", async () => {
    const manifest = await readJson<IconManifest>(
      resolve(assetsRoot, "icons.json"),
    );
    const counts = Object.fromEntries(
      [...new Set(manifest.icons.map((icon) => icon.foodGroup))].map(
        (group) => [
          group,
          manifest.icons.filter((icon) => icon.foodGroup === group).length,
        ],
      ),
    );

    expect(manifest.icons).toHaveLength(424);
    expect(counts).toEqual({
      "baked-goods": 36,
      meats: 43,
      vegetables: 61,
      seafood: 24,
      fruit: 43,
      "nuts-and-seeds": 19,
      "dairy-and-eggs": 19,
      drinks: 34,
      sweets: 36,
      other: 109,
    });
    expect(manifest.icons[0]?.key).toBe("baked-goods-001");
    expect(manifest.icons.some((icon) => icon.key === "other-001")).toBe(true);
  });

  test("icons fit a transparent 128px canvas without touching its edges", async () => {
    const manifest = await readJson<IconManifest>(
      resolve(assetsRoot, "icons.json"),
    );

    for (const icon of manifest.icons) {
      const bounds = await opaqueBounds(resolve(assetsRoot, icon.file));
      expect(bounds.canvasWidth, icon.key).toBe(128);
      expect(bounds.canvasHeight, icon.key).toBe(128);
      expect(bounds.minX, icon.key).toBeGreaterThan(0);
      expect(bounds.minY, icon.key).toBeGreaterThan(0);
      expect(bounds.maxX, icon.key).toBeLessThan(127);
      expect(bounds.maxY, icon.key).toBeLessThan(127);
    }
  });

  test("non-square baked-good source art keeps its original proportions", async () => {
    const expectedSizes: Record<string, [number, number]> = {
      "baked-goods-001": [95, 76],
      "baked-goods-002": [95, 66],
      "baked-goods-004": [95, 69],
    };

    for (const [key, expected] of Object.entries(expectedSizes)) {
      const bounds = await opaqueBounds(
        resolve(assetsRoot, "icons", `${key}.png`),
      );
      expect([bounds.width, bounds.height], key).toEqual(expected);
    }
  });
});

describe("food icon rules", () => {
  test("every rule compiles and references a generated icon", async () => {
    const [config, manifest] = await Promise.all([
      readJson<FoodIconRules>(
        resolve(projectRoot, "config/food-icons/rules.json"),
      ),
      readJson<IconManifest>(resolve(assetsRoot, "icons.json")),
    ]);
    const iconKeys = new Set(manifest.icons.map((icon) => icon.key));

    expect(() => compileFoodIconRules(config)).not.toThrow();
    expect(iconKeys.has(config.defaultIconKey)).toBe(true);
    for (const rule of config.rules)
      expect(iconKeys.has(rule.iconKey)).toBe(true);
  });

  test("higher-priority specific matches win and unknown foods use Other", async () => {
    const config = await readJson<FoodIconRules>(
      resolve(projectRoot, "config/food-icons/rules.json"),
    );
    const compiled = compileFoodIconRules(config);

    expect(classifyFoodIcon(compiled, "Pepperoni pizza")).toBe("other-036");
    expect(classifyFoodIcon(compiled, "Fresh broccoli florets")).toBe(
      "vegetables-003",
    );
    expect(classifyFoodIcon(compiled, "Atlantic salmon fillet")).toBe(
      "seafood-008",
    );
    expect(classifyFoodIcon(compiled, "Salmão grelhado")).toBe("seafood-008");
    expect(classifyFoodIcon(compiled, "Café espresso")).toBe("drinks-005");
    expect(classifyFoodIcon(compiled, "Cheddar cheese")).toBe(
      "dairy-and-eggs-002",
    );
    expect(classifyFoodIcon(compiled, "Whey Protein")).toBe("drinks-029");
    expect(classifyFoodIcon(compiled, "Protein Bar")).toBe("sweets-021");
    expect(classifyFoodIcon(compiled, "Penne Rigate")).toBe("other-021");
    expect(classifyFoodIcon(compiled, "Granola")).toBe("other-032");
    expect(classifyFoodIcon(compiled, "Granola Bar")).toBe("sweets-021");
    expect(classifyFoodIcon(compiled, "Vegetable Noodles")).toBe(
      "vegetables-047",
    );
    expect(classifyFoodIcon(compiled, "Coconut Oil")).toBe("other-047");
    expect(classifyFoodIcon(compiled, "Parmigiano Reggiano")).toBe(
      "dairy-and-eggs-002",
    );
    expect(classifyFoodIcon(compiled, "Kimchi")).toBe("vegetables-058");
    expect(classifyFoodIcon(compiled, "Zalmfilet")).toBe("seafood-008");
    expect(classifyFoodIcon(compiled, "Quantum nutrient blend")).toBe(
      "other-001",
    );
  });
});
