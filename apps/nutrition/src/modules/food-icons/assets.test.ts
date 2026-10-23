import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
  test("the committed manifest contains every replacement and addition", async () => {
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

    expect(manifest.icons).toHaveLength(455);
    expect(counts).toEqual({
      "baked-goods": 37,
      meats: 43,
      vegetables: 64,
      seafood: 24,
      fruit: 46,
      "nuts-and-seeds": 24,
      "dairy-and-eggs": 21,
      drinks: 41,
      sweets: 36,
      other: 119,
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
      expect(bounds.width, icon.key).toBeGreaterThan(0);
      expect(bounds.height, icon.key).toBeGreaterThan(0);
      expect(
        Math.max(bounds.width, bounds.height),
        icon.key,
      ).toBeGreaterThanOrEqual(90);
      expect(bounds.minX, icon.key).toBeGreaterThan(0);
      expect(bounds.minY, icon.key).toBeGreaterThan(0);
      expect(bounds.maxX, icon.key).toBeLessThan(127);
      expect(bounds.maxY, icon.key).toBeLessThan(127);
    }
  });

  test("every original is distinct, replaces legacy bytes, and matches its public copy", async () => {
    const manifest = await readJson<IconManifest>(
      resolve(assetsRoot, "icons.json"),
    );
    const plan = await readJson<{
      icons: Array<{ key: string; prompt: string; replacesSha256?: string }>;
    }>(resolve(projectRoot, "config/food-icons/originals.json"));
    const planned = new Map(plan.icons.map((icon) => [icon.key, icon]));
    const hashes = new Set<string>();
    const published = resolve(projectRoot, "../macros/public/food-icons");

    expect(
      await readJson<IconManifest>(resolve(published, "catalog.json")),
    ).toEqual(manifest);
    for (const icon of manifest.icons) {
      const original = planned.get(icon.key);
      expect(original?.prompt.length, icon.key).toBeGreaterThan(0);
      const bytes = await readFile(resolve(assetsRoot, icon.file));
      const hash = createHash("sha256").update(bytes).digest("hex");
      expect(hash, icon.key).not.toBe(original?.replacesSha256);
      expect(hashes.has(hash), icon.key).toBe(false);
      hashes.add(hash);
      expect(
        await readFile(resolve(published, `${icon.key}.png`)),
        icon.key,
      ).toEqual(bytes);
    }
  });
});

describe("food icon rules", () => {
  test("new foods have specific icons instead of broad category fallbacks", async () => {
    const config = await readJson<FoodIconRules>(
      resolve(projectRoot, "config/food-icons/rules.json"),
    );
    const compiled = compileFoodIconRules(config);
    const examples = {
      "Firm tofu": "other-110",
      "Smoked tempeh": "other-111",
      "Cooked quinoa": "other-113",
      "Oat milk": "drinks-035",
      "Soya milk": "drinks-036",
      "Soy milk": "drinks-036",
      "Matcha latte": "drinks-038",
      "Chia seeds": "nuts-and-seeds-020",
      "Pumpkin seeds": "nuts-and-seeds-022",
      Tahini: "nuts-and-seeds-024",
      "Dragon fruit": "fruit-044",
      Edamame: "vegetables-062",
      Skyr: "dairy-and-eggs-020",
      "Greek yoghurt": "dairy-and-eggs-021",
      "Sourdough bread": "baked-goods-037",
      "Chia seed protein bar": "sweets-021",
      "Baby food with oat milk": "other-089",
    };
    for (const [name, key] of Object.entries(examples)) {
      expect(classifyFoodIcon(compiled, name), name).toBe(key);
    }
  });
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
